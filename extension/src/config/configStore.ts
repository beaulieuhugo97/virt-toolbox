import * as vscode from "vscode";
import * as os from "os";
import { CONFIG_DEFAULTS, CONFIG_KEYS } from "./configMenus";

const STATE_PREFIX = "virtToolbox.config.";

/**
 * The single source of truth for injected config values (LIP/RHOST/wordlists…).
 * Persisted to VS Code workspace state (GUI-only; the gum TUI keeps its own
 * config.env — see PLAN.md open question #1, resolved to workspace state).
 */
export class ConfigStore {
  private emitter = new vscode.EventEmitter<void>();
  /** Fires whenever any value changes, so open panels can refresh. */
  readonly onDidChange = this.emitter.event;

  constructor(private readonly memento: vscode.Memento) {}

  private raw(key: string): string | undefined {
    return this.memento.get<string>(STATE_PREFIX + key);
  }

  /** Resolve a single value: stored → default → derived (DOMAIN/DC_IP) → "". */
  get(key: string): string {
    const stored = this.raw(key);
    if (stored !== undefined && stored !== "") {
      return expandHome(stored);
    }
    if (key === "DOMAIN") {
      return this.get("RHOST");
    }
    if (key === "DC_IP") {
      return this.get("RIP");
    }
    const def = CONFIG_DEFAULTS[key];
    return def !== undefined ? expandHome(def) : "";
  }

  /** All known config keys resolved to their current values. */
  getAll(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of CONFIG_KEYS) {
      out[key] = this.get(key);
    }
    return out;
  }

  async set(key: string, value: string): Promise<void> {
    await this.memento.update(STATE_PREFIX + key, value);
    this.emitter.fire();
  }
}

/** Expand a leading ~ to the user's home directory (config.env stores literal ~). */
export function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return os.homedir() + value.slice(1);
  }
  return value;
}
