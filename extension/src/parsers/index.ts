import * as fs from "fs";

// Parsers turn captured output into a rendered table. A parser maps an action's
// `parse` id to a function producing { columns, rows }. The webview renders the
// result as a real, sortable HTML table. Most parsers read stdout; a parser may
// also read the action's structured output file via `ctx.outputFile` (ffuf writes
// JSON there). A parser returns undefined when it matches nothing — the raw log
// is always shown regardless, so parsing is a best-effort enhancement.

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

/** nmap normal-output (-oN) → open-ports table. */
export const nmapPorts: Parser = (stdout) => {
  const rows: string[][] = [];
  // Matches lines like: "22/tcp   open  ssh     OpenSSH 8.2p1 Ubuntu ..."
  const line = /^(\d+)\/(tcp|udp)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;
  for (const raw of stdout.split(/\r?\n/)) {
    const m = raw.match(line);
    if (!m) {
      continue;
    }
    const [, port, proto, state, service, version = ""] = m;
    rows.push([port, proto, state, service, version.trim()]);
  }
  if (rows.length === 0) {
    return undefined;
  }
  rows.sort((a, b) => Number(a[0]) - Number(b[0]));
  return {
    title: "Ports",
    columns: ["Port", "Proto", "State", "Service", "Version"],
    rows,
  };
};

/**
 * ffuf JSON (-o file -of json) → results table. ffuf's stdout is colourised
 * progress, so the reliable source is the JSON file it writes.
 */
export const ffufJson: Parser = (_stdout, ctx) => {
  if (!ctx?.outputFile || !fs.existsSync(ctx.outputFile)) {
    return undefined;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(ctx.outputFile, "utf8"));
  } catch {
    return undefined;
  }
  const results: any[] = Array.isArray(parsed?.results) ? parsed.results : [];
  if (results.length === 0) {
    return undefined;
  }
  const rows = results.map((r) => [
    String(r.input?.FUZZ ?? r.input?.FFUFHASH ?? ""),
    String(r.status ?? ""),
    String(r.length ?? ""),
    String(r.words ?? ""),
    String(r.lines ?? ""),
    String(r.url ?? r.host ?? ""),
  ]);
  return {
    title: "ffuf results",
    columns: ["FUZZ", "Status", "Size", "Words", "Lines", "URL"],
    rows,
  };
};

/** gobuster dir stdout → path/status/size table. Lines: "/admin (Status: 301) [Size: 312]". */
export const gobusterDirs: Parser = (stdout) => {
  const rows: string[][] = [];
  const line = /^(\S+)\s+\(Status:\s*(\d+)\)(?:\s+\[Size:\s*(\d+)\])?/;
  for (const raw of stdout.split(/\r?\n/)) {
    const m = raw.trim().match(line);
    if (!m) {
      continue;
    }
    rows.push([m[1], m[2], m[3] ?? ""]);
  }
  if (rows.length === 0) {
    return undefined;
  }
  return { title: "Paths", columns: ["Path", "Status", "Size"], rows };
};

/** smbclient -L / smbmap output → shares table. */
export const smbShares: Parser = (stdout) => {
  const rows: string[][] = [];
  // smbclient -L: "  Sharename   Type   Comment" then rows like "ADMIN$  Disk  Remote Admin".
  const line = /^\s*(\S.*?\S|\S)\s{2,}(Disk|IPC|Printer)\s*(.*)$/i;
  for (const raw of stdout.split(/\r?\n/)) {
    if (/^\s*Sharename\s+Type/i.test(raw)) {
      continue;
    }
    const m = raw.match(line);
    if (!m) {
      continue;
    }
    rows.push([m[1].trim(), m[2], (m[3] ?? "").trim()]);
  }
  if (rows.length === 0) {
    return undefined;
  }
  return { title: "Shares", columns: ["Share", "Type", "Comment"], rows };
};

/** nxc --rid-brute / --users → user table (best-effort). */
export const nxcUsers: Parser = (stdout) => {
  const rows: string[][] = [];
  // --rid-brute: "... 1104: DOMAIN\\jdoe (SidTypeUser)"
  const rid = /(\d+):\s+([^\s(]+\\[^\s(]+)\s+\((SidType\w+)\)/;
  // --users: "... DOMAIN\\jdoe   badpwdcount: 0 ..." — capture the DOMAIN\user token.
  const user = /\s([A-Za-z0-9._-]+\\[A-Za-z0-9._$-]+)\b/;
  const seen = new Set<string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const mr = raw.match(rid);
    if (mr) {
      const key = mr[2];
      if (!seen.has(key)) {
        seen.add(key);
        rows.push([mr[1], mr[2], mr[3].replace(/^SidType/, "")]);
      }
      continue;
    }
    const mu = raw.match(user);
    if (mu && !/SidType/.test(raw)) {
      const key = mu[1];
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(["", mu[1], ""]);
      }
    }
  }
  if (rows.length === 0) {
    return undefined;
  }
  return { title: "Users", columns: ["RID", "Account", "Type"], rows };
};

