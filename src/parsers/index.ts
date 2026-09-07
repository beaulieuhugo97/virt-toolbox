// Parsers turn captured output into a rendered table. A parser maps an action's
// `parse` id to a function producing { columns, rows }. The webview renders the
// result as a real, sortable HTML table. Most parsers read stdout; a parser may
// also read the action's structured output file via `ctx.outputFile`. A parser
// returns undefined when it matches nothing — the raw log is always shown
// regardless, so parsing is a best-effort enhancement.
//
// Parsers are keyed by output SHAPE, not by tool: `docker.ps` is what the
// containers tool, the networks tool's "containers on this network", the volumes
// tool's "containers using it" and the compose tool's project view all render,
// because all four run `docker ps` with the same --format. The virsh tools
// declare no `parse:` — they are interactive and run in a terminal.

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

// ── shapes ───────────────────────────────────────────────────────────────────
// Docker's `--format` with tab separators produces one record per line and no
// header, which is the same shape for containers, images, networks, volumes and
// layer history. So a listing is fully described by its column headers and the
// factory writes the parser. Each parser's column list and the --format template
// it is paired with in the manifest must stay the same length.

/** Split a `\t`-separated, header-less listing into rows of exactly `columns.length`. */
function tabular(columns: string[], title?: string): Parser {
  return (stdout) => {
    const rows = stdout
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const cells = line.split("\t");
        // A value that itself contains a tab (an image's CreatedBy, say) would
        // otherwise shift every column right of it; fold the overflow back into
        // the last cell, and pad a short row so the table stays rectangular.
        if (cells.length > columns.length) {
          const tail = cells.slice(columns.length - 1).join(" ");
          cells.length = columns.length - 1;
          cells.push(tail);
        }
        while (cells.length < columns.length) {
          cells.push("");
        }
        return cells;
      });
    // No rows is not a parse failure — it is an empty listing, and the raw log
    // already says so. Returning undefined avoids a table that is only headers.
    return rows.length > 0 ? { title, columns, rows } : undefined;
  };
}

/** One cell from a JSON value: primitives verbatim, arrays joined, objects as JSON. */
function cell(v: unknown): string {
  if (v === null || v === undefined) {
    return "";
  }
  if (Array.isArray(v)) {
    return v.map(cell).join(", ");
  }
  if (typeof v === "object") {
    return JSON.stringify(v);
  }
  return String(v);
}

/**
 * Read a command that emits JSON records — either one array, or one object per
 * line. `docker compose ps --format json` emits an array up to Compose 2.20 and
 * NDJSON from 2.21, so both are accepted rather than pinning a version. Compose
 * v2 dropped Go-template `--format` entirely, which is why it needs this rather
 * than a seventh `tabular`.
 */
function jsonTable(columns: string[], keys: string[], title?: string): Parser {
  return (stdout) => {
    const text = stdout.trim();
    if (!text) {
      return undefined;
    }
    let records: Record<string, unknown>[] = [];
    try {
      const whole = JSON.parse(text);
      records = Array.isArray(whole) ? whole : [whole];
    } catch {
      for (const line of text.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        try {
          records.push(JSON.parse(line));
        } catch {
          // A progress line or a warning that landed on stdout — skip it.
        }
      }
    }
    const rows = records.map((r) => keys.map((k) => cell(r[k])));
    return rows.length > 0 ? { title, columns, rows } : undefined;
  };
}

const REGISTRY: Record<string, Parser> = {
  "docker.ps": tabular(["ID", "Name", "Image", "State", "Status", "Ports", "Created"]),
  "docker.images": tabular(["ID", "Repository", "Tag", "Size", "Created"]),
  "docker.history": tabular(["ID", "Created", "Size", "Created by"]),
  "docker.networks": tabular(["ID", "Name", "Driver", "Scope", "Internal", "IPv6"]),
  "docker.volumes": tabular(["Name", "Driver", "Scope", "Mountpoint", "Labels"]),
  "docker.df": tabular(["Type", "Total", "Active", "Size", "Reclaimable"], "Disk usage"),
  "docker.composePs": jsonTable(
    ["Name", "Service", "Image", "State", "Health", "Exit"],
    ["Name", "Service", "Image", "State", "Health", "ExitCode"]
  ),
};

export function getParser(id: string | undefined): Parser | undefined {
  return id ? REGISTRY[id] : undefined;
}

/** Every registered parser id — the manifest lint checks none is left orphaned. */
export const PARSER_IDS: string[] = Object.keys(REGISTRY);
