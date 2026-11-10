// Generates the Android launcher icons and splash from public/app-icon-v3.png. Run from the repo root:
//   node android-app/scripts/make-icons.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SRC = "public/app-icon-v3.png";
const RES = "android-app/android/app/src/main/res";
const BG = { r: 12, g: 12, b: 13, alpha: 1 };
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const ghost = async (box, scale) => {
  const g = Math.round(box * scale);
  const buf = await sharp(SRC).trim().resize(g, g, { fit: "inside" }).png().toBuffer();
  return sharp({ create: { width: box, height: box, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: buf, gravity: "center" }]).png().toBuffer();
};

for (const [d, m] of Object.entries(dens)) {
  const dir = path.join(RES, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  const legacy = Math.round(48 * m), fg = Math.round(108 * m);
  const fgBuf = await ghost(fg, 0.5);
  fs.writeFileSync(path.join(dir, "ic_launcher_foreground.png"), fgBuf);
  const squareBg = await sharp({ create: { width: legacy, height: legacy, channels: 4, background: BG } }).png().toBuffer();
  const g = await ghost(legacy, 0.62);
  const sq = await sharp(squareBg).composite([{ input: g }]).png().toBuffer();
  fs.writeFileSync(path.join(dir, "ic_launcher.png"), sq);
  const mask = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`);
  fs.writeFileSync(path.join(dir, "ic_launcher_round.png"), await sharp(sq).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer());
}
fs.mkdirSync(path.join(RES, "values"), { recursive: true });
fs.writeFileSync(path.join(RES, "values/ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0C0C0D</color>\n</resources>\n`);
// splash: dark background with the ghost centred (a layer-list so it is never stretched)
for (const dir of fs.readdirSync(RES).filter((x) => x.startsWith("drawable"))) {
  const f = path.join(RES, dir, "splash.png");
  if (fs.existsSync(f)) fs.rmSync(f);
}
fs.mkdirSync(path.join(RES, "drawable-nodpi"), { recursive: true });
fs.writeFileSync(path.join(RES, "drawable-nodpi/splash_ghost.png"), await sharp(SRC).trim().resize(240, 240, { fit: "inside" }).png().toBuffer());
fs.writeFileSync(path.join(RES, "drawable/splash.xml"), `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><shape android:shape="rectangle"><solid android:color="#0C0C0D"/></shape></item>
    <item android:gravity="center"><bitmap android:src="@drawable/splash_ghost" android:gravity="center"/></item>
</layer-list>
`);
// notification small icon: Android wants a plain white silhouette on transparent (24dp)
const stat = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };
for (const [d, px] of Object.entries(stat)) {
  const dir = path.join(RES, `drawable-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  const g = await sharp(SRC).trim().resize(Math.round(px * 0.8), Math.round(px * 0.8), { fit: "inside" }).ensureAlpha().toBuffer();
  const { data, info } = await sharp(g).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { const a = data[i + 3]; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = a; }
  const white = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const out = await sharp({ create: { width: px, height: px, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: white, gravity: "center" }]).png().toBuffer();
  fs.writeFileSync(path.join(dir, "ic_stat_wraith.png"), out);
}
console.log("icons done");
