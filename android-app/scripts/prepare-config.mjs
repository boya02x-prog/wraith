// Writes capacitor.config.json from capacitor.config.base.json.
//   node scripts/prepare-config.mjs                -> production (https://www.wraith.farm)
//   node scripts/prepare-config.mjs --dev          -> test build that loads http://localhost:3000 (use: adb reverse tcp:3000 tcp:3000)
// Push is switched on (user agent gets "WraithPush") only when android/app/google-services.json exists;
// without Firebase the push plugin would crash the app.
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync("capacitor.config.base.json", "utf8"));
const dev = process.argv.includes("--dev");
if (dev) {
  cfg.server.url = "http://localhost:3000/app";
  cfg.server.cleartext = true;
  cfg.android.allowMixedContent = true;
  cfg.android.webContentsDebuggingEnabled = true;
}
if (fs.existsSync("android/app/google-services.json")) cfg.appendUserAgent = `${cfg.appendUserAgent} WraithPush`;
fs.writeFileSync("capacitor.config.json", JSON.stringify(cfg, null, 2) + "\n");
console.log(dev ? "dev config" : "production config", "| push:", /WraithPush/.test(cfg.appendUserAgent));
