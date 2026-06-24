import {
  type BzzoiroCardIncident,
  type BzzoiroGoalIncident,
  type BzzoiroIncident,
  type BzzoiroLiveEvent,
  BzzoiroSocketPool,
  getIncidents,
  listScheduledEvents,
} from "./bzzoiro.js";
import {
  cardDedupeId,
  goalDedupeId,
  goalDisallowedDedupeId,
  goalHasScore,
  normalizeCard,
  normalizeGoal,
  normalizeGoalDisallowed,
  normalizeState,
  stateEventType,
  wsPhase,
} from "./normalize.js";
import type { MatchEvent } from "./normalize.js";
import { bumpPassLastModified, syncSchedule, updateMatchFromEvent } from "./state.js";

const REFRESH_MS = 4 * 60 * 60_000;
const WINDOW_MS = 24 * 60 * 60_000;
const MAX_MATCH_MS = 3.5 * 60 * 60_000;
const WS_HEALTH_STALE_MS = 4 * 60_000;
const GOAL_ENRICH_RETRIES = 20;
const GOAL_ENRICH_RETRY_MS = 1_500;
const SECOND_HALF_PERIOD_CODE = 31;
const EMIT_RETRY_WINDOW_MS = 3 * 60_000;
const EMIT_TRACKER_TTL_MS = 6 * 60 * 60_000;
const FINISHED_TRACKER_TTL_MS = 48 * 60 * 60_000;

type Logger = (msg: string, meta?: Record<string, unknown>) => void;

export interface WatcherOptions {
  token: string;
  onEvent: (event: MatchEvent) => Promise<void>;
  leagueIds: Set<number> | null;
  refreshMs?: number;
  windowMs?: number;
  enrichRetries?: number;
  enrichRetryMs?: number;
  log?: Logger;
}

interface WsTime {
  minute?: number;
  period?: number | string;
  status?: string;
}

interface WsSide {
  id?: number;
  name?: string;
}

export class WcWatcher {
  private readonly opts: WatcherOptions;
  private readonly pool: BzzoiroSocketPool;
  private readonly log: Logger;
  private readonly fixtures = new Map<number, BzzoiroLiveEvent>();
  private readonly emitState = new Map<
    string,
    { firstAttemptMs: number; delivered: boolean; inFlight: boolean }
  >();
  private readonly finishedAtMs = new Map<number, number>();
  private readonly announcedScores = new Map<number, { home: number; away: number }>();
  private readonly enriching = new Set<string>();
  private readonly enrichPending = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRefreshAtMs = 0;
  private lastEmitPruneMs = 0;
  private lastWsFrameAtMs = 0;
  private lastSubscribeAtMs = 0;

  constructor(opts: WatcherOptions) {
    this.opts = opts;
    this.log = opts.log ?? (() => {});
    this.pool = new BzzoiroSocketPool({
      token: opts.token,
      onFrame: (frame) => void this.onFrame(frame),
      log: this.log,
    });
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.opts.refreshMs ?? REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.pool.closeAll();
  }

  health(): { ok: boolean; lastRefreshAtMs: number; lastWsFrameAtMs: number; sockets: number; subs: number } {
    const subs = this.pool.subscribedIds().size;
    const baseline = Math.max(this.lastWsFrameAtMs, this.lastSubscribeAtMs);
    const wsWedged = subs > 0 && baseline > 0 && Date.now() - baseline > WS_HEALTH_STALE_MS;
    return {
      ok: this.lastRefreshAtMs > 0 && !wsWedged,
      lastRefreshAtMs: this.lastRefreshAtMs,
      lastWsFrameAtMs: this.lastWsFrameAtMs,
      sockets: this.pool.socketCount(),
      subs,
    };
  }

  private inScope(match: BzzoiroLiveEvent): boolean {
    return this.opts.leagueIds === null ? true : this.opts.leagueIds.has(match.league_id);
  }

