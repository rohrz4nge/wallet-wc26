const REST_BASE = process.env.BZZOIRO_REST_BASE ?? "https://sports.bzzoiro.com";
const WS_URL = process.env.BZZOIRO_WS_URL ?? "wss://sports.bzzoiro.com/ws/live/";

export interface BzzoiroLiveEvent {
  id: number;
  league_id: number;
  league_name?: string;
  home_team_id: number;
  home_team: string;
  away_team_id: number;
  away_team: string;
  status: string;
  period: string;
  current_minute: number | null;
  home_score: number | null;
  away_score: number | null;
  live_websocket: boolean;
  last_updated: string;
  event_date?: string;
}

export interface BzzoiroGoalIncident {
  type: "goal";
  minute: number;
  player?: string;
  player_id?: number;
  is_home: boolean;
  goal_type?: string;
  assist?: string;
  added_time?: number | null;
  home_score?: number;
  away_score?: number;
}

export interface BzzoiroCardIncident {
  type: "card";
  minute: number;
  player?: string;
  player_id?: number;
  is_home: boolean;
  card_type?: string;
  added_time?: number | null;
}

export interface BzzoiroPeriodIncident {
  type: "period";
  text: string;
  minute: number;
  home_score?: number;
  away_score?: number;
}

export type BzzoiroIncident =
  | BzzoiroGoalIncident
  | BzzoiroCardIncident
  | BzzoiroPeriodIncident
  | { type: string; [key: string]: unknown };

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Token ${token}`, Accept: "application/json" };
}

async function getJson<T>(url: string, token: string, timeoutMs = 12_000): Promise<T> {
  const res = await fetch(url, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`bzzoiro ${res.status} for ${url}`);
  return (await res.json()) as T;
}

function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function listScheduledEvents(
  token: string,
  leagueIds: Set<number> | null,
  nowMs: number,
): Promise<BzzoiroLiveEvent[]> {
  const dateFrom = dateOnly(nowMs - 24 * 60 * 60_000);
  const dateTo = dateOnly(nowMs + 10 * 24 * 60 * 60_000);
  const query = `date_from=${dateFrom}&date_to=${dateTo}&limit=200`;
  const leagues = leagueIds === null ? [null] : [...leagueIds];
  const pages = await Promise.all(
    leagues.map((id) =>
      getJson<{ results?: BzzoiroLiveEvent[] }>(
        `${REST_BASE}/api/v2/events/?${id === null ? "" : `league_id=${id}&`}${query}`,
        token,
      ),
    ),
  );
  return pages.flatMap((p) => p.results ?? []);
}

export async function getIncidents(eventId: number, token: string): Promise<BzzoiroIncident[]> {
  const data = await getJson<{ incidents?: BzzoiroIncident[] }>(
    `${REST_BASE}/api/v2/events/${eventId}/incidents/`,
    token,
  );
  return data.incidents ?? [];
}

export async function getEvent(eventId: number, token: string): Promise<BzzoiroLiveEvent> {
  return getJson<BzzoiroLiveEvent>(`${REST_BASE}/api/v2/events/${eventId}/`, token);
}

export async function resolveLeagueId({
  token,
  nameMatch,
}: {
  token: string;
  nameMatch: RegExp;
}): Promise<number | null> {
  let url: string | null = `${REST_BASE}/api/v2/leagues/?limit=50`;
  while (url) {
    const page: { results?: Array<{ id: number; name: string }>; next?: string | null } =
      await getJson(url, token);
    for (const league of page.results ?? []) {
      if (nameMatch.test(league.name)) return league.id;
    }
    url = page.next ?? null;
  }
  return null;
}

export type WsFrameHandler = (frame: Record<string, unknown>) => void;
export type WsLogger = (msg: string, meta?: Record<string, unknown>) => void;

const PING_INTERVAL_MS = 30_000;
const SOCKET_STALE_MS = 3 * PING_INTERVAL_MS;

export class BzzoiroSocket {
  private ws: WebSocket | null = null;
  private readonly token: string;
  private readonly onFrame: WsFrameHandler;
  private readonly log: WsLogger;
  private readonly subscribed = new Set<number>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 1_000;
  private closed = false;
  private lastFrameAtMs = 0;

  constructor({ token, onFrame, log }: { token: string; onFrame: WsFrameHandler; log?: WsLogger }) {
    this.token = token;
    this.onFrame = onFrame;
    this.log = log ?? (() => {});
  }

  connect(): void {
    this.closed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const prior = this.ws;
      this.ws = null;
      try { prior.close(); } catch { /* noop */ }
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    const ws = new WebSocket(`${WS_URL}?token=${this.token}`);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.reconnectDelayMs = 1_000;
      this.lastFrameAtMs = Date.now();
      this.log("[ws] connected", { subscribed: [...this.subscribed] });
      for (const id of this.subscribed) this.send({ action: "subscribe", event_id: id });
      this.pingTimer = setInterval(() => {
        this.send({ action: "ping" });
        if (Date.now() - this.lastFrameAtMs > SOCKET_STALE_MS) {
          this.handleDisconnect(ws, "stale");
        }
      }, PING_INTERVAL_MS);
    });
    ws.addEventListener("message", (ev) => {
      this.lastFrameAtMs = Date.now();
      const raw = String(ev.data);
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        this.log("[ws] frame (non-JSON)", { raw: raw.slice(0, 500) });
        this.onFrame({});
        return;
      }
      this.log("[ws] frame", { frame });
      this.onFrame(frame);
    });
    ws.addEventListener("close", () => this.handleDisconnect(ws, "closed"));
    ws.addEventListener("error", () => this.handleDisconnect(ws, "error"));
  }

  private handleDisconnect(ws: WebSocket, reason: string): void {
    if (ws !== this.ws) return;
    this.ws = null;
    this.log(`[ws] ${reason}; scheduling reconnect`, {
      readyState: ws.readyState,
      reconnectDelayMs: this.reconnectDelayMs,
      subscribed: [...this.subscribed],
    });
    try { ws.close(); } catch { /* noop */ }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.closed) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  subscribe(eventId: number): void {
    if (this.subscribed.has(eventId)) return;
    this.subscribed.add(eventId);
    this.send({ action: "subscribe", event_id: eventId });
  }

  unsubscribe(eventId: number): void {
    if (!this.subscribed.has(eventId)) return;
    this.subscribed.delete(eventId);
    this.send({ action: "unsubscribe", event_id: eventId });
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.ws?.close(); } catch { /* noop */ }
  }

  size(): number { return this.subscribed.size; }
}

const MAX_SUBS_PER_SOCKET = 10;

export class BzzoiroSocketPool {
  private readonly token: string;
  private readonly onFrame: WsFrameHandler;
  private readonly log: WsLogger;
  private readonly cap: number;
  private readonly sockets: BzzoiroSocket[] = [];
  private readonly assignment = new Map<number, BzzoiroSocket>();

  constructor({
    token,
    onFrame,
    log,
    maxSubsPerSocket = MAX_SUBS_PER_SOCKET,
  }: {
    token: string;
    onFrame: WsFrameHandler;
    log?: WsLogger;
    maxSubsPerSocket?: number;
  }) {
    this.token = token;
    this.onFrame = onFrame;
    this.log = log ?? (() => {});
    this.cap = maxSubsPerSocket;
  }

  setSubscriptions(desired: Set<number>): void {
    for (const [id, socket] of this.assignment) {
      if (!desired.has(id)) { socket.unsubscribe(id); this.assignment.delete(id); }
    }
    for (const id of desired) {
      if (this.assignment.has(id)) continue;
      const socket = this.socketWithCapacity();
      socket.subscribe(id);
      this.assignment.set(id, socket);
    }
    this.dropEmptySockets();
  }

  private socketWithCapacity(): BzzoiroSocket {
    for (const socket of this.sockets) {
      if (socket.size() < this.cap) return socket;
    }
    const socket = new BzzoiroSocket({ token: this.token, onFrame: this.onFrame, log: this.log });
    socket.connect();
    this.sockets.push(socket);
    return socket;
  }

  private dropEmptySockets(): void {
    for (let i = this.sockets.length - 1; i >= 0; i--) {
      if (this.sockets[i]!.size() === 0) {
        this.sockets[i]!.close();
        this.sockets.splice(i, 1);
      }
    }
  }

  subscribedIds(): Set<number> { return new Set(this.assignment.keys()); }
  socketCount(): number { return this.sockets.length; }

  closeAll(): void {
    for (const socket of this.sockets) socket.close();
    this.sockets.length = 0;
    this.assignment.clear();
  }
}
