// `hookwarden logo` Easter-egg subcommand. Prints the mascot + wordmark, scaled
// to fit the caller's terminal. Original mascot is 90×44 and the wordmark is
// 108×5 — both are downsampled (nearest-neighbor) when the terminal can't
// accommodate the full size. Renders in the locked indigo accent (#6366F1)
// when ANSI is allowed.

const ACCENT_RGB = "99;102;241"; // #6366F1 — locked brand indigo (matches banner.ts).

const MASCOT_SOURCE = `@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%%%%%%%%%%%%%%%%%%%%%%%%%@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%#*+=-:::::::%%++*%%%%%%%%%%%%%%%%%%%%%%%%%%%%@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%*==@+           .%*     :=*%%%%%%%%%%%%%%%%%%%%%%%%%@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%+:    *%           +%.         :+%%%%%%%%%%%%%%%%%%%%%%@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#-       .%=          %+           .+%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@*:          +%         =%.          =%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@@@@@@@#:            .%+-======-%*         =%%%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@@@@@@%*:        .-+#%#++=----=+*#%*=:   =#%%%%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@@@@@= -##=.   -#%*-.              :=#%+#%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@@@@=    .=#*=%#-                     .+%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@@@#       :%%-                         .+%%%%%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@@@:      =%*                             -%%%%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@@#      -%*                               :%%%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@@*     .%#                                 =%%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@%*     +%=              =-:                 %%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@@%#     #%.             .+####*=-.           #%%%%%%%%%%%%%%%%%%%%%%%%
@@@@@@@@@@@@@@@@@@@@%%%.    %%.                .-*###%%#+=:.     *%%%%%%%%%%%%%%%%%%%%%%%@
@@@@@@@@@@@@@@@@@@@@%%%*  :#%%+.                   :=#%%%%%%#*=-.#%%%%%%%%%%%%%%%%%%%%%%@@
@@@@@@@@@@@@@@@@@@@@%%%%+*%%%%%%#=.                   .-+%%%%=+#%%%%%%%%%%%%%%%%%%%%%%%@@@
@@@@@@@@@@@@@@@@@@@@@%%%%%%%%%%%%%%*:                    *%%%    #%%%%%%%%%%%%%%%%%%%%@@@@
@@@@@@@@@@@@@@@@@@@@@%%%%%%%%%%%%%%%%#+:                 *%%%    *%%%%%%%%%%%%%%%%%%@@@@@@
@@@@@@@@@@@@@@@@@@@@@@%%%%%%%%%%%%%%%%%%#=.              *%%%    *%%%%%%%%%%%%%%@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@%%%%%%%%%%%%%%%%%%%%#-            *%%%    *%%%%%%%%%%%%@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@%%%%%%%%%%%%%%%%%%%%%#-          *%%%    *%%%%%%%%%@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@%%%%%%%%%%%%%%%%%%%%%%*.        *%%%    #%%%%%@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@#%@@%%%%%%%%%%%%%%%%%%%%%%%:       *%%%    #%%%@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@..+%@@%%%%%%%%%%%%%%%%%%%%%%.      *%%%    #@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@.   =%@@@%%%%%%%%%%%%%%%%%%%*      *%@@=   #@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@.     -#@@@@%%%%%%%%%%%%%%%%%      #@@@@%=.#@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@.       :*@@@@@@@@%%%%%%%%%%@.     #@@@@@@%%@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@.    =%%%%@@@@@@@@@@@@@@@@@@%      #@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@:    -@@@@@@@@@@@@@@@@@@@@@@*      @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@-    .%@@@@@@@@@@@@@@@@@@@@%.     -@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@#     -@@@@@@@@@@@@@@@@@@@%:      %@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@=     :%@@@@@@@@@@@@@@@@*.      #@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@=      -#@@@@@@@@@@@%*:       #@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@*       .-+*###*+=:        :%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@%=                      :*@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@*-                :+%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%*=-::...:-=+#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@`;