  async refresh(): Promise<void> {
    let events: BzzoiroLiveEvent[];
    try {
      events = await listScheduledEvents(this.opts.token, this.opts.leagueIds, Date.now());
    } catch (err) {
      this.log("schedule fetch failed", { err: String(err) });
      return;
    }
    this.lastRefreshAtMs = Date.now();

    // update global state for pass rendering
    const scopedEvents = events.filter((e) => this.inScope(e));
    syncSchedule(scopedEvents);

    const now = Date.now();
    const horizon = now + (this.opts.windowMs ?? WINDOW_MS);
    const scheduleById = new Map<number, BzzoiroLiveEvent>();
    for (const match of events) {
      if (this.inScope(match)) scheduleById.set(match.id, match);
    }
    this.pruneFinished(now);
    const desired = new Set<number>();
    for (const match of scheduleById.values()) {
      if (this.finishedAtMs.has(match.id)) continue;
      const kickoffMs = match.event_date ? Date.parse(match.event_date) : NaN;
      const relevant =
        match.status === "inprogress" ||
        (match.status === "notstarted" && Number.isFinite(kickoffMs) && kickoffMs <= horizon);
      if (!relevant) continue;
      desired.add(match.id);
      this.fixtures.set(match.id, match);
    }
    for (const [id, cached] of this.fixtures) {
      if (desired.has(id) || scheduleById.has(id)) continue;
      const kickoffMs = cached.event_date ? Date.parse(cached.event_date) : NaN;
      const aged = Number.isFinite(kickoffMs) && now - kickoffMs > MAX_MATCH_MS;
      if (!aged) desired.add(id);
    }
    for (const id of [...this.fixtures.keys()]) {
      if (!desired.has(id)) { this.fixtures.delete(id); this.announcedScores.delete(id); }
    }
    for (const id of this.finishedAtMs.keys()) desired.delete(id);
    const prevSubs = this.pool.subscribedIds();
    const addedNew = [...desired].some((id) => !prevSubs.has(id));
    this.pool.setSubscriptions(desired);
    if (desired.size === 0) this.lastSubscribeAtMs = 0;
    else if (addedNew) this.lastSubscribeAtMs = now;
    this.log("subscriptions refreshed", { desired: desired.size, sockets: this.pool.socketCount() });
  }

  async onFrame(raw: Record<string, unknown>): Promise<void> {
    this.lastWsFrameAtMs = Date.now();
    if (raw.type === "livedata") { await this.onLiveData(raw); return; }
    const frame =
      raw.type === "event"
        ? raw
        : raw.type === "subscribed" && raw.event != null && typeof raw.event === "object"
          ? (raw.event as Record<string, unknown>)
          : null;
    if (!frame || frame.type !== "event") return;
    await this.onEventFrame(frame);
  }

  private async onEventFrame(frame: Record<string, unknown>): Promise<void> {
    const id = frame.event_id as number | undefined;
    if (id == null) return;
    if (this.finishedAtMs.has(id)) return;
    const cached = this.fixtures.get(id);
    if (!cached) return;
    const time = (frame.time as WsTime | undefined) ?? {};
    const score = (frame.score as { home?: number; away?: number } | undefined) ?? {};
    if (score.home != null) cached.home_score = score.home;
    if (score.away != null) cached.away_score = score.away;
    if (time.status != null) cached.status = time.status;
    if (time.minute != null) cached.current_minute = time.minute;
    // keep app state in sync with live frames
    updateMatchFromEvent({
      matchId: id,
      homeScore: score.home,
      awayScore: score.away,
      minute: time.minute,
      status: time.status,
    });
    await this.reconcileAnnouncedScore(cached);
    if (this.hasPendingDisallow(cached)) return;
    const et = stateEventType(wsPhase(time.status, time.period));
    if (typeof et !== "string") return;
    const delivered = await this.emit(normalizeState({ match: this.snapshot(frame), eventType: et }));
    if (et === "FULL_TIME" && delivered && isMatchOver({
      status: time.status,
      homeScore: cached.home_score,
      awayScore: cached.away_score,
    })) {
      this.markFinished(id);
    }
  }

  private async reconcileAnnouncedScore(match: BzzoiroLiveEvent): Promise<void> {
    const home = match.home_score ?? 0;
    const away = match.away_score ?? 0;
    const announced = this.announcedScores.get(match.id);
    if (!announced) { this.announcedScores.set(match.id, { home, away }); return; }
    if (home > announced.home) announced.home = home;
    if (away > announced.away) announced.away = away;
    const scores: { side: "home" | "away"; current: number }[] = [
      { side: "home", current: home },
      { side: "away", current: away },
    ];
    for (const { side, current } of scores) {
      if (current >= announced[side]) continue;
      if (await this.emit(normalizeGoalDisallowed({ match, side }))) {
        announced[side] = current;
      }
    }
  }

