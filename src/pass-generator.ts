import { PKPass } from "passkit-generator";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getState } from "./state.js";
import { buildLiveLayout, buildNoGameLayout } from "./pass-layout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PASS_TYPE_ID = process.env.PASS_TYPE_ID ?? "pass.com.max-lohmann.worldcup";
const TEAM_ID = process.env.TEAM_ID ?? "B7369J9TM3";
const AUTH_TOKEN = process.env.WALLET_AUTH_TOKEN ?? "";
const SERIAL_NUMBER = "worldcup-2026";

const wwdr = readFileSync(join(ROOT, "wwdr.pem"));
const signerCert = readFileSync(join(ROOT, "pass-cert.pem"));
const signerKey = process.env.PASS_SIGNING_KEY
  ? Buffer.from(process.env.PASS_SIGNING_KEY, "base64")
  : readFileSync(join(ROOT, "pass-key.pem"));

const icon = readFileSync(join(ROOT, "assets", "icon.png"));
const icon2x = readFileSync(join(ROOT, "assets", "icon@2x.png"));
const icon3x = readFileSync(join(ROOT, "assets", "icon@3x.png"));
const logo = readFileSync(join(ROOT, "assets", "logo.png"));
const logo2x = readFileSync(join(ROOT, "assets", "logo@2x.png"));
const background = readFileSync(join(ROOT, "assets", "background.png"));
const background2x = readFileSync(join(ROOT, "assets", "background@2x.png"));
const background3x = readFileSync(join(ROOT, "assets", "background@3x.png"));
const thumbnail = readFileSync(join(ROOT, "assets", "thumbnail.png"));
const thumbnail2x = readFileSync(join(ROOT, "assets", "thumbnail@2x.png"));
const thumbnail3x = readFileSync(join(ROOT, "assets", "thumbnail@3x.png"));

export function getSerialNumber(): string {
  return SERIAL_NUMBER;
}

export async function generatePass(webServiceURL: string): Promise<Buffer> {
  const state = getState();
  const liveMatches = [...state.liveMatches.values()];
  const layout =
    liveMatches.length > 0
      ? buildLiveLayout(liveMatches)
      : buildNoGameLayout(state.recentMatches, state.upcomingMatches);

  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: TEAM_ID,
    serialNumber: SERIAL_NUMBER,
    organizationName: "FIFA World Cup 2026",
    description: "FIFA World Cup 2026 Live Scores",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(255, 255, 255)",
    webServiceURL,
    authenticationToken: AUTH_TOKEN,
    generic: {},
  };

  const pass = new PKPass(
    {
      "pass.json": Buffer.from(JSON.stringify(passJson)),
      "icon.png": icon,
      "icon@2x.png": icon2x,
      "icon@3x.png": icon3x,
      "logo.png": logo,
      "logo@2x.png": logo2x,
      "background.png": background,
      "background@2x.png": background2x,
      "background@3x.png": background3x,
      "thumbnail.png": thumbnail,
      "thumbnail@2x.png": thumbnail2x,
      "thumbnail@3x.png": thumbnail3x,
    },
    { wwdr, signerCert, signerKey },
  );

  for (const f of layout.secondaryFields) pass.secondaryFields.push(f);
  for (const f of layout.auxiliaryFields) pass.auxiliaryFields.push(f);
  for (const f of layout.backFields) pass.backFields.push(f);

  return pass.getAsBuffer();
}
