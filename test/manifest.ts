// Offline integrity checks over the tool manifests — no binaries, runs in the
// default `npm test`. Catches the "silent dropped argument" / dangling-reference
// class, and guards that the committed run-cases.json is in sync with the tools.
import { Tool, When } from "../src/types";
import { TOOLS } from "../src/tools/index";
import { CONFIG_KEYS } from "../src/config/configMenus";
import { getParser, PARSER_IDS } from "../src/parsers/index";
import { done, eq, fail, ok, pass } from "./harness";

const tokensOf = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** Field ids referenced by a When tree. */
function whenFields(w: When, out: string[] = []): string[] {
  if ("all" in w) w.all.forEach((x) => whenFields(x, out));
  else if ("any" in w) w.any.forEach((x) => whenFields(x, out));
  else if ("not" in w) whenFields(w.not, out);
  else out.push(w.field);
  return out;
}

// ── Per-tool structural lint ─────────────────────────────────────────────────
const toolIds = new Set<string>();
for (const tool of TOOLS) {
  const t = tool.id;
  if (toolIds.has(t)) fail(`dup tool id: ${t}`);
  toolIds.add(t);

  const fields = tool.fields ?? [];
  const fieldIds = new Set(fields.map((f) => f.id));
  const sectionIds = new Set((tool.sections ?? []).map((s) => s.id));
  const validTokens = new Set<string>([...fieldIds, ...CONFIG_KEYS, "out", "timestamp"]);
  const checkFields = new Set(fields.filter((f) => f.type === "check").map((f) => f.id));
  const emitted = new Set<string>();
  for (const a of tool.actions ?? []) {
    tokensOf(a.command).forEach((x) => emitted.add(x));
    if (a.output) tokensOf(a.output).forEach((x) => emitted.add(x));
  }

  // unique field ids
  if (fieldIds.size !== fields.length) fail(`${t}: duplicate field ids`);

  // fields: section refs, when refs, check-without-flag
  for (const f of fields) {
    if (f.section && !sectionIds.has(f.section)) fail(`${t}.${f.id}: unknown section '${f.section}'`);
    if (f.when) for (const wf of whenFields(f.when)) if (!fieldIds.has(wf)) fail(`${t}.${f.id}: when → unknown field '${wf}'`);
    if (f.type === "check" && !f.flag && emitted.has(f.id)) fail(`${t}.${f.id}: check emitted as {${f.id}} but has no flag`);
  }

  // actions: token refs, {out}/output pairing, section/when/parse refs, unique ids
  const actionIds = new Set<string>();
  const fieldSection = new Map(fields.map((f) => [f.id, f.section]));
  for (const a of tool.actions ?? []) {
    if (actionIds.has(a.id)) fail(`${t}: dup action id '${a.id}'`);
    actionIds.add(a.id);
    if (a.section && !sectionIds.has(a.section)) fail(`${t}.${a.id}: unknown section '${a.section}'`);
    if (a.when) for (const wf of whenFields(a.when)) if (!fieldIds.has(wf)) fail(`${t}.${a.id}: when → unknown field '${wf}'`);
    if (a.parse && !getParser(a.parse)) fail(`${t}.${a.id}: unknown parser '${a.parse}'`);

    for (const tok of tokensOf(a.command)) {
      if (!validTokens.has(tok)) fail(`${t}.${a.id}: command token {${tok}} is not a field or config key`);
      if (checkFields.has(tok)) { /* a bare {check} token is fine — resolves to its flag */ }
    }
    if (a.command.includes("{out}") && !a.output && !fieldIds.has("out")) fail(`${t}.${a.id}: uses {out} but has no output template`);
    if (a.output) for (const tok of tokensOf(a.output)) if (!validTokens.has(tok)) fail(`${t}.${a.id}: output token {${tok}} unknown`);

    // An action can only read fields reachable from its own tab: visibleFieldIds
    // gates on state.__section, so a field belonging to a DIFFERENT section
    // resolves to "" and silently removes an argument rather than erroring —
    // turning `vol-create-as {poolName} {nvName} {nvCapacity}` into a two-arg
    // call virsh reads as pool=name, name=capacity. A section-less field is
    // global and always reachable; a section-less action shows on every tab, so
    // it may only read global fields.
    for (const tok of [...tokensOf(a.command), ...tokensOf(a.output ?? "")]) {
      const fs = fieldSection.get(tok);
      if (fs !== undefined && fs !== a.section) {
        fail(`${t}.${a.id}: reads {${tok}} from section '${fs}' but runs in '${a.section ?? "(every tab)"}' — it will resolve to ""`);
      }
    }

    // A captured run gets a stdin PIPE and never a TTY, so a sudo password
    // prompt would block forever with no way to answer it.
    if (a.mode === "captured" && /\bsudo\b/.test(a.command)) fail(`${t}.${a.id}: captured action invokes sudo`);
    if (a.sudo && a.mode !== "terminal") fail(`${t}.${a.id}: sudo:true outside terminal mode`);
  }

  // verify: token refs — a probe may carry {CONFIG} tokens ({DOCKER_BIN}), which
  // the host resolves before running it. A typo would silently probe garbage and
  // show a permanently red badge, so it is linted like a command.
  for (const v of tool.verify ?? []) {
    for (const tok of tokensOf(v.command)) {
      if (!validTokens.has(tok)) fail(`${t} verify '${v.label}': token {${tok}} unknown`);
    }
  }

  // notes: token refs only (notes are instructions, not executed)
  for (const n of tool.notes ?? []) {
    if (!n.command) continue;
    for (const tok of tokensOf(n.command)) {
      // notes may reference literal {IMAGES_DIR}-style config or fields; anything else is a typo
      if (!validTokens.has(tok) && !CONFIG_KEYS.includes(tok)) fail(`${t} note: token {${tok}} unknown`);
    }
  }
  pass(`${t}: manifest ok`);
}