  private hasPendingDisallow(match: BzzoiroLiveEvent): boolean {
    const announced = this.announcedScores.get(match.id);
    if (!announced) return false;
    const home = match.home_score ?? 0;
    const away = match.away_score ?? 0;
    for (const side of ["home", "away"] as const) {
      const current = side === "home" ? home : away;
      if (current >= announced[side]) continue;
      const dedupeId = goalDisallowedDedupeId({ matchId: match.id, side, homeScore: home, awayScore: away });
      if (!this.delivered(dedupeId) && !this.discarded(dedupeId)) return true;
    }
    return false;
  }

  private discarded(dedupeId: string): boolean {
    const rec = this.emitState.get(dedupeId);
    return !!rec && !rec.delivered && Date.now() - rec.firstAttemptMs > EMIT_RETRY_WINDOW_MS;
  }

  private raiseAnnouncedScore(id: number, home?: number, away?: number): void {
    const cur = this.announcedScores.get(id);
    const h = home ?? cur?.home ?? 0;
    const a = away ?? cur?.away ?? 0;
    if (!cur) { this.announcedScores.set(id, { home: h, away: a }); return; }
    cur.home = Math.max(cur.home, h);
    cur.away = Math.max(cur.away, a);
  }

  private async onLiveData(frame: Record<string, unknown>): Promise<void> {
    const id = frame.event_id as number | undefined;
    if (id == null) return;
    if (this.finishedAtMs.has(id)) return;
    const match = this.fixtures.get(id);
    if (!match) return;
    const situation = (frame.situation as string | undefined) ?? "";
    if (situation === "goal") { await this.enrichAndEmit(match, "goal"); return; }
    if (situation === "card") { await this.enrichAndEmit(match, "card"); return; }
    if (this.hasPendingDisallow(match)) return;
    const period = (frame.time as WsTime | undefined)?.period;
    const phase = livedataPhase(situation, period);
    const et = stateEventType(phase);
    if (typeof et === "string") {
      const delivered = await this.emit(normalizeState({ match, eventType: et }));
      if (et === "FULL_TIME" && delivered) this.markFinished(id);
    }
  }

  private markFinished(id: number): void {
    if (this.finishedAtMs.has(id)) return;
    this.finishedAtMs.set(id, Date.now());
    this.fixtures.delete(id);
    this.announcedScores.delete(id);
    const remaining = this.pool.subscribedIds();
    if (remaining.delete(id)) this.pool.setSubscriptions(remaining);
    if (this.pool.subscribedIds().size === 0) this.lastSubscribeAtMs = 0;
    this.log("match finished; unsubscribed", { id });
    bumpPassLastModified();
  }

  private snapshot(frame: Record<string, unknown>): BzzoiroLiveEvent {
    const id = frame.event_id as number;
    const cached = this.fixtures.get(id);
    const time = (frame.time as WsTime | undefined) ?? {};
    const home = (frame.home as WsSide | undefined) ?? {};
    const away = (frame.away as WsSide | undefined) ?? {};
    const score = (frame.score as { home?: number; away?: number } | undefined) ?? {};
    return {
      id,
      league_id: cached?.league_id ?? 0,
      league_name: cached?.league_name,
      home_team_id: home.id ?? cached?.home_team_id ?? 0,
      home_team: home.name ?? cached?.home_team ?? "",
      away_team_id: away.id ?? cached?.away_team_id ?? 0,
      away_team: away.name ?? cached?.away_team ?? "",
      status: time.status ?? cached?.status ?? "",
      period: wsPhase(time.status, time.period),
      current_minute: time.minute ?? cached?.current_minute ?? null,
      home_score: score.home ?? cached?.home_score ?? 0,
      away_score: score.away ?? cached?.away_score ?? 0,
      live_websocket: true,
      last_updated: "",
    };
  }

  private async enrichAndEmit(match: BzzoiroLiveEvent, kind: "goal" | "card"): Promise<void> {
    const key = `${match.id}:${kind}`;
    if (this.enriching.has(key)) { this.enrichPending.add(key); return; }
    this.enriching.add(key);
    try {
      do {
        this.enrichPending.delete(key);
        await this.pollIncidentsUntilNew(match, kind);
      } while (this.enrichPending.has(key));
    } finally {
      this.enriching.delete(key);
      this.enrichPending.delete(key);
    }
  }

