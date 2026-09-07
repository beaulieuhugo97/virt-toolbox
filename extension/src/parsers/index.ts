// Parsers turn captured output into a rendered table. A parser maps an action's
// `parse` id to a function producing { columns, rows }. The webview renders the
// result as a real, sortable HTML table. Most parsers read stdout; a parser may
// also read the action's structured output file via `ctx.outputFile`. A parser
// returns undefined when it matches nothing — the raw log is always shown
// regardless, so parsing is a best-effort enhancement.
//
// No virtualization tool declares `parse:` yet: virsh and virt-install are
// interactive and run in a terminal rather than being captured. The hook is kept
// because the engine and the output view are built on it — register a parser
// here and reference its id from an action's `parse` to light it up.

export interface ParsedTable {
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface ParseContext {
  /** Absolute path of the action's output file, if it declared one. */
  outputFile?: string;
}

export type Parser = (stdout: string, ctx?: ParseContext) => ParsedTable | undefined;

const REGISTRY: Record<string, Parser> = {};

export function getParser(id: string | undefined): Parser | undefined {
  return id ? REGISTRY[id] : undefined;
}
