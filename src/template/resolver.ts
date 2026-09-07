import * as path from "path";
import { Action, Field, ResolvedNote, Tool, When } from "../types";
import { ConfigStore } from "../config/configStore";

export interface ResolveResult {
  /** The exact command string — this is what is previewed AND what runs. */
  command: string;
  /** Absolute path of the output file, if the action declares one. */
  outputFile?: string;
  /** cwd the command runs in (<outputsPath>/<outputDir>), created before run. */
  cwd: string;
}

/** date +%Hh%M_[%Y-%m-%d] — the toolbox's output-filename timestamp. */
export function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}h${p(d.getMinutes())}_[${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}]`;
}

/**
 * Field ids currently visible given the field state. Visibility cascades: a
 * field whose `when` references a *hidden* field sees that field's value as
 * absent (""), so e.g. the VirtIO ISO field (gated on a Windows `cOsVariant`)
 * vanishes once a Linux variant is picked, even though it keeps its stale value.
 * Computed
 * to a fixpoint (fields form an acyclic dependency graph in practice).
 */
export function visibleFieldIds(fields: Field[], state: Record<string, string>): Set<string> {
  const activeSection = state["__section"];
  const sectionOk = (f: Field) => !f.section || f.section === activeSection;
  const ids = new Set<string>(fields.filter(sectionOk).map((f) => f.id));
  for (let pass = 0; pass <= fields.length; pass++) {
    let changed = false;
    // Effective state: hidden fields contribute "" to other fields' conditions.
    const eff: Record<string, string> = {};
    for (const f of fields) {
      eff[f.id] = ids.has(f.id) ? state[f.id] ?? "" : "";
    }
    for (const f of fields) {
      const show = sectionOk(f) && (!f.when || evalWhen(f.when, eff));
      if (show && !ids.has(f.id)) {
        ids.add(f.id);
        changed = true;
      } else if (!show && ids.has(f.id)) {
        ids.delete(f.id);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return ids;
}

export function evalWhen(when: When, state: Record<string, string>): boolean {
  if ("all" in when) {
    return when.all.every((w) => evalWhen(w, state));
  }
  if ("any" in when) {
    return when.any.some((w) => evalWhen(w, state));
  }
  if ("not" in when) {
    return !evalWhen(when.not, state);
  }
  const value = state[when.field] ?? "";
  if ("truthy" in when) {
    return value !== "" && value !== "false";
  }
  if ("in" in when) {
    return when.in.includes(value);
  }
  // equals
  const target = when.equals;
  return Array.isArray(target) ? target.includes(value) : value === target;
}

/** POSIX single-quote a value so spaces/metacharacters survive as ONE shell argument. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Normalize a single field's current value into the string that replaces its {token}. */
function fieldToken(field: Field, state: Record<string, string>, visible: Set<string>): string {
  // A hidden field contributes nothing to the command.
  if (!visible.has(field.id)) {
    return "";
  }
  const value = state[field.id] ?? "";
  if (field.type === "check") {
    const on = value !== "" && value !== "false";
    return on ? field.flag ?? "" : "";
  }
  // File paths come from the native picker and routinely contain spaces, so quote
  // them to keep a path a single argument. Flag-bundle tokens (select/segment,
  // e.g. a "--network bridge=virbr0,model=virtio" pair) must stay unquoted so
  // they word-split, hence
  // this is scoped to `file`. Empty stays "" so [[…]] optional groups still drop.
  if (field.type === "file" && value !== "") {
    return shellQuote(value);
  }
  // Passwords are emitted inside single quotes in every template; escape any
  // embedded single quote (POSIX '\'' form) so a password containing a quote
  // can't break out of — or truncate inside — the argument. This makes any
  // character safe: spaces, ", $, and ' alike. "" stays "" so the optional
  // [[-p '{pw}']] groups still drop.
  if (field.type === "password" && value !== "") {
    return value.replace(/'/g, `'\\''`);
  }
  // Textarea carries arbitrary free text (crypto plaintext, keys, tokens) that
  // may contain spaces, quotes, $ and newlines. Its template always wraps it in
  // single quotes ('{input}'), so escape embedded quotes the same POSIX '\'' way
  // as passwords — making every character literal — while staying "" when empty
  // so optional [[…]] groups still drop.
  if (field.type === "textarea" && value !== "") {
    return value.replace(/'/g, `'\\''`);
  }
  return value;
}

/**
 * Interpolate {token}s in `template`. Also supports optional groups written as
 * `[[ … {token} … ]]`: the group renders empty if ANY token inside it is empty,
 * otherwise it renders with substitutions. This expresses the bash "append the
 * flag only if the value is set" idiom (optional `:port`, `-H header`, either/or
 * auth flags) without per-tool code. Unknown tokens → "".
 */
function interpolate(template: string, tokens: Record<string, string>): string {
  // Substitution repeats to a fixpoint: a field's value may itself contain a
  // token (cDiskPath defaults to "{IMAGES_DIR}/{cVmName}.qcow2"), so one pass
  // would leave "{cVmName}" sitting in the command. Bounded so a token that
  // refers to itself terminates instead of spinning.
  const subOnce = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_m, name: string) => (tokens[name] !== undefined ? tokens[name] : ""));
  const sub = (s: string) => {
    let out = s;
    for (let pass = 0; pass < 5 && /\{\w+\}/.test(out); pass++) {
      const next = subOnce(out);
      if (next === out) break;
      out = next;
    }
    return out;
  };

  const withGroups = template.replace(/\[\[([\s\S]*?)\]\]/g, (_m, inner: string) => {
    const names = [...inner.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
    const anyEmpty = names.some((n) => !tokens[n] || tokens[n] === "");
    return names.length > 0 && anyEmpty ? "" : sub(inner);
  });

  return sub(withGroups);
}

/** Sanitize a value for safe use inside an output filename. */
function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "out";
}

/**
 * Collapse runs of whitespace to a single space to tidy the gaps that dropped
 * tokens / optional groups leave behind — but ONLY outside single-quoted spans,
 * so a quoted argument (a file path from the picker, a `-p '{pw}'` password) that
 * legitimately contains consecutive spaces survives intact. Single-quoted values
 * escape an embedded quote as the POSIX `'\''` form (see `shellQuote`); a `'`
 * preceded by a backslash outside a quote is that literal, not a delimiter.
 */
function collapseUnquoted(s: string): string {
  let out = "";
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      if (inQuote) inQuote = false;
      else if (s[i - 1] !== "\\") inQuote = true;
      out += c;
    } else if (!inQuote && /\s/.test(c)) {
      if (!/\s$/.test(out)) out += " ";
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Resolve a tool action's command template against the current field state and
 * config. This is the ONE place a command string is produced — the preview and
 * the execution both call it, so what the user sees is exactly what runs.
 */
/** Build the {token} map: config, timestamp, then each field's normalized value. */
function buildTokens(tool: Tool, state: Record<string, string>, config: ConfigStore): Record<string, string> {
  const fields = tool.fields ?? [];
  const visible = visibleFieldIds(fields, state);
  const tokens: Record<string, string> = { ...config.getAll(), timestamp: timestamp() };
  for (const f of fields) {
    tokens[f.id] = fieldToken(f, state, visible);
  }
  return tokens;
}

/** Resolve a tool's target-side instruction steps (config + field injection, `when`-gated). */
export function resolveNotes(
  tool: Tool,
  state: Record<string, string>,
  config: ConfigStore
): ResolvedNote[] {
  if (!tool.notes) {
    return [];
  }
  const tokens = buildTokens(tool, state, config);
  return tool.notes
    .filter((n) => !n.when || evalWhen(n.when, state))
    .map((n) => ({ label: n.label, command: n.command ? interpolate(n.command, tokens) : undefined }));
}

export function resolveCommand(
  tool: Tool,
  action: Action,
  state: Record<string, string>,
  config: ConfigStore,
  outputsRoot: string
): ResolveResult {
  const fields = tool.fields ?? [];
  const tokens = buildTokens(tool, state, config);

  const cwd = path.join(outputsRoot, tool.outputDir ?? tool.id);

  let outputFile: string | undefined;
  if (action.output) {
    // Sanitize the target/host portion but keep the timestamp/extension readable.
    const named: Record<string, string> = { ...tokens };
    for (const f of fields) {
      if (f.type === "text" || f.type === "port") {
        named[f.id] = safeName(tokens[f.id] ?? "");
      }
    }
    const filename = interpolate(action.output, named);
    tokens.out = filename; // command runs in cwd, so a bare filename is correct
    outputFile = path.join(cwd, filename);
  }

  const command = collapseUnquoted(interpolate(action.command, tokens)).trim();

  return { command, outputFile, cwd };
}