  private async pollIncidentsUntilNew(match: BzzoiroLiveEvent, kind: "goal" | "card"): Promise<void> {
    const attempts = this.opts.enrichRetries ?? GOAL_ENRICH_RETRIES;
    const retryMs = this.opts.enrichRetryMs ?? GOAL_ENRICH_RETRY_MS;
    let deliveredAny = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let incidents: BzzoiroIncident[];
      try {
        incidents = await getIncidents(match.id, this.opts.token);
      } catch (err) {
        this.log("incidents fetch failed", { id: match.id, err: String(err) });
        return;
      }
      const { deliveredNew, undelivered } = await this.emitIncidents(match, incidents, kind);
      if (deliveredNew) deliveredAny = true;
      if (deliveredAny && undelivered === 0) return;
      if (attempt === attempts - 1) return;
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }

  private async emitIncidents(
    match: BzzoiroLiveEvent,
    incidents: BzzoiroIncident[],
    kind: "goal" | "card",
  ): Promise<{ deliveredNew: boolean; undelivered: number }> {
    let deliveredNew = false;
    let undelivered = 0;
    if (kind === "goal") {
      const goals = incidents
        .filter((inc): inc is BzzoiroGoalIncident => inc.type === "goal")
        .filter(goalHasScore);
      for (const incident of goals) {
        if (this.delivered(goalDedupeId({ matchId: match.id, incident }))) continue;
        if (await this.emit(normalizeGoal({ match, incident }))) {
          deliveredNew = true;
          this.raiseAnnouncedScore(match.id, incident.home_score, incident.away_score);
        } else {
          undelivered++;
        }
      }
    } else {
      const cards = incidents.filter((inc): inc is BzzoiroCardIncident => inc.type === "card");
      for (const incident of cards) {
        if (this.delivered(cardDedupeId({ matchId: match.id, incident }))) continue;
        if (await this.emit(normalizeCard({ match, incident }))) deliveredNew = true;
        else undelivered++;
      }
    }
    return { deliveredNew, undelivered };
  }

  private delivered(dedupeId: string): boolean {
    return this.emitState.get(dedupeId)?.delivered ?? false;
  }

  private async emit(event: MatchEvent): Promise<boolean> {
    const now = Date.now();
    this.pruneEmitState(now);
    const prior = this.emitState.get(event.dedupeId);
    if (prior?.delivered) return true;
    if (prior?.inFlight) return false;
    if (prior && now - prior.firstAttemptMs > EMIT_RETRY_WINDOW_MS) {
      this.log("emit skipped", { dedupeId: event.dedupeId, reason: "retry window elapsed" });
      return false;
    }
    const firstAttemptMs = prior?.firstAttemptMs ?? now;
    this.emitState.set(event.dedupeId, { firstAttemptMs, delivered: false, inFlight: true });
    try {
      await this.opts.onEvent(event);
      this.emitState.set(event.dedupeId, { firstAttemptMs, delivered: true, inFlight: false });
      this.log("emit", { eventType: event.eventType, dedupeId: event.dedupeId });
      return true;
    } catch (err) {
      this.emitState.set(event.dedupeId, { firstAttemptMs, delivered: false, inFlight: false });
      this.log("emit threw", { dedupeId: event.dedupeId, err: String(err) });
      return false;
    }
  }

  private pruneEmitState(now: number): void {
    if (now - this.lastEmitPruneMs < EMIT_RETRY_WINDOW_MS) return;
    this.lastEmitPruneMs = now;
    for (const [id, rec] of this.emitState) {
      if (now - rec.firstAttemptMs > EMIT_TRACKER_TTL_MS) this.emitState.delete(id);
    }
  }

  private pruneFinished(now: number): void {
    for (const [id, finishedMs] of this.finishedAtMs) {
      if (now - finishedMs > FINISHED_TRACKER_TTL_MS) this.finishedAtMs.delete(id);
    }
  }
}

function isMatchOver({
  status,
  homeScore,
  awayScore,
}: {
  status: string | undefined;
  homeScore: number | null;
  awayScore: number | null;
}): boolean {
  const s = (status ?? "").toLowerCase();
  if (s === "finished" || s === "ft_pen") return true;
  const fullTimePhase = s === "ft" || s === "aet" || s.includes("full");
  return fullTimePhase && homeScore != null && awayScore != null && homeScore !== awayScore;
}

function livedataPhase(situation: string, period: number | string | undefined): string {
  if (situation === "match_started") return "1st_half";
  if (situation === "match_ended") return "finished";
  if (situation === "periodscore" && period === SECOND_HALF_PERIOD_CODE) return "halftime";
  return "";
}
