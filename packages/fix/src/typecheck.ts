// Phase 8.2 D-11 condition 5: sandbox tsc check on staged TypeScript files
// BEFORE the atomic rename. Catches type errors introduced by the rewrite
// (e.g., `crypto.timingSafeEqual` expecting Buffer when the user passed string)
// without spending compile time on untouched files.
//
// Loads `typescript` via dynamic import so the dep stays soft — users running
// `hookwarden scan` (read-only) don't pay the TypeScript-compiler install
// cost, and users running `hookwarden fix` against non-TS files don't either.
// If `typescript` isn't installed in the user's project, this module returns
// `{ ok: true, errors: [], skipped: true }` with a reason so the CLI can warn
// the user the safety gate didn't run.
//
// I/O module: reads typescript module + project tsconfig via dynamic import +
// the supplied virtual file host. Explicit fs touch-point bounded to here.

export interface TypeCheckError {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly message: string;
}

export interface TypeCheckResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<TypeCheckError>;
  readonly skipped: boolean;
  readonly skipReason?: string;
}

export interface TypeCheckInput {
  readonly projectRoot: string;
  // absPath → post-edit contents. Only TS/TSX/JSX/JS files are checked.
  readonly stagedFiles: ReadonlyMap<string, string>;
}

const TS_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx", ".cts", ".mts"]);

export async function typecheckStagedFiles(input: TypeCheckInput): Promise<TypeCheckResult> {
  // Filter to TS files — JS files are valid TS-from-JS but type errors there
  // are usually noise from missing types in user dependencies.
  const tsStagedFiles = new Map<string, string>();
  for (const [abs, contents] of input.stagedFiles) {
    const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
    if (TS_EXTENSIONS.has(ext)) tsStagedFiles.set(abs, contents);
  }
  if (tsStagedFiles.size === 0) {
    return { ok: true, errors: [], skipped: true, skipReason: "no TypeScript files in stage" };
  }
  // Soft dep — dynamic import so install of typescript stays optional.
  let tsModule: typeof import("typescript");
  try {
    tsModule = (await import("typescript")).default ?? (await import("typescript"));
  } catch {
    return {
      ok: true,
      errors: [],
      skipped: true,
      skipReason:
        "typescript not installed — install `typescript` in your project to enable D-11 condition 5 type-check",
    };
  }
  const ts = tsModule;
  // Find + parse the project's tsconfig.
  const configPath = ts.findConfigFile(input.projectRoot, ts.sys.fileExists, "tsconfig.json");
  if (configPath === undefined) {
    return {
      ok: true,
      errors: [],
      skipped: true,
      skipReason: "no tsconfig.json found in project — type-check skipped",
    };
  }
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error !== undefined) {
    return {
      ok: true,
      errors: [],
      skipped: true,
      skipReason: `tsconfig.json parse error — type-check skipped`,
    };
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, input.projectRoot);
  // Build a CompilerHost that substitutes staged contents for touched files
  // and falls through to the disk for everything else.
  const baseHost = ts.createCompilerHost(parsed.options, true);
  const host: import("typescript").CompilerHost = {
    ...baseHost,
    readFile(fileName: string): string | undefined {
      const staged = tsStagedFiles.get(fileName);
      if (staged !== undefined) return staged;
      return baseHost.readFile(fileName);
    },
    fileExists(fileName: string): boolean {
      if (tsStagedFiles.has(fileName)) return true;
      return baseHost.fileExists(fileName);
    },
  };
  // Program rooted at the staged files only — keeps compile time minimal.
  const program = ts.createProgram({
    rootNames: Array.from(tsStagedFiles.keys()),
    options: parsed.options,
    host,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  // Filter to diagnostics inside the staged files only — diagnostics from
  // imported modules (user's existing code) are not our responsibility here.
  const errors: TypeCheckError[] = [];
  for (const diag of diagnostics) {
    if (diag.file === undefined || diag.start === undefined) continue;
    const fileName = diag.file.fileName;
    if (!tsStagedFiles.has(fileName)) continue;
    const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
    errors.push({
      file: fileName,
      line: line + 1,
      col: character + 1,
      message: ts.flattenDiagnosticMessageText(diag.messageText, "\n"),
    });
  }
  return { ok: errors.length === 0, errors, skipped: false };
}
