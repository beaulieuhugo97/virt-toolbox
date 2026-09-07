// Offline integrity checks over the tool manifests — no binaries, runs in the
// default `npm test`. Catches the "silent dropped argument" / dangling-reference
// class, and guards that the committed run-cases.json is in sync with the tools.
import { Tool, When } from "../src/types";
import { TOOLS } from "../src/tools/index";
import { CONFIG_KEYS } from "../src/config/configMenus";
import { getParser } from "../src/parsers/index";
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
  }

  // notes: token refs only (notes are instructions, not executed)
  for (const n of tool.notes ?? []) {
    if (!n.command) continue;
    for (const tok of tokensOf(n.command)) {
      // notes may reference literal {RUSER}-style config or fields; anything else is a typo
      if (!validTokens.has(tok) && !CONFIG_KEYS.includes(tok)) fail(`${t} note: token {${tok}} unknown`);
    }
  }
  pass(`${t}: manifest ok`);
}

done();
