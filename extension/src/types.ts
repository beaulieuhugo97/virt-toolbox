// The manifest schema — one typed shape that every tool is expressed in.
// A Tool is pure data: metadata + fields (the form) + actions (command
// templates). The form engine renders any Tool from this schema alone, so
// there is no per-tool UI code. See PLAN.md § "The manifest".

export type FieldType =
  | "text"
  | "textarea"
  | "password"
  | "port"
  | "select"
  | "segment"
  | "check"
  | "file"
  | "interface";

export interface Option {
  label: string;
  value: string;
}

/**
 * A serializable conditional. Replaces the plan's illustrative
 * `when: f => f.mode === "-sS"` arrow form: functions cannot cross the
 * webview postMessage boundary, so conditions are declarative objects that
 * both the host (command building) and the webview (show/hide) evaluate.
 */
export type When =
  | { field: string; equals: string | string[] }
  | { field: string; in: string[] }
  | { field: string; truthy: true }
  | { all: When[] }
  | { any: When[] }
  | { not: When };

/** A tab in a sectioned tool. Fields/actions carry a matching `section` id. */
export interface Section {
  id: string;
  label: string;
}

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  /** Tab this field belongs to; omit for fields shown on every tab (global). */
  section?: string;
  help?: string;
  /** Default value. May contain {CONFIG} tokens (e.g. "{IMAGES_DIR}"), resolved host-side. */
  default?: string;
  /** For select/segment. Accepts a label→value map, a {label,value}[], or a bare string[]. */
  options?: Record<string, string> | Option[] | string[];
  /** For `check`: the flag emitted when checked (e.g. "-sV"). */
  flag?: string;
  placeholder?: string;
  when?: When;
  required?: boolean;
  /** For `file`: pick a file or a folder. */
  fileKind?: "file" | "folder";
  /** For `file`: config key whose value seeds the picker's start directory (e.g. "IMAGES_DIR"). */
  rootConfig?: string;
}

/** captured = collect stdout → parse → table. terminal = real TTY / stdin / streaming. */
export type ExecMode = "captured" | "terminal";

export interface Action {
  id: string;
  label: string;
  mode: ExecMode;
  /** Tab this action belongs to; omit to show on every tab. */
  section?: string;
  /** Command template, e.g. "sudo virsh --connect {LIBVIRT_URI} start {vmName}". */
  command: string;
  /** Output filename template, expanded under the tool's outputDir (e.g. "{timestamp}_{vmName}_virsh.txt"). */
  output?: string;
  /** Parser id — turns captured stdout into a rendered table. */
  parse?: string;
  /** Run under sudo (terminal mode reads the password over a real TTY). */
  sudo?: boolean;
  /** Show this action only when the condition holds — lets a `mode` segment gate distinct sub-workflows. */
  when?: When;
}

/**
 * A step in the "before this will work, run this" instructions rendered below a
 * tool's actions — docker's "start the service / join the group", say. `command`
 * is a template resolved host-side against config + field state; `when` gates it.
 * Notes are shown, never executed.
 */
export interface NoteStep {
  label: string;
  command?: string;
  when?: When;
}

/**
 * A capability probe run host-side (like the dep check). It confirms not just
 * that a binary exists but that it's the right *variant* — e.g. that `john` is
 * the jumbo build, or `volatility` is v3. `command` is a shell test; it passes
 * when the command exits 0. Rendered as a badge next to deps, with `hint` shown
 * on hover (and appended to the badge) when it fails.
 */
export interface Verify {
  label: string;
  command: string;
  hint?: string;
}

export interface Tool {
  id: string;
  label?: string;
  /** Slash-delimited category path — mirrors the Tools/ tree, drives the activity-bar tree. */
  category: string;
  deps?: string[];
  /** Variant/version probes (e.g. john is jumbo) — badged next to deps. */
  verify?: Verify[];
  /** Runs land in scripts/outputs/<outputDir>/ (the setup_directory convention). */
  outputDir?: string;
  fields?: Field[];
  actions?: Action[];
  /** Tabs — a cleaner alternative to a wide `mode` segment for many-operation tools. */
  sections?: Section[];
  /** systemd service that must be running (check_service) — badged, with a Start affordance. */
  service?: string;
  /** OS group the user must belong to (check_group) — badged, with an Add affordance. */
  group?: string;
  /** Instruction steps rendered below the actions (target-side commands). */
  notes?: NoteStep[];
  notesTitle?: string;
}

// ---- Serialized view of a Tool sent to the webview ---------------------------
// Command/output templates are deliberately stripped: the webview never sees or
// builds the raw command, it only displays the host-resolved string. This keeps
// the "GUI hides what executes" risk closed — the host is the single authority
// on what runs. Field defaults are pre-resolved against config so the form shows
// concrete values.

export interface SerializedField extends Omit<Field, "options" | "default"> {
  options?: Option[];
  default?: string;
}

export interface SerializedAction {
  id: string;
  label: string;
  mode: ExecMode;
  section?: string;
  parse?: string;
  sudo?: boolean;
  when?: When;
}

export interface SerializedTool {
  id: string;
  label: string;
  category: string;
  deps: string[];
  fields: SerializedField[];
  actions: SerializedAction[];
  sections?: Section[];
  notesTitle?: string;
  hasNotes: boolean;
}

/** Gate statuses shown as badges (deps, service, group membership). */
export interface GateStatus {
  toolId: string;
  deps: { name: string; ok: boolean }[];
  verify?: { label: string; ok: boolean; hint?: string }[];
  service?: { name: string; active: boolean };
  group?: { name: string; member: boolean };
}

/** One resolved instruction step sent to the webview (command already resolved). */
export interface ResolvedNote {
  label: string;
  command?: string;
}