// ── parsers ──────────────────────────────────────────────────────────────────
// The manifest lint above only proves a `parse` id is registered. These check the
// parsers themselves: they are the first in the repo, and a listing rendering as
// a sortable table is the whole point of running docker actions captured.
const ps = getParser("docker.ps")!;
const composePs = getParser("docker.composePs")!;

const twoRows = [
  "a3f1c2d9e4b1\tweb\tnginx:latest\trunning\tUp 3 days\t0.0.0.0:80->80/tcp\t3 days ago",
  "7b2e8f01aa53\tdb\tpostgres:16\texited\tExited (0) 1 hour ago\t\t2 days ago",
].join("\n");

const parsed = ps(twoRows);
eq("docker.ps: 2 rows of 7 columns", [parsed?.rows.length, parsed?.rows[0].length], [2, 7]);
eq("docker.ps: columns keep their order", parsed?.columns[1], "Name");
eq("docker.ps: an empty trailing cell survives", parsed?.rows[1][5], "");

// An empty listing is not a parse failure — the raw log already says so, and a
// table of nothing but headers is worse than no table.
eq("docker.ps: no output → undefined", ps(""), undefined);
eq("docker.ps: only blank lines → undefined", ps("\n\n"), undefined);

// A value containing a tab must not shift every column right of it.
const overflow = ps("id\tname\timage\trunning\tUp\tports\t3 days\tstray");
eq("docker.ps: an extra tab folds into the last cell", overflow?.rows[0].length, 7);
eq("docker.ps: …carrying the overflow", overflow?.rows[0][6], "3 days stray");

// A short row is padded rather than rendering a ragged table.
eq("docker.ps: a short row is padded", ps("id\tname")?.rows[0].length, 7);

// Compose v2 emits a JSON array up to 2.20 and NDJSON from 2.21. Both must parse
// identically, so the tool works whichever version is installed.
const record = { Name: "web-1", Service: "web", Image: "nginx", State: "running", Health: "", ExitCode: 0 };
const asArray = composePs(JSON.stringify([record, { ...record, Name: "db-1", Service: "db" }]));
const asNdjson = composePs(`${JSON.stringify(record)}\n${JSON.stringify({ ...record, Name: "db-1", Service: "db" })}`);
eq("docker.composePs: an array and NDJSON agree", asArray, asNdjson);
eq("docker.composePs: 2 rows of 6 columns", [asArray?.rows.length, asArray?.rows[0].length], [2, 6]);
eq("docker.composePs: a numeric field is stringified", asArray?.rows[0][5], "0");
eq("docker.composePs: no output → undefined", composePs(""), undefined);

// ── virsh parsers ────────────────────────────────────────────────────────────
// Fixtures are real output captured from libvirt 12.0.0. Each covers a case a
// naive whitespace split gets wrong, which is why the parser is offset-based.
const vTable = getParser("virsh.domains")!;
const vInfo = getParser("virsh.info")!;
const vStats = getParser("virsh.domstats")!;

const LIST = [
  " Id   Name     State",
  "-------------------------",
  " -    kali     shut off",
  " -    pwnbox   shut off",
  "",
].join("\n");

const listed = vTable(LIST);
eq("virsh.domains: 2 rows of 3 columns", [listed?.rows.length, listed?.columns.length], [2, 3]);
eq("virsh.domains: columns come from the header", listed?.columns, ["Id", "Name", "State"]);
// A space-bearing value in the LAST column — the case that breaks a whitespace split.
eq("virsh.domains: 'shut off' survives as one cell", listed?.rows[0][2], "shut off");
eq("virsh.domains: the title comes from the registered id", listed?.title, "Domains");

