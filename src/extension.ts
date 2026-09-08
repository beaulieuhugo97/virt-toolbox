import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { Registry } from "./registry/registry";
import { ConfigStore } from "./config/configStore";
import { ExecutionEngine } from "./exec/engine";
import { HistoryStore } from "./history/historyStore";
import { FavoritesStore } from "./favorites/favoritesStore";
import { ToolTreeProvider, TreeNode } from "./tree/treeProvider";
import { ToolboxPanel } from "./webview/panel";
import { Updater } from "./update/updater";

const WALKTHROUGH_SHOWN_KEY = "virtToolbox.walkthroughShown";
const UPDATE_CHECKED_KEY = "virtToolbox.lastUpdateCheck";
/** Don't hit the network on every window open — check at most once every 6h. */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Where runs land — each tool's commands execute in `<outputsRoot>/<tool>/`, and
 * a `{out}` file is written there.
 *
 * This used to hunt for a folder containing `scripts/Tools/` and fall back to the
 * directory above the extension. That tied the working directory to a checkout
 * layout, and when the probe missed, runs executed inside VS Code's extensions
 * directory — which matters, because a command can use $PWD (docker mounts it).
 * It is now a fixed, documented location, overridable for anyone who wants runs
 * beside a project.
 */
function resolveOutputsRoot(): string {
  const configured = vscode.workspace
    .getConfiguration("virtToolbox")
    .get<string>("outputsPath", "")
    .trim();
  const raw = configured || path.join(os.homedir(), ".virt-toolbox", "outputs");
  return raw === "~" || raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(1)) : raw;
}

