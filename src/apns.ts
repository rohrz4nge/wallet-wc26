import { connect, type ClientHttp2Session } from "node:http2";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PASS_TYPE_ID = process.env.PASS_TYPE_ID ?? "pass.com.max-lohmann.worldcup";
const APNS_HOST = "api.push.apple.com";

let client: ClientHttp2Session | null = null;

function getClient(): ClientHttp2Session {
  if (client && !client.destroyed && !client.closed) return client;
  client = connect(`https://${APNS_HOST}`, {
    cert: readFileSync(join(ROOT, "pass-cert.pem")),
    key: readFileSync(join(ROOT, "pass-key.pem")),
  });
  client.on("error", (err) => {
    log(`[apns] connection error: ${String(err)}`);
    client?.destroy();
    client = null;
  });
  client.on("close", () => { client = null; });
  return client;
}

function log(msg: string): void {
  console.log(msg);
}

export async function sendPassUpdate(pushToken: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const session = getClient();
      const path = `/3/device/${pushToken}`;
      const req = session.request({
        ":method": "POST",
        ":path": path,
        ":scheme": "https",
        ":authority": APNS_HOST,
        "apns-topic": PASS_TYPE_ID,
        "apns-push-type": "background",
        "apns-priority": "5",
        "apns-expiration": "0",
        "content-type": "application/json",
        "content-length": "2",
      });

      req.write("{}");
      req.end();

      let status = 0;
      req.on("response", (headers) => {
        status = Number(headers[":status"]);
      });

      req.on("end", () => {
        if (status === 200) {
          resolve(true);
        } else {
          log(`[apns] push failed with status ${status} for token ${pushToken.slice(0, 8)}…`);
          resolve(false);
        }
      });

      req.on("error", (err) => {
        log(`[apns] request error: ${String(err)}`);
        resolve(false);
      });

      req.setTimeout(10_000, () => {
        log(`[apns] request timeout for token ${pushToken.slice(0, 8)}…`);
        req.destroy();
        resolve(false);
      });
    } catch (err) {
      log(`[apns] sendPassUpdate threw: ${String(err)}`);
      resolve(false);
    }
  });
}

export async function broadcastPassUpdate(pushTokens: string[]): Promise<void> {
  if (pushTokens.length === 0) return;
  log(`[apns] broadcasting to ${pushTokens.length} device(s)`);
  const results = await Promise.allSettled(pushTokens.map((t) => sendPassUpdate(t)));
  const ok = results.filter((r) => r.status === "fulfilled" && r.value).length;
  log(`[apns] broadcast done: ${ok}/${pushTokens.length} delivered`);
}
