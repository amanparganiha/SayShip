export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string };

/** ["components/Card.jsx", "App.jsx"] -> nested folders first (a-z), then files; App.jsx last. */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of paths) {
    const parts = path.split("/");
    let level = root;
    parts.forEach((name, i) => {
      const sub = parts.slice(0, i + 1).join("/");
      if (i === parts.length - 1) {
        level.push({ kind: "file", name, path: sub });
        return;
      }
      let folder = level.find((n): n is Extract<TreeNode, { kind: "folder" }> => n.kind === "folder" && n.name === name);
      if (!folder) {
        folder = { kind: "folder", name, path: sub, children: [] };
        level.push(folder);
      }
      level = folder.children;
    });
  }
  return sortNodes(root);
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((n) => (n.kind === "folder" ? { ...n, children: sortNodes(n.children) } : n))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      if (a.name === "App.jsx") return 1;
      if (b.name === "App.jsx") return -1;
      return a.name.localeCompare(b.name);
    });
}
