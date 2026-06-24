// Raw .pkpass builder — bypasses passkit-generator's type validation so we can
// include posterGeneric (unblurred background) alongside generic (fallback).
// A .pkpass is just: manifest.json + PKCS7 signature + images + pass.json, all zipped.

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function buildPkpass(
  files: Record<string, Buffer>,
  signerCert: Buffer,
  signerKey: Buffer,
  wwdr: Buffer,
): Promise<Buffer> {
  // 1. manifest.json — SHA256 of every file
  const manifest: Record<string, string> = {};
  for (const [name, buf] of Object.entries(files)) {
    manifest[name] = createHash("sha256").update(buf).digest("hex");
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest));

  const tmp = mkdtempSync(join(tmpdir(), "pkpass-"));
  try {
    // write all files to temp dir
    for (const [name, buf] of Object.entries(files)) {
      writeFileSync(join(tmp, name), buf);
    }
    writeFileSync(join(tmp, "manifest.json"), manifestBuf);
    writeFileSync(join(tmp, "_cert.pem"), signerCert);
    writeFileSync(join(tmp, "_key.pem"), signerKey);
    writeFileSync(join(tmp, "_wwdr.pem"), wwdr);

    // 2. PKCS7 detached signature of manifest.json
    execSync(
      `openssl smime -sign -binary -noattr \
        -in "${join(tmp, "manifest.json")}" \
        -signer "${join(tmp, "_cert.pem")}" \
        -inkey "${join(tmp, "_key.pem")}" \
        -certfile "${join(tmp, "_wwdr.pem")}" \
        -outform DER \
        -out "${join(tmp, "signature")}"`,
      { stdio: "pipe" },
    );

    // 3. zip — store only (no compression), flat structure
    const allNames = [
      ...Object.keys(files),
      "manifest.json",
      "signature",
    ];
    execSync(
      `cd "${tmp}" && zip -0 -j pass.pkpass ${allNames.join(" ")}`,
      { stdio: "pipe" },
    );

    return readFileSync(join(tmp, "pass.pkpass"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