export function activate(context: vscode.ExtensionContext): void {
  const outputsRoot = resolveOutputsRoot();

  const registry = new Registry();
  const config = new ConfigStore(context.workspaceState);
  const engine = new ExecutionEngine();
  const favorites = new FavoritesStore(context.globalState);
  const history = new HistoryStore(context.workspaceState);
  const updater = new Updater(context);
  // through the generic form engine.
  const panel = new ToolboxPanel(context, registry, config, engine, history, favorites, outputsRoot);

  const tree = new ToolTreeProvider(registry, favorites);
  // createTreeView (vs registerTreeDataProvider) so `showCollapseAll` adds the
  // native "Collapse All" button to the Tools view title bar.
  const treeView = vscode.window.createTreeView("virtToolboxTools", {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  favorites.onDidChange(() => tree.refresh());

  // Surface an available update on the Tools view (a badge) and on Home (the
  // update button), without nagging with a notification.
  const applyUpdateInfo = (info: Awaited<ReturnType<Updater["check"]>>) => {
    panel.setUpdateInfo(
      info && { available: info.available, current: info.localVersion, latest: info.remoteVersion, behind: info.behind }
    );
    treeView.badge = info?.available
      ? {
          value: info.behind,
          tooltip: `Virtualization Toolbox update available${info.remoteVersion ? ` (v${info.remoteVersion})` : ""}`,
        }
      : undefined;
  };

  const checkForUpdate = async (silent: boolean) => {
    const info = await updater.check().catch(() => undefined);
    applyUpdateInfo(info);
    if (silent) return;
    if (!info) {
      void vscode.window.showErrorMessage(
        'Could not check for Virtualization Toolbox updates — see the "Virtualization Toolbox Update" output.'
      );
      return;
    }
    if (!info.available) {
      void vscode.window.showInformationMessage(`Virtualization Toolbox is up to date (v${info.localVersion}).`);
      return;
    }
    const pick = await vscode.window.showInformationMessage(
      `Virtualization Toolbox update available${info.remoteVersion ? `: v${info.localVersion} → v${info.remoteVersion}` : ""}.`,
      "Update Now"
    );
    if (pick) await updater.update();
  };

  // Background check on activation, throttled, and opt-out via setting.
  if (vscode.workspace.getConfiguration("virtToolbox").get<boolean>("checkForUpdatesOnStartup", true)) {
    const last = context.globalState.get<number>(UPDATE_CHECKED_KEY, 0);
    if (Date.now() - last > UPDATE_CHECK_INTERVAL_MS) {
      void context.globalState.update(UPDATE_CHECKED_KEY, Date.now());
      void checkForUpdate(true);
    }
  }

  // Status bar: a spinner while a captured run is in flight, click to configure.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "virtToolbox.openConfig";
  const showIdle = () => {
    statusBar.text = "$(vm) Virtualization";
    statusBar.tooltip = "Virtualization Toolbox — click to configure";
    statusBar.show();
  };
  showIdle();
  panel.onRunStateChange((s) => {
    if (s.running) {
      statusBar.text = `$(sync~spin) running ${s.label ?? ""}`.trim();
      statusBar.tooltip = "Virtualization Toolbox — a captured run is in progress";
    } else {
      showIdle();
    }
  });

  // Fuzzy "Find Tool" picker. An optional prefill lets the home category cards
  // open it scoped to a category.
  const findTool = (prefill?: string) => {
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { id: string }>();
    qp.title = "Find a tool";
    qp.placeholder = "Type a tool or category name…";
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.items = registry
      .all()
      .map((t) => ({
        id: t.id,
        label: t.label ?? t.id,
        description: t.category,
        detail: (t.deps ?? []).join(", ") || undefined,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (prefill) qp.value = prefill;
    qp.onDidAccept(() => {
      const pick = qp.selectedItems[0];
      if (pick) panel.openTool(pick.id);
      qp.hide();
    });
    qp.onDidHide(() => qp.dispose());
    qp.show();
  };

  // Show the walkthrough on the very first reveal; on later reveals land on Home
  // (unless the user turned that off).
  let firstRevealHandled = false;
  treeView.onDidChangeVisibility((e) => {
    if (!e.visible || firstRevealHandled) return;
    firstRevealHandled = true;
    if (!context.globalState.get(WALKTHROUGH_SHOWN_KEY)) {
      void context.globalState.update(WALKTHROUGH_SHOWN_KEY, true);
      void vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "hugoquebec.virt-toolbox#getStarted",
        false
      );
      return;
    }
    if (vscode.workspace.getConfiguration("virtToolbox").get<boolean>("autoOpenHome", true)) {
      panel.openHome();
    }
  });

  context.subscriptions.push(
    treeView,
    statusBar,
    vscode.commands.registerCommand("virtToolbox.findTool", (prefill?: string) =>
      findTool(typeof prefill === "string" ? prefill : undefined)
    ),
    vscode.commands.registerCommand("virtToolbox.home", () => panel.openHome()),
    vscode.commands.registerCommand("virtToolbox.openTool", (toolId: string) => panel.openTool(toolId)),
    vscode.commands.registerCommand("virtToolbox.openConfig", () => panel.openConfig()),
    vscode.commands.registerCommand("virtToolbox.history", () => panel.openHistory()),
    vscode.commands.registerCommand("virtToolbox.refresh", () => tree.refresh()),
    vscode.commands.registerCommand("virtToolbox.update", async () => {
      await updater.update();
      await checkForUpdate(true);
    }),
    vscode.commands.registerCommand("virtToolbox.checkForUpdate", () => checkForUpdate(false)),
    vscode.commands.registerCommand("virtToolbox.toggleTheme", async () => {
      const cfg = vscode.workspace.getConfiguration("virtToolbox");
      const next = cfg.get<string>("theme", "adaptive") === "htb" ? "adaptive" : "htb";
      await cfg.update("theme", next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`Virtualization Toolbox theme: ${next}`, 2000);
    }),
    vscode.commands.registerCommand("virtToolbox.toggleFavorite", (node?: TreeNode | string) => {
      const id = typeof node === "string" ? node : node?.kind === "tool" ? node.tool.id : undefined;
      if (id) void favorites.toggle(id);
    }),
    updater,
    { dispose: () => engine.dispose() },
    { dispose: () => panel.dispose() }
  );
}

export function deactivate(): void {
  // Subscriptions handle teardown.
}
