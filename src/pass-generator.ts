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

// certs loaded once at startup
const wwdr = readFileSync(join(ROOT, "wwdr.pem"));
const signerCert = readFileSync(join(ROOT, "pass-cert.pem"));
// private key: file on disk (local) or PASS_SIGNING_KEY env var (base64, for Render)
const signerKey = process.env.PASS_SIGNING_KEY
  ? Buffer.from(process.env.PASS_SIGNING_KEY, "base64")
  : readFileSync(join(ROOT, "pass-key.pem"));

// icons loaded once
const icon = readFileSync(join(ROOT, "assets", "icon.png"));
const icon2x = readFileSync(join(ROOT, "assets", "icon@2x.png"));
const icon3x = readFileSync(join(ROOT, "assets", "icon@3x.png"));
const logo = readFileSync(join(ROOT, "assets", "logo.png"));
const logo2x = readFileSync(join(ROOT, "assets", "logo@2x.png"));

export function getSerialNumber(): string {
  return SERIAL_NUMBER;
}

export function buildPassJson(webServiceURL: string): Record<string, unknown> {
  const state = getState();
  const liveMatches = [...state.liveMatches.values()];
  const layout =
    liveMatches.length > 0
      ? buildLiveLayout(liveMatches)
      : buildNoGameLayout(state.recentMatches, state.upcomingMatches);

  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: TEAM_ID,
    serialNumber: SERIAL_NUMBER,
    organizationName: "FIFA World Cup 2026",
    description: "FIFA World Cup 2026 Live Scores",
    backgroundColor: "rgb(0, 98, 51)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(200, 220, 200)",
    logoText: "World Cup",
    webServiceURL,
    authenticationToken: AUTH_TOKEN,
    generic: {
      headerFields: layout.headerFields,
      primaryFields: layout.primaryFields,
      secondaryFields: layout.secondaryFields,
      auxiliaryFields: layout.auxiliaryFields,
      backFields: layout.backFields,
    },
  };
}

export async function generatePass(webServiceURL: string): Promise<Buffer> {
  const passJson = buildPassJson(webServiceURL);

  const pass = new PKPass(
    {
      "icon.png": icon,
      "icon@2x.png": icon2x,
      "icon@3x.png": icon3x,
      "logo.png": logo,
      "logo@2x.png": logo2x,
      "pass.json": Buffer.from(JSON.stringify(passJson)),
    },
    { wwdr, signerCert, signerKey },
  );

  return pass.getAsBuffer();
}
