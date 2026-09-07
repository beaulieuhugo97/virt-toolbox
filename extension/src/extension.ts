import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Registry } from "./registry/registry";
import { ConfigStore } from "./config/configStore";
import { ExecutionEngine } from "./exec/engine";
import { HistoryStore } from "./history/historyStore";
import { FavoritesStore } from "./favorites/favoritesStore";
import { ToolTreeProvider, TreeNode } from "./tree/treeProvider";
import { ToolboxPanel } from "./webview/panel";

const WALKTHROUGH_SHOWN_KEY = "virtToolbox.walkthroughShown";

/**
 * Locate the toolbox root — the folder containing `scripts/` — so runs land in
 * scripts/outputs/<tool>/ (the setup_directory convention). Prefer an open
 * workspace folder that contains scripts/; otherwise fall back to the folder
 * above the extension (the /extension subfolder layout).
 */
function findToolboxRoot(context: vscode.ExtensionContext): string {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (fs.existsSync(path.join(folder.uri.fsPath, "scripts", "Tools"))) {
      return folder.uri.fsPath;
    }
  }
  return path.dirname(context.extensionUri.fsPath);
}

export function activate(context: vscode.ExtensionContext): void {
  const toolboxRoot = findToolboxRoot(context);
  const outputsRoot = path.join(toolboxRoot, "scripts", "outputs");

  const registry = new Registry();
  const config = new ConfigStore(context.workspaceState);
  const engine = new ExecutionEngine();
  const favorites = new FavoritesStore(context.globalState);
  const history = new HistoryStore(context.workspaceState);
  // No bespoke customPanels in the virtualization toolbox — every tool renders
  // through the generic form engine.
  const panel = new ToolboxPanel(context, registry, config, engine, {}, history, favorites, outputsRoot);

  const tree = new ToolTreeProvider(registry, favorites);
  // createTreeView (vs registerTreeDataProvider) so `showCollapseAll` adds the
  // native "Collapse All" button to the Tools view title bar.
  const treeView = vscode.window.createTreeView("virtToolboxTools", {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  favorites.onDidChange(() => tree.refresh());

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
    { dispose: () => engine.dispose() },
    { dispose: () => panel.dispose() }
  );
}

export function deactivate(): void {
  // Subscriptions handle teardown.
}
