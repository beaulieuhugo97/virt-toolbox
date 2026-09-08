// Per-category tree icons. Keyed by a single path segment rather than the full
// category path, so a folder gets the same icon wherever it appears and new
// manifests reusing an existing folder name are covered for free.
const ICONS: Record<string, string> = {
  Virtual_Machines: "vm",
  Container: "package",
  Host: "server",
};

/** Codicon id for a category, by its last path segment. Falls back to a folder. */
export function categoryIcon(label: string): string {
  return ICONS[label] ?? "folder";
}
