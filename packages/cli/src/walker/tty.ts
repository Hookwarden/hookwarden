// D-43: TTY/env helper used to gate color output, OSC-8 hyperlinks, and (in Phase 4) the
// `--color always|never|auto` flag. Returns false in CI / NO_COLOR / non-TTY environments
// so the same stream is human-readable AND CI-log safe by default.

export interface AnsiEnv {
  readonly NO_COLOR?: string;
  readonly CI?: string;
}

export function shouldUseAnsi(
  stream: { isTTY?: boolean } | undefined,
  env: AnsiEnv = process.env,
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.CI !== undefined && env.CI !== "" && env.CI !== "0" && env.CI !== "false") return false;
  if (!stream || stream.isTTY !== true) return false;
  return true;
}
