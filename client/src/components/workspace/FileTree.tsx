import clsx from "clsx";
import { Clock, FileCode2, Folder, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { buildTree, type TreeNode } from "../../lib/fileTree";
import { useWorkspace, type FileStatus } from "../../lib/workspaceStore";

function StatusIcon({ status }: { status: FileStatus | undefined }) {
  if (status === "streaming") return <Loader2 className="size-3 animate-spin text-indigo-400" aria-label="writing" />;
  if (status === "pending") return <Clock className="size-3 text-neutral-600" aria-label="queued" />;
  if (status === "changed") return <span className="size-1.5 rounded-full bg-amber-400" aria-label="changed in this version" />;
  return null;
}

export default function FileTree() {
  const order = useWorkspace((s) => s.order);
  const status = useWorkspace((s) => s.status);
  const selected = useWorkspace((s) => s.selected);
  const select = useWorkspace((s) => s.select);
  const tree = useMemo(() => buildTree(order), [order]);

  const renderNode = (node: TreeNode, depth: number) => {
    const pad = { paddingLeft: 8 + depth * 12 };
    if (node.kind === "folder") {
      return (
        <li key={node.path}>
          <div style={pad} className="flex items-center gap-1.5 py-1 text-xs text-neutral-500">
            <Folder className="size-3.5" /> {node.name}
          </div>
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        </li>
      );
    }
    const fileStatus = status[node.path];
    return (
      <li key={node.path}>
        <button
          style={pad}
          onClick={() => select(node.path)}
          disabled={fileStatus === "pending"}
          data-testid={`file-${node.path}`}
          data-status={fileStatus}
          className={clsx(
            "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs",
            selected === node.path ? "bg-neutral-800 text-white" : "text-neutral-300 hover:bg-neutral-900",
            fileStatus === "pending" && "cursor-default text-neutral-600",
          )}
        >
          <FileCode2 className="size-3.5 shrink-0 text-sky-400" />
          <span className="flex-1 truncate">{node.name}</span>
          <StatusIcon status={fileStatus} />
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="Files" className="h-full overflow-y-auto py-2" data-testid="file-tree">
      <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Files</div>
      {order.length === 0 ? (
        <p className="px-3 text-xs text-neutral-600">No files yet.</p>
      ) : (
        <ul>{tree.map((node) => renderNode(node, 0))}</ul>
      )}
    </nav>
  );
}
