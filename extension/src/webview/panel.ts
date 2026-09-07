import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { exec, ChildProcess } from "child_process";
import { Registry } from "../registry/registry";
import { ConfigStore } from "../config/configStore";
import { ExecutionEngine } from "../exec/engine";
import { CustomPanelHost } from "../custom/types";
import { CONFIG_GROUPS } from "../config/configMenus";
import { resolveCommand, resolveNotes } from "../template/resolver";
import { HistoryStore } from "../history/historyStore";
import { FavoritesStore } from "../favorites/favoritesStore";
import { categoryIcon } from "../tree/categoryIcons";
import { getHtml } from "./html";
import { Tool } from "../types";

/** A `file` field whose current path does not exist — surfaced under the field. */
interface FileWarning {
  fieldId: string;
  path: string;
  /** True when it lives in the wordlists directory, so we can offer the download. */
  isWordlist: boolean;
}

type View =
  | { kind: "home" }
  | { kind: "tool"; toolId: string }
  | { kind: "config" }
  | { kind: "custom"; toolId: string }
  | { kind: "history" };

/**
 * One open webview tab. Each tool opens in its own tab so several tools can be
 * used (and run) at once; home/config/history share a single "dashboard" tab.
 * A session owns its in-flight captured run so tabs run independently.
 */
interface Session {
  panel: vscode.WebviewPanel;
  view: View;
  activeCustom?: CustomPanelHost;
  /** Subscription to `activeCustom.onEvent`, torn down when the view changes. */
  customEvents?: vscode.Disposable;
  captured?: ChildProcess;
}

// Curated quick-launch set for the home dashboard — the tools reached for first
// in a typical engagement. Filtered against the registry so a removed tool just
// drops out. Recently-run tools are prepended ahead of these at build time.
const QUICK_TOOL_IDS = [
  "nmap", "ffuf", "gobuster", "nxc", "smbclient", "bloodhound",
  "impacket", "evil-winrm", "hashcat", "hydra", "metasploit", "wordlists-download",
];

/** Config keys that name a wordlist — a missing one of these offers the download. */
const WORDLIST_CONFIG_KEYS = new Set(
  CONFIG_GROUPS.find((g) => g.title === "Wordlists")?.items.map((i) => i.key) ?? []
);

// The config keys surfaced on the dashboard's target card (label → key).
const HOME_CONFIG: { label: string; key: string }[] = [
  { label: "Local IP (LIP)", key: "LIP" },
  { label: "Local port (LPORT)", key: "LPORT" },
  { label: "Remote host (RHOST)", key: "RHOST" },
  { label: "Remote IP (RIP)", key: "RIP" },
  { label: "Username (RUSER)", key: "RUSER" },
  { label: "Domain (DOMAIN)", key: "DOMAIN" },
  { label: "DC IP (DC_IP)", key: "DC_IP" },
];

/**
 * Owns every webview tab and brokers each message between the sandboxed
 * front-ends and the host. The webview never touches the shell — it asks the
 * host to resolve/run, and the host is the sole authority on the command string.
 */
export class ToolboxPanel {
  /** Shared tab for the singleton views (home/config/history). */
  private dashboard?: Session;
  /** One tab per tool (tool + custom panels), keyed by tool id. */
  private toolSessions = new Map<string, Session>();

  /** Number of captured runs in flight across all tabs (drives the status bar). */
  private runningCount = 0;

  /** Latest self-update check result, surfaced on the home dashboard's button. */
  private updateInfo?: { available: boolean; current?: string; latest?: string; behind?: number };

  /** Set only in host mode — drives the dashboard's "limited tool set" banner. */
  private hostInfo?: { mode: string; name: string; shown: number; total: number };

