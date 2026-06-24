// Generates pass icon assets — run once with: bun src/gen-assets.ts
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "assets");
mkdirSync(ASSETS, { recursive: true });

const BG = { r: 0, g: 98, b: 51, alpha: 1 };     // FIFA green
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// icon — green square with white football circle
async function makeIcon(size: number, path: string): Promise<void> {
  const circle = Math.round(size * 0.55);
  const offset = Math.round((size - circle) / 2);
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{
      input: await sharp({
        create: { width: circle, height: circle, channels: 4, background: WHITE },
      })
        .png()
        .toBuffer(),
      left: offset,
      top: offset,
      blend: "over",
    }])
    .png()
    .toFile(path);
}

// logo — wider green banner
async function makeLogo(w: number, h: number, path: string): Promise<void> {
  await sharp({
    create: { width: w, height: h, channels: 4, background: BG },
  })
    .png()
    .toFile(path);
}

await Promise.all([
  makeIcon(29, join(ASSETS, "icon.png")),
  makeIcon(58, join(ASSETS, "icon@2x.png")),
  makeIcon(87, join(ASSETS, "icon@3x.png")),
  makeLogo(160, 50, join(ASSETS, "logo.png")),
  makeLogo(320, 100, join(ASSETS, "logo@2x.png")),
]);

console.log("assets generated in", ASSETS);