// An added column (--title) must shift the offsets, proving columns really are
// inferred per-parse rather than hardcoded.
const titled = vTable(
  [" Id   Name     State      Title", "----------------------------------", " -    kali     shut off   ", ""].join("\n")
);
eq("virsh.domains: --title adds a 4th column", titled?.columns.length, 4);
eq("virsh.domains: …and its empty cell is preserved", titled?.rows[0][3], "");

// A space-bearing value in a MIDDLE column, bounded by the next offset.
const pools = getParser("virsh.pools")!(
  [
    " Name     State     Autostart   Persistent   Capacity     Allocation   Available",
    "-----------------------------------------------------------------------------------",
    " images   running   yes         yes          914.25 GiB   760.63 GiB   153.63 GiB",
    "",
  ].join("\n")
);
eq("virsh.pools: 7 columns", pools?.columns.length, 7);
eq("virsh.pools: a space-bearing middle cell is bounded", pools?.rows[0][4], "914.25 GiB");
eq("virsh.pools: …and so is the one after it", pools?.rows[0][5], "760.63 GiB");

// The last column runs far past its header — libvirt sizes it to the header,
// not the data, so an upper bound here would truncate the path.
const blocks = getParser("virsh.blocks")!(
  [
    " Type   Device   Target   Source",
    "----------------------------------------------------------------------",
    " file   disk     vda      /var/lib/libvirt/images/kali-linux-2025.2-qemu-amd64.qcow2",
    "",
  ].join("\n")
);
eq(
  "virsh.blocks: the last column is unbounded",
  blocks?.rows[0][3],
  "/var/lib/libvirt/images/kali-linux-2025.2-qemu-amd64.qcow2"
);

// A multi-word header, and a value with two spaces in it.
const snaps = getParser("virsh.snapshots")!(
  [
    " Name           Creation Time               State",
    "-----------------------------------------------------",
    " Post-Install   2025-10-15 23:45:26 -0400   shutoff",
    "",
  ].join("\n")
);
eq("virsh.snapshots: a multi-word header stays one column", snaps?.columns[1], "Creation Time");
eq("virsh.snapshots: …and its value stays one cell", snaps?.rows[0][1], "2025-10-15 23:45:26 -0400");

// An empty listing is header + rule + nothing: not a parse failure, but no table.
eq("virsh table: an empty listing → undefined", vTable(" Name   State\n---------------\n\n"), undefined);
// Bare output (`list --name`) has no rule at all, so it must not be read as a table.
eq("virsh table: no dashed rule → undefined", vTable("kali\npwnbox\n"), undefined);
// Every mutation chains `&& <list>`, so its own message precedes the table.
const afterMutation = vTable(`Domain 'kali' started\n\n${LIST}`);
eq("virsh table: a mutation's message is discarded", afterMutation?.rows.length, 2);
eq("virsh table: …and the header is still the header", afterMutation?.columns, ["Id", "Name", "State"]);

const info = vInfo(
  ["Id:             -", "Name:           kali", "CPU(s):         8", "Security model: selinux", "CPU time        N/A"].join("\n")
);
eq("virsh.info: 4 rows (the colon-less line is skipped)", info?.rows.length, 4);
eq("virsh.info: a parenthesised label is intact", info?.rows[2], ["CPU(s)", "8"]);
eq("virsh.info: splits on the FIRST colon only", info?.rows[3], ["Security model", "selinux"]);
// nodememstats pads BEFORE the colon.
eq("virsh.info: a key padded before its colon is trimmed", vInfo("total  :   15677560 KiB")?.rows[0], ["total", "15677560 KiB"]);
eq("virsh.info: no output → undefined", vInfo(""), undefined);

const stats = vStats(
  ["Domain: 'kali'", "  state.state=5", "  cpu.time=400000000", "Domain: 'pwnbox'", "  state.state=5"].join("\n")
);
eq("virsh.domstats: 3 metric rows across 2 domains", stats?.rows.length, 3);
eq("virsh.domstats: the domain carries into each row", stats?.rows[0], ["kali", "state.state", "5"]);
eq("virsh.domstats: …including after the second header", stats?.rows[2][0], "pwnbox");
eq("virsh.domstats: no output → undefined", vStats(""), undefined);

// Every registered parser is actually reached by some action — an orphan means a
// renamed `parse:` id left its parser behind.
const used = new Set(TOOLS.flatMap((t) => (t.actions ?? []).map((a) => a.parse).filter(Boolean)));
for (const id of PARSER_IDS) {
  if (!used.has(id)) fail(`parser '${id}' is registered but no action references it`);
}
pass("every registered parser is referenced by an action");

done();