/**
 * whatweb -v output → plugin table. whatweb reports the same findings twice: a
 * one-line `Summary : Plugin[value], …` and, under `Detected Plugins:`, a block
 * per plugin with indented `Key : Value` lines. The verbose block is richer, so
 * it wins; the summary is the fallback for a non-verbose run (`-v` omitted).
 */
export const whatwebPlugins: Parser = (stdout) => {
  const text = stripAnsi(stdout);
  const rows = detectedPluginRows(text);
  const fallback = rows.length === 0 ? summaryRows(text) : [];
  const out = rows.length ? rows : fallback;
  if (out.length === 0) {
    return undefined;
  }
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return { title: "Detected technologies", columns: ["Plugin", "Version", "Details"], rows: out };
};

/** Drop SGR colour codes — whatweb colourises when it thinks it has a TTY. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

// Keys inside a plugin block that describe the finding. `Version` gets its own
// column; these fold into Details. Everything else (Website, Google Dorks, the
// prose description) is noise for a results table and is dropped.
const PLUGIN_DETAIL_KEYS = ["String", "OS", "Module", "Account", "Model", "Firmware", "Filepath", "Note", "IP", "Country", "RedirectLocation"];

/** Parse the `Detected Plugins:` section: `[ Name ]` headers + indented `Key : Value`. */
function detectedPluginRows(text: string): string[][] {
  const start = text.indexOf("Detected Plugins:");
  if (start < 0) {
    return [];
  }
  // The plugin section ends where the raw header dump begins.
  const rest = text.slice(start);
  const end = rest.search(/^HTTP Headers:/m);
  const body = end > 0 ? rest.slice(0, end) : rest;

  const rows: string[][] = [];
  let name = "";
  let version = "";
  let details: string[] = [];
  const flush = () => {
    if (name) {
      rows.push([name, version, details.join("; ")]);
    }
    name = "";
    version = "";
    details = [];
  };

  for (const raw of body.split(/\r?\n/)) {
    const header = raw.match(/^\[\s*(.+?)\s*\]\s*$/);
    if (header) {
      flush();
      name = header[1];
      continue;
    }
    if (!name) {
      continue;
    }
    // Indented "Key : Value" — the prose description lines have no " : ".
    const kv = raw.match(/^\s+([A-Za-z][A-Za-z ]*?)\s*:\s+(.*\S)\s*$/);
    if (!kv) {
      continue;
    }
    const [, key, value] = kv;
    if (/^Version$/i.test(key)) {
      version = version ? version + ", " + value : value;
    } else if (PLUGIN_DETAIL_KEYS.some((k) => k.toLowerCase() === key.toLowerCase())) {
      details.push(key + ": " + value);
    }
  }
  flush();
  return rows;
}

/**
 * Parse the `Summary :` line — `Apache[2.4.41], HTTPServer[Ubuntu][Apache/2.4.41]`.
 * Splitting on "," is wrong (values contain commas, e.g. `Country[RESERVED, ZZ]`),
 * so bracket depth decides where one plugin ends and the next begins.
 */
function summaryRows(text: string): string[][] {
  const m = text.match(/^Summary\s*:\s*(.+)$/m);
  if (!m) {
    return [];
  }
  const rows: string[][] = [];
  for (const entry of splitTopLevel(m[1])) {
    const parts = entry.match(/^([^[]+)((?:\[[^\]]*\])*)$/);
    if (!parts) {
      if (entry) rows.push([entry, "", ""]);
      continue;
    }
    const plugin = parts[1].trim();
    const values = [...parts[2].matchAll(/\[([^\]]*)\]/g)].map((v) => v[1]);
    // A lone value that looks like a version number belongs in the Version
    // column — except an IPv4 literal, which is what the IP plugin reports and
    // which would otherwise pass for a four-part version.
    const lone = values.length === 1 ? values[0] : "";
    const isVersion = !!lone && /^\d[\w.\-+]*$/.test(lone) && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(lone);
    rows.push([plugin, isVersion ? values[0] : "", isVersion ? "" : values.join(" | ")]);
  }
  return rows;
}

/** Split "a[1], b[x, y], c" on commas that sit outside [ ] . */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of s) {
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      const t = buf.trim();
      if (t) out.push(t);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const t = buf.trim();
  if (t) out.push(t);
  return out;
}

const REGISTRY: Record<string, Parser> = {
  "nmap-ports": nmapPorts,
  "ffuf-json": ffufJson,
  "gobuster-dirs": gobusterDirs,
  "smb-shares": smbShares,
  "nxc-users": nxcUsers,
  "whatweb-plugins": whatwebPlugins,
};

export function getParser(id: string | undefined): Parser | undefined {
  return id ? REGISTRY[id] : undefined;
}
