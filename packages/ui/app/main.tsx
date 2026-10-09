import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import "./styles.css";

// Mirrors the `hookwarden scan --format json` envelope (packages/cli/src/render/json.ts).
interface Finding {
  finding_id: string;
  rule_id: string;
  provider: string | null;
  severity: Severity;
  state: "verified" | "not-verified" | "manual-review";
  file_path: string;
  location: { line: number; col: number };
  message: string;
  references: string[];
  redacted_snippet: string | null;
  suppressed: { source: string } | null;
}
interface Scan {
  scan: {
    scanned_at: string;
    findings: Finding[];
    inventory: unknown[];
    total_files_count: number;
    parse_errors_count: number;
  };
}
interface Edit {
  file: string;
  start: { line: number; col: number };
  before: string;
  after: string;
  safety: "safe" | "unsafe" | "manual-only";
}
type Severity = "critical" | "high" | "medium" | "low" | "info";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

// Report mode: the scan is embedded in the page and there is no server.
const embedded = document.getElementById("hw-data")?.textContent;
const REPORT: Scan | null = embedded ? (JSON.parse(embedded) as Scan) : null;
const TOKEN = new URLSearchParams(location.hash.slice(1)).get("t") ?? "";

async function api<T>(route: string, body: unknown = {}): Promise<T> {
  const res = await fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function App() {
  const [scan, setScan] = useState<Scan | null>(REPORT);
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sev, setSev] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [provider, setProvider] = useState("all");
  const [query, setQuery] = useState("");

  async function runScan() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<Scan & { root: string }>("/api/scan");
      setScan(r);
      setRoot(r.root);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (REPORT === null) void runScan();
  }, []);

  const findings = scan?.scan.findings ?? [];
  const providers = useMemo(
    () => [...new Set(findings.map((f) => f.provider ?? "unknown"))].sort(),
    [findings],
  );
  const visible = findings.filter(
    (f) =>
      sev.has(f.severity) &&
      (provider === "all" || (f.provider ?? "unknown") === provider) &&
      (query === "" ||
        `${f.rule_id} ${f.file_path} ${f.message}`.toLowerCase().includes(query.toLowerCase())),
  );
  const current = findings.find((f) => f.finding_id === selected) ?? null;
  const counts = SEVERITIES.map(
    (s) => [s, findings.filter((f) => f.severity === s && !f.suppressed).length] as const,
  );

  return (
    <div class="layout">
      <header>
        <div class="brand">
          hookwarden<span class="muted">{REPORT ? " report" : root ? ` · ${root}` : ""}</span>
        </div>
        <div class="counts">
          {counts.map(([s, n]) => (
            <span key={s} class={`pill sev-${s}`}>
              {n} {s}
            </span>
          ))}
        </div>
        {REPORT === null && (
          <button type="button" class="primary" disabled={busy} onClick={() => void runScan()}>
            {busy ? "Scanning…" : "Re-scan"}
          </button>
        )}
      </header>
      {error && <div class="error">{error}</div>}
      {notice && (
        <div class="notice" role="status">
          {notice}
        </div>
      )}
      <aside>
        <input
          type="search"
          placeholder="Filter by rule, file or message"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <div class="filters">
          {SEVERITIES.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={sev.has(s)}
                onChange={() => {
                  const next = new Set(sev);
                  next.has(s) ? next.delete(s) : next.add(s);
                  setSev(next);
                }}
              />
              {s}
            </label>
          ))}
          <select
            value={provider}
            onChange={(e) => setProvider((e.target as HTMLSelectElement).value)}
          >
            <option value="all">All providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <ul class="list">
          {visible.map((f) => (
            <li key={f.finding_id}>
              <button
                type="button"
                class={f.finding_id === selected ? "row active" : "row"}
                onClick={() => setSelected(f.finding_id)}
              >
                <span class={`dot sev-${f.severity}`} title={f.severity} />
                <span class="rule">{f.rule_id}</span>
                <span class="loc">
                  {f.file_path}:{f.location.line}
                </span>
              </button>
            </li>
          ))}
          {scan && visible.length === 0 && <li class="muted pad">No findings match.</li>}
          {!scan && !error && <li class="muted pad">Scanning…</li>}
        </ul>
      </aside>
      <main>
        {current ? (
          <Detail
            key={current.finding_id}
            f={current}
            onApplied={(s, msg) => {
              setScan(s);
              setNotice(msg);
            }}
          />
        ) : (
          <div class="empty muted">
            {scan
              ? `${findings.length} findings across ${scan.scan.total_files_count} files. Select one.`
              : ""}
          </div>
        )}
      </main>
    </div>
  );
}

function Detail({ f, onApplied }: { f: Finding; onApplied: (s: Scan, msg: string) => void }) {
  const [edits, setEdits] = useState<Edit[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const body = { ruleId: f.rule_id, file: f.file_path };

  async function preview() {
    setStatus(null);
    try {
      const r = await api<{ edits: Edit[] }>("/api/fix/preview", body);
      setEdits(r.edits);
      if (r.edits.length === 0)
        setStatus("hookwarden has no automatic fix for this finding. Follow the guidance above.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function apply() {
    setStatus("Applying…");
    try {
      const r = await api<Scan & { applied: number }>("/api/fix/apply", body);
      setStatus(null);
      setEdits(null);
      onApplied(r, `Applied ${r.applied} edit(s) to ${f.file_path} and re-scanned.`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  const safe = edits?.filter((e) => e.safety === "safe") ?? [];
  return (
    <article>
      <div class="title">
        <span class={`pill sev-${f.severity}`}>{f.severity}</span>
        <span class="pill">{f.state}</span>
        {f.suppressed && <span class="pill">suppressed ({f.suppressed.source})</span>}
        <h1>{f.rule_id}</h1>
      </div>
      <p class="loc">
        {f.file_path}:{f.location.line}:{f.location.col}
        {f.provider ? ` · ${f.provider}` : ""}
      </p>
      <p class="message">{f.message}</p>
      {f.redacted_snippet && <pre class="code">{f.redacted_snippet}</pre>}
      {f.references.length > 0 && (
        <ul class="refs">
          {f.references.map((r) => (
            <li key={r}>
              <a href={r} target="_blank" rel="noreferrer noopener">
                {r}
              </a>
            </li>
          ))}
        </ul>
      )}
      {REPORT === null && (
        <section class="fix">
          <div class="actions">
            <button type="button" onClick={() => void preview()}>
              Preview fix
            </button>
            {safe.length > 0 && (
              <button type="button" class="primary" onClick={() => void apply()}>
                Apply {safe.length} safe edit{safe.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
          {status && <p class="muted">{status}</p>}
          {edits?.map((e) => (
            <div class="diff" key={`${e.file}:${e.start.line}:${e.start.col}`}>
              <div class="diff-head">
                {e.file}:{e.start.line} · {e.safety}
                {e.safety !== "safe" && " — review and apply by hand"}
              </div>
              <pre class="del">{e.before}</pre>
              <pre class="add">{e.after}</pre>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

const root = document.getElementById("app");
if (root) render(<App />, root);
