import * as vscode from "vscode";

const KEY = "virtToolbox.favorites";

/**
 * Persists the set of starred tool ids to global state (favorites are a
 * cross-workspace preference, unlike the per-workspace target config). Fires on
 * change so the tree, home dashboard, and open tool view stay in sync.
 */
export class FavoritesStore {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly memento: vscode.Memento) {}

  all(): string[] {
    return this.memento.get<string[]>(KEY, []);
  }

  has(id: string): boolean {
    return this.all().includes(id);
  }

  async toggle(id: string): Promise<boolean> {
    const cur = this.all();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    await this.memento.update(KEY, next);
    this.emitter.fire();
    return next.includes(id);
  }
}
