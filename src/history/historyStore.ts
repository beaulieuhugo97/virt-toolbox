import * as vscode from "vscode";

const KEY = "virtToolbox.history";
const CAP = 100;

/** One recorded run, shown in the History view and re-runnable. */
export interface RunRecord {
  id: string;
  ts: number;
  toolId: string;
  toolLabel: string;
  actionLabel: string;
  command: string;
  cwd: string;
  mode: "captured" | "terminal";
  exitCode?: number | null;
  outputFile?: string;
}

/** Persists the last CAP runs to workspace state so they survive reloads. */
export class HistoryStore {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly memento: vscode.Memento) {}

  all(): RunRecord[] {
    return this.memento.get<RunRecord[]>(KEY, []);
  }

  add(rec: Omit<RunRecord, "id" | "ts">): string {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const full: RunRecord = { ...rec, id, ts: Date.now() };
    const next = [full, ...this.all()].slice(0, CAP);
    void this.memento.update(KEY, next);
    this.emitter.fire();
    return id;
  }

  update(id: string, patch: Partial<RunRecord>): void {
    const next = this.all().map((r) => (r.id === id ? { ...r, ...patch } : r));
    void this.memento.update(KEY, next);
    this.emitter.fire();
  }

  get(id: string): RunRecord | undefined {
    return this.all().find((r) => r.id === id);
  }

  clear(): void {
    void this.memento.update(KEY, []);
    this.emitter.fire();
  }
}
