// Digital Asset Links: lets the Android app (Trusted Web Activity) open wraith.farm full screen, without a browser bar.
// Set ANDROID_SHA256 (comma-separated, from `bubblewrap fingerprint` / Play Console app signing) in Vercel.
import { NextResponse } from "next/server";

export const dynamic = "force-static"; // served as a static file from the CDN: Chrome checks this on every app launch, so it must be fast

// Public signing fingerprints of the Wraith Android app (not secrets). The first is the older Chrome-wrapper build,
// the second is the current native app. ANDROID_SHA256 can still add more.
const BUILT_IN = [
  "58:3D:9E:D7:71:43:00:01:A0:7C:E5:63:4E:15:7A:09:11:EA:B9:A1:59:FB:BC:0B:3A:21:27:EF:6A:F6:38:73",
  "45:31:DD:20:AE:CF:73:BD:7F:80:21:BC:51:98:58:55:C3:20:AB:36:E4:72:AA:41:C5:66:4D:39:9E:F5:A4:19",
];

export function GET() {
  const prints = [...new Set([...BUILT_IN, ...(process.env.ANDROID_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean)])];
  // handle_all_urls: open wraith.farm links in the app. get_login_creds: let the app use passkeys / saved sign-ins for this domain.
  const pkg = process.env.ANDROID_PACKAGE ?? "farm.wraith.app";
  const body = prints.length
    ? ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"].map((relation) => ({
        relation: [relation],
        target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints },
      }))
    : [];
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
}
