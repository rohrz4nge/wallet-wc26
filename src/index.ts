import { resolveLeagueId } from "./bzzoiro.js";
import { WcWatcher } from "./watcher.js";
import { generatePass, getSerialNumber } from "./pass-generator.js";
import { broadcastPassUpdate } from "./apns.js";
import { getAllPushTokens, getSerialNumbersForDevice, registerDevice, unregisterDevice } from "./db.js";
import { getState } from "./state.js";

const PORT = Number(process.env.PORT ?? 3000);
const PASS_TYPE_ID = process.env.PASS_TYPE_ID ?? "pass.com.max-lohmann.worldcup";
const AUTH_TOKEN = process.env.WALLET_AUTH_TOKEN ?? "";
const BZZOIRO_TOKEN = process.env.BZZOIRO_API_TOKEN ?? "";
const SERVICE_URL = process.env.SERVICE_URL ?? `http://localhost:${PORT}`;

function log(msg: string, meta?: Record<string, unknown>): void {
  const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg;
  console.log(`[wallet] ${line}`);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

// validate Apple Wallet webservice auth token
function checkAuth(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  return auth === `ApplePass ${AUTH_TOKEN}`;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // ─── health ────────────────────────────────────────────────────────────────
  if (path === "/health") {
    const state = getState();
    const h = watcher?.health() ?? { ok: false };
    return Response.json({ ...h, liveMatches: state.liveMatches.size, lastUpdatedMs: state.lastUpdatedMs });
  }

  // ─── pass download (for adding to Wallet) ─────────────────────────────────
  if ((path === "/download" || path === "/") && method === "GET") {
    log("pass download requested");
    const buf = await generatePass(SERVICE_URL);
    return new Response(buf, {
      headers: {
        "content-type": "application/vnd.apple.pkpass",
        "content-disposition": 'inline; filename="worldcup2026.pkpass"',
      },
    });
  }

  // ─── Apple Wallet webservice endpoints ────────────────────────────────────

  // Device registration
  // POST /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
  const regMatch = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)\/([^/]+)$/);
  if (regMatch && method === "POST") {
    if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
    const [, deviceId, passTypeId, serialNumber] = regMatch as [string, string, string, string];
    const body = await req.json() as { pushToken?: string };
    if (!body.pushToken) return new Response("Bad Request", { status: 400 });
    await registerDevice({
      device_library_identifier: deviceId!,
      push_token: body.pushToken,
      serial_number: serialNumber!,
    });
    log("device registered", { deviceId, serialNumber });
    return new Response(null, { status: 201 });
  }

  // Device unregistration
  // DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
  if (regMatch && method === "DELETE") {
    if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
    const [, deviceId, , serialNumber] = regMatch as [string, string, string, string];
    await unregisterDevice(deviceId!, serialNumber!);
    log("device unregistered", { deviceId, serialNumber });
    return new Response(null, { status: 200 });
  }

  // List updated serials for a device
  // GET /v1/devices/:deviceId/registrations/:passTypeId
  const listMatch = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)$/);
  if (listMatch && method === "GET") {
    if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
    const [, deviceId] = listMatch as [string, string, string];
    const since = url.searchParams.get("passesUpdatedSince") ?? undefined;
    const serials = await getSerialNumbersForDevice(deviceId!, PASS_TYPE_ID, since);
    if (serials.length === 0) return new Response(null, { status: 204 });
    return Response.json({
      serialNumbers: serials,
      lastUpdated: new Date(getState().passLastModifiedMs).toISOString(),
    });
  }

  // Get latest pass
  // GET /v1/passes/:passTypeId/:serialNumber
  const passMatch = path.match(/^\/v1\/passes\/([^/]+)\/([^/]+)$/);
  if (passMatch && method === "GET") {
    if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
    const buf = await generatePass(SERVICE_URL);
    const state = getState();
    return new Response(buf, {
      headers: {
        "content-type": "application/vnd.apple.pkpass",
        "last-modified": new Date(state.passLastModifiedMs).toUTCString(),
      },
    });
  }

  // Apple log endpoint
  if (path === "/v1/log" && method === "POST") {
    const body = await req.text();
    log("[apple-wallet-log]", { body: body.slice(0, 500) });
    return new Response(null, { status: 200 });
  }

  return new Response("Not Found", { status: 404 });
}

// ─── watcher startup ─────────────────────────────────────────────────────────

let watcher: WcWatcher | null = null;

async function startWatcher(): Promise<void> {
  const token = required("BZZOIRO_API_TOKEN");

  let leagueIds: Set<number> | null;
  if (process.env.BZZOIRO_ALL_LEAGUES === "true") {
    log("scope: ALL leagues");
    leagueIds = null;
  } else if (process.env.BZZOIRO_LEAGUE_ID) {
    leagueIds = new Set(process.env.BZZOIRO_LEAGUE_ID.split(",").map((s) => Number(s.trim())));
    log("scope: explicit league ids", { leagueIds: [...leagueIds] });
  } else {
    const wcId = await resolveLeagueId({ token, nameMatch: /^world cup 20\d\d$/i });
    if (wcId == null) {
      log("WARNING: could not resolve World Cup league — watching nothing");
      leagueIds = new Set();
    } else {
      log("scope: resolved World Cup league", { leagueId: wcId });
      leagueIds = new Set([wcId]);
    }
  }

  watcher = new WcWatcher({
    token,
    leagueIds,
    log,
    onEvent: async (event) => {
      log("match event", { eventType: event.eventType, description: event.description });
      const tokens = await getAllPushTokens();
      await broadcastPassUpdate(tokens);
    },
  });

  watcher.start();
  log("watcher started");
}

// ─── main ─────────────────────────────────────────────────────────────────────

await startWatcher();

const server = Bun.serve({
  port: PORT,
  fetch: async (req) => {
    try {
      return await handleRequest(req);
    } catch (err) {
      log("request error", { err: String(err) });
      return new Response("Internal Server Error", { status: 500 });
    }
  },
});

log("server started", { port: PORT, serviceUrl: SERVICE_URL });

// self-restart backstop
let unhealthyStreak = 0;
setInterval(() => {
  const h = watcher?.health();
  if (!h || h.lastRefreshAtMs === 0) return;
  if (h.ok) { unhealthyStreak = 0; return; }
  unhealthyStreak++;
  log("health check failed", { unhealthyStreak, ...h });
  if (unhealthyStreak >= 2) {
    log("exiting for restart after sustained unhealthy state");
    process.exit(1);
  }
}, 60_000).unref();

const shutdown = () => {
  log("shutting down");
  watcher?.stop();
  server.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
