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

// transparent logo so background image shows through the logo area
async function makeTransparentLogo(w: number, h: number, path: string): Promise<void> {
  await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png().toFile(path);
}

// background.png: full pass width so no upscaling blur on modern iPhones.
// Real pass render width is 375pt; @3x = 1125px. Use generous height to fill the pass.
// Dark gradient overlay on bottom 1/3 only — top 2/3 stays completely sharp.
async function makeBackground(srcPath: string, w: number, h: number, path: string): Promise<void> {
  const base = await sharp(srcPath)
    .resize(w, h, { fit: "cover", position: "top" })
    .png()
    .toBuffer();

  // gradient covers only the bottom 1/3 — fades from transparent to dark for text readability
  const fadeH = Math.round(h / 3);
  const fadeTop = h - fadeH;

  const gradient = Buffer.from(
    `<svg width="${w}" height="${fadeH}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="black" stop-opacity="0"/>
          <stop offset="100%" stop-color="black" stop-opacity="0.6"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${fadeH}" fill="url(#g)"/>
    </svg>`
  );

  await sharp(base)
    .composite([{ input: gradient, left: 0, top: fadeTop, blend: "over" }])
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
  makeTransparentLogo(160, 50, join(ASSETS, "logo.png")),
  makeTransparentLogo(320, 100, join(ASSETS, "logo@2x.png")),
  // full pass width (375pt) at each density to avoid upscale blur on modern iPhones
  makeBackground(BG_SRC, 375, 500, join(ASSETS, "background.png")),
  makeBackground(BG_SRC, 750, 1000, join(ASSETS, "background@2x.png")),
  makeBackground(BG_SRC, 1125, 1500, join(ASSETS, "background@3x.png")),
]);

console.log("assets generated in", ASSETS);
