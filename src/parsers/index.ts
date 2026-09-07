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
// because all four run `docker ps` with the same --format. Likewise every virsh
// listing shares one fixed-width shape, so `virshTable` serves all of them and
// the registered id carries only the table's title.

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

// ── virsh shapes ─────────────────────────────────────────────────────────────
// virsh has no machine-readable output in 12.x — no JSON, no --format, no CSV,
// and `--name`/`--uuid` collapse a listing to one bare value per line. Every
// table is fixed-width with widths computed from the data, so the only reliable
// anchor is the header row: each column name's offset in the header is where
// that column starts in every data row.

/**
 * Parse a virsh fixed-width table. Columns are inferred at PARSE time from the
 * header, which is why this factory takes no column list — one parser serves
 * `list`, `net-list`, `pool-list --details`, `vol-list --details`,
 * `snapshot-list`, `domblklist`, `domiflist` and `net-dhcp-leases` alike, and a
 * flag that adds a column (--details, --title, --parent) needs no change here.
 */
function virshTable(title?: string): Parser {
  return (stdout) => {
    const lines = stdout.split("\n").map((l) => l.replace(/\r$/, ""));
    // The dashed rule under the header is the anchor, NOT line 1. It is what
    // distinguishes a table from bare output (`list --name` prints no rule), and
    // it discards the message a mutation prints ahead of its chained listing
    // ("Domain 'kali' started"), which matters because every mutation here ends
    // `&& <list>`. The rule is DECORATIVE — its width is the whole table's, not
    // the header's (a 16-char header can sit under 70 dashes) — so it can only
    // ever be matched by shape, never measured.
    const ruleIdx = lines.findIndex((l) => /^\s*-{3,}\s*$/.test(l));
    if (ruleIdx < 1) {
      return undefined;
    }
    const header = lines[ruleIdx - 1];
    // Two-or-more spaces separate columns; ONE space lives inside a column name
    // ("Creation Time", "MAC address", "Client ID or DUID").
    const columns = header.trim().split(/\s{2,}/);
    // Offsets are scanned left-to-right from a moving cursor so a name that is a
    // substring of an earlier column anchors to its own column, not the earlier
    // match.
    const starts: number[] = [];
    let cursor = 0;
    for (const name of columns) {
      const at = header.indexOf(name, cursor);
      if (at < 0) {
        return undefined;
      }
      starts.push(at);
      cursor = at + name.length;
    }
    const last = columns.length - 1;
    const rows = lines
      .slice(ruleIdx + 1)
      .filter((l) => l.trim() !== "")
      .map((line) =>
        starts.map((start, i) =>
          // The last column has NO upper bound: libvirt sizes it to its header
          // rather than its data, so domblklist's Source routinely runs several
          // times past it. Every other column is padded to fit its widest value,
          // so a bounded slice is safe.
          (i === last ? line.slice(start) : line.slice(start, starts[i + 1])).trim()
        )
      );
    return rows.length > 0 ? { title, columns, rows } : undefined;
  };
}

/**
 * `Label:` + padding + value — dominfo, nodeinfo, net-info, pool-info, vol-info,
 * version, nodecpustats, nodememstats.
 *
 * Split on the FIRST colon: labels contain spaces and parentheses ("CPU(s):",
 * "Core(s) per socket:"), and a value may itself contain one (a MAC address, a
 * SPICE URI). nodememstats pads BEFORE the colon ("total  :"), hence trimming
 * the key too. A line with no colon is skipped rather than inventing a row —
 * which is why vcpuinfo, whose "CPU time  N/A" has none, declares no parse.
 */
function keyValue(title?: string): Parser {
  return (stdout) => {
    const rows: string[][] = [];
    for (const raw of stdout.split("\n")) {
      const line = raw.replace(/\r$/, "");
      const at = line.indexOf(":");
      if (at < 0) {
        continue;
      }
      const key = line.slice(0, at).trim();
      if (key === "") {
        continue;
      }
      rows.push([key, line.slice(at + 1).trim()]);
    }
    return rows.length > 0 ? { title, columns: ["Property", "Value"], rows } : undefined;
  };
}

/**
 * `domstats` is neither a table nor key/value: a `Domain: 'kali'` header line
 * followed by indented `key=value` lines, repeated once per domain. Flattened to
 * (Domain, Metric, Value) so a run across every domain sorts and filters as one
 * table. It reports on shut-off domains too, unlike dommemstat/domifstat.
 */
function domStats(title?: string): Parser {
  return (stdout) => {
    const rows: string[][] = [];
    let domain = "";
    for (const raw of stdout.split("\n")) {
      const line = raw.replace(/\r$/, "");
      const head = /^\s*Domain:\s*'(.*)'\s*$/.exec(line);
      if (head) {
        domain = head[1];
        continue;
      }
      const at = line.indexOf("=");
      if (at < 0) {
        continue;
      }
      const metric = line.slice(0, at).trim();
      if (metric === "") {
        continue;
      }
      rows.push([domain, metric, line.slice(at + 1).trim()]);
    }
    return rows.length > 0 ? { title, columns: ["Domain", "Metric", "Value"], rows } : undefined;
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

  // Every virsh listing is the same fixed-width shape, so these differ only by
  // title — which earns its keep: several tools render two different tables (the
  // storage tool shows pools AND volumes, the devices tool blocks AND
  // interfaces), and after a mutation chain the title is the only thing saying
  // which listing you are looking at.
  "virsh.domains": virshTable("Domains"),
  "virsh.snapshots": virshTable("Snapshots"),
  "virsh.networks": virshTable("Networks"),
  "virsh.leases": virshTable("DHCP leases"),
  "virsh.pools": virshTable("Storage pools"),
  "virsh.volumes": virshTable("Volumes"),
  "virsh.blocks": virshTable("Block devices"),
  "virsh.ifaces": virshTable("Interfaces"),
  "virsh.table": virshTable(),
  "virsh.info": keyValue(),
  "virsh.domstats": domStats("Domain statistics"),
};

export function getParser(id: string | undefined): Parser | undefined {
  return id ? REGISTRY[id] : undefined;
}

/** Every registered parser id — the manifest lint checks none is left orphaned. */
export const PARSER_IDS: string[] = Object.keys(REGISTRY);
