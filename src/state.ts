import type { BzzoiroLiveEvent } from "./bzzoiro.js";

export interface LiveMatch {
  id: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number | null;
  status: string;
  period: string;
  leagueName: string;
  eventDate: string | undefined;
  isLive: boolean;
}

export interface AppState {
  liveMatches: Map<number, LiveMatch>;
  recentMatches: LiveMatch[];
  upcomingMatches: LiveMatch[];
  lastUpdatedMs: number;
  passLastModifiedMs: number;
}

const state: AppState = {
  liveMatches: new Map(),
  recentMatches: [],
  upcomingMatches: [],
  lastUpdatedMs: 0,
  passLastModifiedMs: Date.now(),
};

export function getState(): AppState {
  return state;
}

export function updateMatchFromEvent(update: {
  matchId: number;
  homeScore?: number;
  awayScore?: number;
  minute?: number | null;
  status?: string;
}): void {
  const match = state.liveMatches.get(update.matchId);
  if (!match) return;
  if (update.homeScore != null) match.homeScore = update.homeScore;
  if (update.awayScore != null) match.awayScore = update.awayScore;
  if (update.minute !== undefined) match.minute = update.minute;
  if (update.status) match.status = update.status;
  state.passLastModifiedMs = Date.now();
}

export function bumpPassLastModified(): void {
  state.passLastModifiedMs = Date.now();
}

export function syncSchedule(events: BzzoiroLiveEvent[]): void {
  const now = Date.now();
  const live = new Map<number, LiveMatch>();
  const recent: LiveMatch[] = [];
  const upcoming: LiveMatch[] = [];

  for (const ev of events) {
    const m: LiveMatch = {
      id: ev.id,
      homeTeam: ev.home_team,
      awayTeam: ev.away_team,
      homeScore: ev.home_score ?? 0,
      awayScore: ev.away_score ?? 0,
      minute: ev.current_minute,
      status: ev.status,
      period: ev.period,
      leagueName: ev.league_name ?? "FIFA World Cup",
      eventDate: ev.event_date,
      isLive: ev.status === "inprogress",
    };

    if (ev.status === "inprogress") {
      live.set(ev.id, m);
    } else if (ev.status === "finished") {
      // keep last 8 finished matches
      recent.push(m);
    } else if (ev.status === "notstarted") {
      const kickoff = ev.event_date ? Date.parse(ev.event_date) : NaN;
      if (Number.isFinite(kickoff) && kickoff > now) upcoming.push(m);
    }
  }

  state.liveMatches = live;
  state.recentMatches = recent
    .sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""))
    .slice(0, 8);
  state.upcomingMatches = upcoming
    .sort((a, b) => (a.eventDate ?? "").localeCompare(b.eventDate ?? ""))
    .slice(0, 8);
  state.lastUpdatedMs = now;
  state.passLastModifiedMs = now;
}
