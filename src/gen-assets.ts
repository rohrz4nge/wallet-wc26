// Generates pass icon + background assets — run once with: bun src/gen-assets.ts
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "assets");
mkdirSync(ASSETS, { recursive: true });

const BG = { r: 0, g: 98, b: 51, alpha: 1 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function makeIcon(size: number, path: string): Promise<void> {
  const circle = Math.round(size * 0.55);
  const offset = Math.round((size - circle) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{
      input: await sharp({ create: { width: circle, height: circle, channels: 4, background: WHITE } }).png().toBuffer(),
      left: offset, top: offset, blend: "over",
    }])
    .png().toFile(path);
}

async function makeLogo(w: number, h: number, path: string): Promise<void> {
  await sharp({ create: { width: w, height: h, channels: 4, background: BG } }).png().toFile(path);
}

// background.png for eventTicket — resize source image to pass background dimensions
// Apple spec: 180×220 @1x, 360×440 @2x, 540×660 @3x
async function makeBackground(srcPath: string, w: number, h: number, path: string): Promise<void> {
  await sharp(srcPath)
    .resize(w, h, { fit: "cover", position: "top" })
    .png()
    .toFile(path);
}

const BG_SRC = process.env.BG_IMAGE_SRC ?? join(process.env.HOME ?? "", "Downloads", "image-gemini-3.1-flash-image.png");

if (!existsSync(BG_SRC)) {
  console.error(`Background source image not found at: ${BG_SRC}`);
  process.exit(1);
}

await Promise.all([
  makeIcon(29, join(ASSETS, "icon.png")),
  makeIcon(58, join(ASSETS, "icon@2x.png")),
  makeIcon(87, join(ASSETS, "icon@3x.png")),
  makeLogo(160, 50, join(ASSETS, "logo.png")),
  makeLogo(320, 100, join(ASSETS, "logo@2x.png")),
  makeBackground(BG_SRC, 180, 220, join(ASSETS, "background.png")),
  makeBackground(BG_SRC, 360, 440, join(ASSETS, "background@2x.png")),
  makeBackground(BG_SRC, 540, 660, join(ASSETS, "background@3x.png")),
]);

console.log("assets generated in", ASSETS);
