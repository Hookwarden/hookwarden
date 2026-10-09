// Single-file HTML report: the app with the scan embedded and no server.
// The app sees #hw-data and runs read-only (no scan, no fix buttons, no fetch).

import { APP_HTML } from "./generated/app-html.js";
import { contentSecurityPolicy } from "./server.js";

/** `scanJson` is the `hookwarden scan --format json` envelope as a string. */
export function renderReport(scanJson: string): string {
  // `<` → < so finding text can never close the <script> tag; JSON.parse undoes it.
  const data = scanJson.trim().replaceAll("<", "\\u003c");
  // Same policy as the server, minus fetch: a shared report must not phone home.
  const csp = contentSecurityPolicy(APP_HTML).replace("connect-src 'self'", "connect-src 'none'");
  return APP_HTML.replace(
    "<head>",
    () => `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`,
  ).replace(
    "<!--hw-data-->",
    () => `<script type="application/json" id="hw-data">${data}</script>`,
  );
}
