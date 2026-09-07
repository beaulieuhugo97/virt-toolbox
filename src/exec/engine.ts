import * as vscode from "vscode";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { getParser, ParsedTable } from "../parsers";

export interface CapturedHandlers {
  onOutput(chunk: string): void;
  onDone(result: { code: number | null; table?: ParsedTable }): void;
}

/**
 * The execution engine. Two modes, exactly as PLAN.md § Architecture:
 *  - captured: spawn via bash, stream stdout/stderr to the webview, parse on exit.
 *  - terminal: an integrated VS Code terminal — a real TTY with stdin, so
 *    interactive/streaming tools, listeners and `sudo -S` work, and "Stop" is
 *    Ctrl-C / disposing the terminal. (This replaces bundling node-pty.)
 *
 * Multiple tools can run at once (each tool opens its own webview tab), so the
 * engine is not single-run: `runCaptured` returns the spawned child and the
 * caller (a tab) owns it, and terminals are keyed by name so distinct tools get
 * distinct terminals instead of serializing through one.
 */
export class ExecutionEngine {
  private children = new Set<ChildProcess>();
  private terminals = new Map<string, vscode.Terminal>();

  /**
   * captured mode: collect stdout, stream everything, parse on close. Returns the
   * spawned child so the caller can `stop()` this specific run — concurrent
   * captured runs (one per tool tab) each track their own child.
   */
  runCaptured(
    command: string,
    cwd: string,
    parseId: string | undefined,
    handlers: CapturedHandlers,
    outputFile?: string
  ): ChildProcess {
    fs.mkdirSync(cwd, { recursive: true });

    const child = spawn("bash", ["-lc", command], { cwd });
    this.children.add(child);
    let stdout = "";

    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      handlers.onOutput(s);
    });
    child.stderr.on("data", (d: Buffer) => {
      handlers.onOutput(d.toString());
    });
    child.on("error", (err) => {
      handlers.onOutput(`\n[error] ${err.message}\n`);
    });
    child.on("close", (code) => {
      this.children.delete(child);
      const parser = getParser(parseId);
      const table = parser ? parser(stdout, { outputFile }) : undefined;
      handlers.onDone({ code, table });
    });
    return child;
  }

  /** Stop a specific captured run (the child returned by `runCaptured`). */
  stop(child?: ChildProcess): void {
    if (child && this.children.has(child)) {
      child.kill("SIGTERM");
      this.children.delete(child);
    }
  }

  /**
   * terminal mode: show the command in a real integrated terminal and run it.
   * Terminals are keyed by name (the tool label) so two different tools can run
   * side by side, while re-running the same tool reuses its terminal.
   */
  runInTerminal(command: string, cwd: string, name: string): void {
    fs.mkdirSync(cwd, { recursive: true });
    let terminal = this.terminals.get(name);
    if (!terminal || terminal.exitStatus !== undefined) {
      terminal = vscode.window.createTerminal({ name: `Toolbox: ${name}`, cwd });
      this.terminals.set(name, terminal);
    }
    terminal.show(true);
    terminal.sendText(command);
  }

  dispose(): void {
    for (const child of this.children) {
      child.kill("SIGTERM");
    }
    this.children.clear();
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}