const WORDMARK_SOURCE = ` _|    _|                      _|                                                    _|
 _|    _|    _|_|      _|_|    _|  _|  _|      _|      _|    _|_|_|  _|  _|_|    _|_|_|    _|_|    _|_|_|
 _|_|_|_|  _|    _|  _|    _|  _|_|    _|      _|      _|  _|    _|  _|_|      _|    _|  _|_|_|_|  _|    _|
 _|    _|  _|    _|  _|    _|  _|  _|    _|  _|  _|  _|    _|    _|  _|        _|    _|  _|        _|    _|
 _|    _|    _|_|      _|_|    _|    _|    _|      _|        _|_|_|  _|          _|_|_|    _|_|_|  _|    _|`;

const MASCOT_LINES: ReadonlyArray<string> = MASCOT_SOURCE.split("\n");
const WORDMARK_LINES: ReadonlyArray<string> = WORDMARK_SOURCE.split("\n");

const MASCOT_ORIG_COLS = MASCOT_LINES[0]?.length ?? 0;
const MASCOT_ORIG_ROWS = MASCOT_LINES.length;
const WORDMARK_ORIG_COLS = Math.max(...WORDMARK_LINES.map((l) => l.length));
const WORDMARK_ORIG_ROWS = WORDMARK_LINES.length;

// Nearest-neighbor downscale of a fixed-width ASCII grid. Aspect-ratio aware:
// each terminal cell is ~2x as tall as wide, so the row stride is doubled
// relative to the column stride to preserve the visual silhouette.
function scaleAscii(
  art: ReadonlyArray<string>,
  origCols: number,
  origRows: number,
  targetCols: number,
): string[] {
  if (targetCols >= origCols) return art.map((l) => l.padEnd(origCols, " "));
  const colScale = origCols / targetCols;
  // Terminal cells are ~2:1 (height:width), so visually we scale rows by half
  // the column factor — this keeps the silhouette from squashing.
  const targetRows = Math.max(1, Math.round(origRows / Math.max(1, colScale * 2)));
  const rowScale = origRows / targetRows;
  const out: string[] = [];
  for (let r = 0; r < targetRows; r++) {
    const srcRow = Math.min(origRows - 1, Math.floor(r * rowScale));
    const sourceLine = art[srcRow] ?? "";
    let line = "";
    for (let c = 0; c < targetCols; c++) {
      const srcCol = Math.min(origCols - 1, Math.floor(c * colScale));
      line += sourceLine[srcCol] ?? " ";
    }
    out.push(line);
  }
  return out;
}

export interface LogoOptions {
  readonly columns: number;
  readonly useAnsi: boolean;
}

export function renderLogo(opts: LogoOptions): string {
  const accent = (text: string): string =>
    opts.useAnsi ? `\x1b[38;2;${ACCENT_RGB}m${text}\x1b[0m` : text;

  // Reserve 4 cols of margin (2 left, 2 right) so the art doesn't kiss the edges.
  const usable = Math.max(20, opts.columns - 4);

  const mascotWidth = Math.min(usable, MASCOT_ORIG_COLS);
  const mascot = scaleAscii(MASCOT_LINES, MASCOT_ORIG_COLS, MASCOT_ORIG_ROWS, mascotWidth);

  // The wordmark uses 2-cell "_|" units; downsampling destroys readability.
  // Render at full width when the terminal can fit it; otherwise drop it and
  // fall back to a plain-text caption so the output stays clean on narrow
  // terminals (CI logs, split panes).
  const showWordmark = usable >= WORDMARK_ORIG_COLS;

  const lines: string[] = [""];
  for (const l of mascot) lines.push(`  ${accent(l)}`);
  lines.push("");
  if (showWordmark) {
    for (const l of WORDMARK_LINES) lines.push(`  ${accent(l)}`);
  } else {
    lines.push(`  ${accent("hookwarden")}`);
  }
  lines.push("");
  return lines.join("\n");
}

// Exposed for tests and for callers that need to know the source-art bounds.
export const LOGO_DIMENSIONS = {
  mascot: { cols: MASCOT_ORIG_COLS, rows: MASCOT_ORIG_ROWS },
  wordmark: { cols: WORDMARK_ORIG_COLS, rows: WORDMARK_ORIG_ROWS },
} as const;
