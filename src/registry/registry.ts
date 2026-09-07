import { ConfigStore } from "../config/configStore";
import { Field, Option, SerializedField, SerializedTool, Tool } from "../types";
import { TOOLS } from "../tools";
import { interpolateConfig } from "../template/resolver";

/** Normalize a field's `options` (map | tuple[] | string[]) into {label,value}[]. */
export function normalizeOptions(options: Field["options"]): Option[] | undefined {
  if (!options) {
    return undefined;
  }
  if (Array.isArray(options)) {
    if (options.length === 0) {
      return [];
    }
    if (typeof options[0] === "string") {
      return (options as string[]).map((s) => ({ label: s, value: s }));
    }
    return options as Option[];
  }
  return Object.entries(options).map(([label, value]) => ({ label, value }));
}

/** Resolve a field default's {CONFIG} tokens so the form shows a concrete value. */
function resolveDefault(def: string | undefined, config: ConfigStore): string | undefined {
  return def === undefined ? undefined : interpolateConfig(def, config);
}

export class Registry {
  private byId = new Map<string, Tool>();
  /** Which tools the UI lists. Everything, until a host mode narrows it. */
  private visible: (tool: Tool) => boolean = () => true;

  constructor(tools: Tool[] = TOOLS) {
    for (const t of tools) {
      this.byId.set(t.id, t);
    }
  }

  /**
   * Narrow what the tree, the finder and the dashboard list — on a non-Debian
   * host, most of the toolbox cannot run (see src/host/platform.ts). `get` is
   * deliberately not filtered: a hidden tool opened by id, from a walkthrough
   * link or run history, still works.
   */
  setVisibility(pred: (tool: Tool) => boolean): void {
    this.visible = pred;
  }

  /** The tools the UI lists, after the host-mode filter. */
  all(): Tool[] {
    return [...this.byId.values()].filter((t) => this.visible(t));
  }

  /** Every registered tool, filter or no filter. */
  allUnfiltered(): Tool[] {
    return [...this.byId.values()];
  }

  get(id: string): Tool | undefined {
    return this.byId.get(id);
  }

  /** Strip command/output templates and pre-resolve defaults for the webview. */
  serialize(tool: Tool, config: ConfigStore): SerializedTool {
    const fields: SerializedField[] = (tool.fields ?? []).map((f) => ({
      ...f,
      options: normalizeOptions(f.options),
      default: resolveDefault(f.default, config),
    }));
    const actions = (tool.actions ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      mode: a.mode,
      section: a.section,
      parse: a.parse,
      sudo: a.sudo,
      when: a.when,
    }));
    return {
      id: tool.id,
      label: tool.label ?? tool.id,
      category: tool.category,
      deps: tool.deps ?? [],
      fields,
      actions,
      sections: tool.sections,
      notesTitle: tool.notesTitle,
      hasNotes: !!(tool.notes && tool.notes.length > 0),
    };
  }
}
