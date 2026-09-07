import * as vscode from "vscode";
import { Registry } from "../registry/registry";
import { FavoritesStore } from "../favorites/favoritesStore";
import { Tool } from "../types";
import { categoryIcon } from "./categoryIcons";

// A tree node is either a category (folder) or a tool (leaf). Categories are
// derived from each tool's slash-delimited `category`, so the tree mirrors the
// filesystem menu the TUI builds from scripts/Tools/.
interface CategoryNode {
  kind: "category";
  label: string;
  path: string;
  children: Map<string, CategoryNode>;
  tools: Tool[];
}

const FAVORITES_PATH = "★favorites";

function newCategory(label: string, path: string): CategoryNode {
  return { kind: "category", label, path, children: new Map(), tools: [] };
}

export class ToolTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private emitter = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private root = newCategory("", "");

  constructor(
    private readonly registry: Registry,
    private readonly favorites: FavoritesStore
  ) {
    this.rebuild();
  }

  refresh(): void {
    this.rebuild();
    this.emitter.fire();
  }

  private rebuild(): void {
    this.root = newCategory("", "");
    for (const tool of this.registry.all()) {
      const parts = tool.category.split("/").filter(Boolean);
      let node = this.root;
      let path = "";
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        if (!node.children.has(part)) {
          node.children.set(part, newCategory(part, path));
        }
        node = node.children.get(part)!;
      }
      node.tools.push(tool);
    }
  }

  /** The starred tools that still exist in the registry, as a synthetic folder. */
  private favoritesNode(): CategoryNode | undefined {
    const tools = this.favorites
      .all()
      .map((id) => this.registry.get(id))
      .filter((t): t is Tool => !!t);
    if (tools.length === 0) return undefined;
    const node = newCategory("Favorites", FAVORITES_PATH);
    node.tools = tools;
    return node;
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "tool") {
      const fav = this.favorites.has(node.tool.id);
      const item = new vscode.TreeItem(
        node.tool.label ?? node.tool.id,
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon(node.tool.customPanel ? "beaker" : "tools");
      if (fav) item.description = "★";
      item.command = {
        command: "virtToolbox.openTool",
        title: "Open Tool",
        arguments: [node.tool.id],
      };
      // The inline star toggle keys off contextValue; distinguish so the icon
      // reads as add-vs-remove could be added later.
      item.contextValue = fav ? "virtToolFav" : "virtTool";
      return item;
    }
    const isFavGroup = node.category.path === FAVORITES_PATH;
    const item = new vscode.TreeItem(
      node.category.label,
      isFavGroup
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    item.iconPath = new vscode.ThemeIcon(
      isFavGroup ? "star-full" : categoryIcon(node.category.label)
    );
    item.contextValue = "virtCategory";
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      const children: TreeNode[] = [];
      const fav = this.favoritesNode();
      if (fav) children.push({ kind: "category", category: fav });
      children.push(...this.categoryChildren(this.root));
      return children;
    }
    if (node.kind === "category") return this.categoryChildren(node.category);
    return [];
  }

  private categoryChildren(category: CategoryNode): TreeNode[] {
    const children: TreeNode[] = [];
    const subs = [...category.children.values()].sort((a, b) => a.label.localeCompare(b.label));
    for (const sub of subs) {
      children.push({ kind: "category", category: sub });
    }
    const tools = [...category.tools].sort((a, b) =>
      (a.label ?? a.id).localeCompare(b.label ?? b.id)
    );
    for (const tool of tools) {
      children.push({ kind: "tool", tool });
    }
    return children;
  }
}

export type TreeNode =
  | { kind: "category"; category: CategoryNode }
  | { kind: "tool"; tool: Tool };
