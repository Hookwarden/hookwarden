// Local UI server. Serves the embedded app and a small JSON API whose work is
// done by handlers the CLI injects (so this package never imports the CLI).
//
// It can write files (fix/apply), so every request is gated:
//   - bound to 127.0.0.1 only
//   - Host must be 127.0.0.1:<port> or localhost:<port> (DNS-rebinding guard)
//   - /api/* requires the per-launch bearer token (constant-time compare)
//   - `file` must resolve inside the launch root
//   - requests are serialized, so two applies never interleave

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { APP_HTML } from "./generated/app-html.js";

export interface FixTarget {
  readonly ruleId: string;
  /** Path relative to the launch root, as reported in findings. */
  readonly file: string;
}

export interface FixPreviewEdit {
  readonly file: string;
  readonly start: { readonly line: number; readonly col: number };
  readonly end: { readonly line: number; readonly col: number };
  readonly before: string;
  readonly after: string;
  readonly safety: "safe" | "unsafe" | "manual-only";
}

export interface UiHandlers {
  /** Returns the `hookwarden scan --format json` envelope, parsed. */
  scan(): Promise<object>;
  previewFix(target: FixTarget): Promise<ReadonlyArray<FixPreviewEdit>>;
  /** Applies the safe edits for the target, then returns the applied count and a fresh scan. */
  applyFix(target: FixTarget): Promise<{ readonly applied: number; readonly scan: object }>;
}

export interface UiServerOptions {
  readonly root: string;
  readonly handlers: UiHandlers;
  /** 0 (default) picks a free port. */
  readonly port?: number;
}

export interface UiServer {
  /** Open this URL; the token travels in the fragment, never in a request line or Referer. */
  readonly url: string;
  readonly port: number;
  readonly token: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 64 * 1024;
const RULE_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export async function startUiServer(opts: UiServerOptions): Promise<UiServer> {
  const root = path.resolve(opts.root);
  const token = randomBytes(24).toString("base64url");
  const tokenBuf = Buffer.from(`Bearer ${token}`);
  const csp = contentSecurityPolicy(APP_HTML);
  let port = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const server = createServer((req, res) => {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return send(res, 403, { error: "forbidden host" });
    }
    const url = new URL(req.url ?? "/", `http://${host}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": csp,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      return res.end(APP_HTML);
    }
    if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });

    const auth = Buffer.from(req.headers.authorization ?? "");
    if (auth.length !== tokenBuf.length || !timingSafeEqual(auth, tokenBuf)) {
      return send(res, 401, {
        error: "missing or invalid token — reopen the URL printed by `hookwarden ui`",
      });
    }

    // One request at a time: a scan must not run while an apply is rewriting files.
    const run = queue.then(() => route(url.pathname, req, root, opts.handlers));
    queue = run.catch(() => undefined);
    run.then(
      (body) => send(res, 200, body),
      (e: unknown) => {
        const status = e instanceof HttpError ? e.status : 500;
        send(res, status, { error: e instanceof Error ? e.message : String(e) });
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  port = typeof addr === "object" && addr !== null ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}/#t=${token}`,
    port,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function route(
  pathname: string,
  req: IncomingMessage,
  root: string,
  h: UiHandlers,
): Promise<object> {
  const body = await readJson(req);
  switch (pathname) {
    case "/api/scan":
      return { root, ...(await h.scan()) };
    case "/api/fix/preview":
      return { edits: await h.previewFix(fixTarget(body, root)) };
    case "/api/fix/apply": {
      const r = await h.applyFix(fixTarget(body, root));
      return { root, applied: r.applied, ...r.scan };
    }
    default:
      throw new HttpError(404, "not found");
  }
}

/** Validates a fix request and confines `file` to the launch root. */
export function fixTarget(body: unknown, root: string): FixTarget {
  const b = (body ?? {}) as Record<string, unknown>;
  const { ruleId, file } = b;
  if (typeof ruleId !== "string" || !RULE_ID.test(ruleId))
    throw new HttpError(400, "invalid ruleId");
  if (typeof file !== "string" || file === "" || path.isAbsolute(file) || file.includes("\0")) {
    throw new HttpError(400, "file must be a path relative to the scanned folder");
  }
  const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new HttpError(400, "file is outside the scanned folder");
  }
  return { ruleId, file };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
}

/** Allows only the app's own inline script and style (by hash / inline), and same-origin fetch. */
export function contentSecurityPolicy(html: string): string {
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(
    (m) =>
      `'sha256-${createHash("sha256")
        .update(m[1] ?? "")
        .digest("base64")}'`,
  );
  return [
    "default-src 'none'",
    `script-src ${scripts.join(" ") || "'none'"}`,
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