  private runEmitter = new vscode.EventEmitter<{ running: boolean; label?: string }>();
  /** Fires when a captured run starts/finishes, so the status bar can reflect it. */
  readonly onRunStateChange = this.runEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly registry: Registry,
    private readonly config: ConfigStore,
    private readonly engine: ExecutionEngine,
    private readonly customPanels: Record<string, CustomPanelHost>,
    private readonly history: HistoryStore,
    private readonly favorites: FavoritesStore,
    private readonly outputsRoot: string
  ) {
    // Live config edits refresh every open tool form (defaults), the config view,
    // and the home dashboard's target card.
    config.onDidChange(() => this.forEachSession((s) => this.refreshSession(s)));
    // Keep open History views (and the home dashboard's activity list) current.
    history.onDidChange(() =>
      this.forEachSession((s) => {
        if (s.view.kind === "history" || s.view.kind === "home") this.refreshSession(s);
      })
    );
    // Reflect starred/unstarred tools live in each open tool view and on Home.
    favorites.onDidChange(() =>
      this.forEachSession((s) => {
        if (s.view.kind === "tool") {
          this.post(s, { type: "favorite", id: s.view.toolId, isFavorite: this.favorites.has(s.view.toolId) });
        } else if (s.view.kind === "home") {
          this.refreshSession(s);
        }
      })
    );
    // Re-theme every open tab live when the setting changes.
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("virtToolbox.theme")) {
          const theme = this.currentTheme();
          this.forEachSession((s) => this.post(s, { type: "setTheme", theme }));
        }
      })
    );
  }

  private currentTheme(): string {
    return vscode.workspace.getConfiguration("virtToolbox").get<string>("theme", "adaptive");
  }

  /** Record the last update-check result and refresh any open home dashboard. */
  setUpdateInfo(info?: { available: boolean; current?: string; latest?: string; behind?: number } | null): void {
    this.updateInfo = info || undefined;
    this.forEachSession((s) => {
      if (s.view.kind === "home") this.refreshSession(s);
    });
  }

  /** Tell the dashboard we're on a non-attack host (or clear it). */
  setHostInfo(info?: { mode: string; name: string; shown: number; total: number }): void {
    this.hostInfo = info;
    this.forEachSession((s) => {
      if (s.view.kind === "home") this.refreshSession(s);
    });
  }

  private forEachSession(fn: (s: Session) => void): void {
    if (this.dashboard) fn(this.dashboard);
    for (const s of this.toolSessions.values()) fn(s);
  }

  // ---- opening views ---------------------------------------------------------

  openHome(): void {
    const s = this.ensureDashboard();
    s.panel.title = "Virtualization Toolbox";
    s.view = { kind: "home" };
    this.refreshSession(s);
  }

  openConfig(): void {
    const s = this.ensureDashboard();
    s.panel.title = "Toolbox Config";
    s.view = { kind: "config" };
    this.refreshSession(s);
  }

  openHistory(): void {
    const s = this.ensureDashboard();
    s.panel.title = "Run History";
    s.view = { kind: "history" };
    this.refreshSession(s);
  }

  openTool(toolId: string): void {
    const tool = this.registry.get(toolId);
    if (!tool) {
      return;
    }
    const existing = this.toolSessions.get(toolId);
    if (existing) {
      existing.panel.reveal();
      this.refreshSession(existing);
      return;
    }
    const view: View = tool.customPanel ? { kind: "custom", toolId } : { kind: "tool", toolId };
    const s = this.createSession(view, tool.label ?? tool.id);
    this.toolSessions.set(toolId, s);
    this.refreshSession(s);
  }

  private ensureDashboard(): Session {
    if (this.dashboard) {
      this.dashboard.panel.reveal();
      return this.dashboard;
    }
    this.dashboard = this.createSession({ kind: "home" }, "Virtualization Toolbox");
    return this.dashboard;
  }

  private createSession(view: View, title: string): Session {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      "virtToolbox.tool",
      title,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot] }
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg");
    panel.webview.html = getHtml(panel.webview, mediaRoot, this.currentTheme());

    const session: Session = { panel, view };
    panel.webview.onDidReceiveMessage((m) => this.onMessage(session, m));
    panel.onDidDispose(() => {
      session.customEvents?.dispose();
      session.customEvents = undefined;
      // Stop this tab's captured run and forget the session.
      if (session.captured) {
        this.engine.stop(session.captured);
        session.captured = undefined;
        this.decRun();
      }
      if (this.dashboard === session) {
        this.dashboard = undefined;
      } else if (session.view.kind === "tool" || session.view.kind === "custom") {
        this.toolSessions.delete(session.view.toolId);
      }
    });
    return session;
  }

  private post(session: Session, msg: unknown): void {
    session.panel.webview.postMessage(msg);
  }

  private incRun(label?: string): void {
    this.runningCount++;
    this.runEmitter.fire({ running: true, label });
  }

  private decRun(): void {
    this.runningCount = Math.max(0, this.runningCount - 1);
    if (this.runningCount === 0) this.runEmitter.fire({ running: false });
  }

  // ---- rendering a session ---------------------------------------------------

  private refreshSession(session: Session): void {
    const view = session.view;
    if (view.kind === "home") {
      this.post(session, { type: "showHome", ...this.buildHome() });
      return;
    }
    if (view.kind === "history") {
      this.post(session, { type: "showHistory", entries: this.history.all() });
      return;
    }
    if (view.kind === "config") {
      this.post(session, {
        type: "showConfig",
        groups: CONFIG_GROUPS,
        values: this.config.getAll(),
        interfaces: listInterfaces(),
      });
      return;
    }
    const tool = this.registry.get(view.toolId);
    if (!tool) {
      return;
    }
    if (view.kind === "custom") {
      const host = tool.customPanel ? this.customPanels[tool.customPanel] : undefined;
      session.activeCustom = host;
      // A panel that pushes results on its own (download progress) gets its
      // events forwarded to this tab for as long as the tab shows it.
      session.customEvents?.dispose();
      session.customEvents = host?.onEvent?.((result) => this.post(session, { type: "customResult", ...result }));
      if (host) {
        void Promise.resolve(host.initial()).then((state) =>
          this.post(session, { type: "showCustom", panel: tool.customPanel, label: tool.label ?? tool.id, state })
        );
      }
      return;
    }
    this.post(session, {
      type: "showTool",
      tool: this.registry.serialize(tool, this.config),
      interfaces: listInterfaces(),
      isFavorite: this.favorites.has(tool.id),
    });
    void this.checkGates(session, tool);
  }

  /** Assemble the home dashboard payload from data the host already holds. */
  private buildHome() {
    const tools = this.registry.all();

    // Top-level category counts, for the clickable category grid.
    const counts = new Map<string, number>();
    for (const t of tools) {
      const top = t.category.split("/")[0];
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    const categories = [...counts.entries()]
      .map(([name, count]) => ({ name, count, icon: categoryIcon(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Quick launch: starred tools first, then most-recently-run, then the
    // curated set — all validated against the registry so nothing dangles.
    const recentIds: string[] = [];
    for (const r of this.history.all()) {
      if (!recentIds.includes(r.toolId)) recentIds.push(r.toolId);
    }
    const quickIds: string[] = [];
    for (const id of [...this.favorites.all(), ...recentIds, ...QUICK_TOOL_IDS]) {
      if (!quickIds.includes(id) && this.registry.get(id)) quickIds.push(id);
    }
    const favSet = new Set(this.favorites.all());
    const quickTools = quickIds.slice(0, 10).map((id) => {
      const t = this.registry.get(id)!;
      return { id, label: t.label ?? t.id, category: t.category, favorite: favSet.has(id) };
    });

    const config = HOME_CONFIG.map(({ label, key }) => ({ label, key, value: this.config.get(key) }));

    return {
      stats: {
        toolCount: tools.length,
        categoryCount: counts.size,
        runCount: this.history.all().length,
      },
      categories,
      config,
      quickTools,
      recent: this.history.all().slice(0, 6),
      update: this.updateInfo,
      host: this.hostInfo,
    };
  }

  /** Check every gate (deps on PATH, venv dir present, service active, group membership). */
  private async checkGates(session: Session, tool: Tool): Promise<void> {
    const run = (cmd: string) =>
      new Promise<boolean>((resolve) =>
        exec(cmd, { shell: "/bin/bash" }, (err) => resolve(!err))
      );

    const deps = await Promise.all(
      (tool.deps ?? []).map(async (name) => ({ name, ok: await run(`command -v ${name}`) }))
    );

    const verify = await Promise.all(
      (tool.verify ?? []).map(async (v) => ({ label: v.label, ok: await run(v.command), hint: v.hint }))
    );

    let venv: { name: string; present: boolean } | undefined;
    if (tool.venv) {
      const dir = path.join(this.outputsRoot, tool.outputDir ?? tool.id, tool.venv);
      venv = { name: tool.venv, present: fs.existsSync(dir) };
    }

    let service: { name: string; active: boolean } | undefined;
    if (tool.service) {
      service = { name: tool.service, active: await run(`systemctl is-active --quiet ${tool.service}`) };
    }

    let group: { name: string; member: boolean } | undefined;
    if (tool.group) {
      group = { name: tool.group, member: await run(`id -nG | tr ' ' '\\n' | grep -qx ${tool.group}`) };
    }

    this.post(session, { type: "gateStatus", toolId: tool.id, deps, verify, venv, service, group });
  }

  // ---- message handling ------------------------------------------------------

  private onMessage(session: Session, m: any): void {
    switch (m?.type) {
      case "ready":
        this.refreshSession(session);
        break;
      case "resolve":
        this.handleResolve(session, m.toolId, m.state);
        break;
      case "run":
        this.handleRun(session, m.toolId, m.actionId, m.state, m.mode);
        break;
      case "stop":
        if (session.captured) {
          this.engine.stop(session.captured);
          session.captured = undefined;
          this.decRun();
        }
        this.post(session, { type: "stopped" });
        break;
      case "pickFile":
        void this.handlePickFile(session, m.fieldId, m.fileKind, m.rootConfig);
        break;
      case "saveConfig":
        void this.config.set(m.key, m.value);
        break;
      case "openFile":
        void vscode.window.showTextDocument(vscode.Uri.file(m.path));
        break;
      case "rerun": {
        const rec = this.history.get(m.id);
        if (rec) this.engine.runInTerminal(rec.command, rec.cwd, rec.toolLabel);
        break;
      }
      case "clearHistory":
        this.history.clear();
        break;
      case "openTool":
        this.openTool(m.toolId);
        break;
      case "openHome":
        this.openHome();
        break;
      case "openConfig":
        this.openConfig();
        break;
      case "openHistory":
        this.openHistory();
        break;
      case "startService":
        this.engine.runInTerminal(`sudo systemctl start ${m.service}`, this.outputsRoot, `start ${m.service}`);
        break;
      case "addGroup":
        this.engine.runInTerminal(
          `sudo usermod -aG ${m.group} "$USER" && echo 'Log out and back in for group membership to take effect.'`,
          this.outputsRoot,
          `add group ${m.group}`
        );
        break;
      case "customAction":
        void this.handleCustomAction(session, m.action, m.payload);
        break;
      case "toggleFavorite":
        if (m.toolId) void this.favorites.toggle(m.toolId);
        break;
      case "findInCategory":
        void vscode.commands.executeCommand("virtToolbox.findTool", m.category);
        break;
      case "update":
        void vscode.commands.executeCommand("virtToolbox.update");
        break;
      case "showAllTools":
        void vscode.commands.executeCommand("virtToolbox.showAllTools");
        break;
    }
  }

  /** Resolve every action + the notes in one round-trip, so the whole preview updates together. */
  private handleResolve(session: Session, toolId: string, state: Record<string, string>): void {
    const tool = this.registry.get(toolId);
    if (!tool) {
      return;
    }
    const commands: Record<string, { command: string; outputFile?: string }> = {};
    for (const action of tool.actions ?? []) {
      const r = resolveCommand(tool, action, state, this.config, this.outputsRoot);
      commands[action.id] = { command: r.command, outputFile: r.outputFile };
    }
    this.post(session, {
      type: "resolved",
      commands,
      notes: resolveNotes(tool, state, this.config),
      fileWarnings: this.missingFiles(tool, state),
    });
  }

  /**
   * Which `file` fields point at something that isn't there. The common case is
   * a default wordlist (gobuster's {DIR_WORDLIST}) on a box where the wordlists
   * were never downloaded — the run would fail with a bare "no such file", so
   * the form says so first, and offers the download. Re-computed on every
   * keystroke-driven resolve, so the warning clears as soon as the path is good.
   */
  private missingFiles(tool: Tool, state: Record<string, string>): FileWarning[] {
    const out: FileWarning[] = [];
    for (const field of tool.fields ?? []) {
      if (field.type !== "file") continue;
      const value = (state[field.id] ?? "").trim();
      // An empty optional path is not a problem; an unresolved {TOKEN} means the
      // config key behind it is blank, which is a configuration problem, not a
      // missing file.
      if (!value || value.includes("{")) continue;
      const resolved = value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
      if (fs.existsSync(resolved)) continue;
      const isWordlist =
        (field.rootConfig !== undefined && WORDLIST_CONFIG_KEYS.has(field.rootConfig)) ||
        resolved.startsWith(expandTilde(this.config.get("WORDLISTS_DIR")));
      out.push({ fieldId: field.id, path: resolved, isWordlist });
    }
    return out;
  }

  private handleRun(
    session: Session,
    toolId: string,
    actionId: string,
    state: Record<string, string>,
    forceMode?: "terminal" | "captured"
  ): void {
    const tool = this.registry.get(toolId);
    const action = tool?.actions?.find((a) => a.id === actionId);
    if (!tool || !action) {
      return;
    }
    const r = resolveCommand(tool, action, state, this.config, this.outputsRoot);
    const mode = forceMode ?? action.mode;
    const record = {
      toolId: tool.id,
      toolLabel: tool.label ?? tool.id,
      actionLabel: action.label,
      command: r.command,
      cwd: r.cwd,
      mode,
      outputFile: r.outputFile,
    };

    if (mode === "terminal") {
      this.engine.runInTerminal(r.command, r.cwd, tool.label ?? tool.id);
      this.history.add(record);
      this.post(session, { type: "running", inTerminal: true });
      return;
    }

    // Only one captured run per tab: stop this tab's previous run first.
    if (session.captured) {
      this.engine.stop(session.captured);
      session.captured = undefined;
      this.decRun();
    }

    const runId = this.history.add(record);
    this.post(session, { type: "running", inTerminal: false, command: r.command });
    this.incRun(tool.label ?? tool.id);
    session.captured = this.engine.runCaptured(
      r.command,
      r.cwd,
      action.parse,
      {
        onOutput: (chunk) => this.post(session, { type: "output", chunk }),
        onDone: ({ code, table }) => {
          session.captured = undefined;
          this.history.update(runId, { exitCode: code });
          this.decRun();
          this.post(session, { type: "done", code, table, outputFile: r.outputFile });
        },
      },
      r.outputFile
    );
  }

  private async handlePickFile(
    session: Session,
    fieldId: string,
    fileKind: "file" | "folder" | undefined,
    rootConfig: string | undefined
  ): Promise<void> {
    const folder = fileKind === "folder";
    const start = rootConfig ? this.config.get(rootConfig) : undefined;
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: !folder,
      canSelectFolders: folder,
      canSelectMany: false,
      defaultUri: start ? vscode.Uri.file(start.replace(/^~/, os.homedir())) : undefined,
    });
    if (picked && picked.length > 0) {
      this.post(session, { type: "fieldValue", fieldId, value: picked[0].fsPath });
    }
  }

  /** Generic custom-panel RPC: dispatch the action to the active panel module, post the result. */
  private async handleCustomAction(session: Session, action: string, payload: any): Promise<void> {
    if (!session.activeCustom) return;
    const result = await session.activeCustom.handle(action, payload);
    this.post(session, { type: "customResult", ...result });
  }

  dispose(): void {
    this.dashboard?.panel.dispose();
    for (const s of [...this.toolSessions.values()]) s.panel.dispose();
    this.toolSessions.clear();
  }
}

/** Expand a leading ~ so a config path can be compared against a real one. */
function expandTilde(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function listInterfaces(): { name: string; address: string }[] {
  const out: { name: string; address: string }[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4") {
        out.push({ name, address: a.address });
      }
    }
  }
  return out;
}
