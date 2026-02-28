import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { WeftNode } from '../../../shared/types.ts';

export function RepoNode({ data }: NodeProps) {
  const node = data as unknown as WeftNode;
  const repoPath = node.repoPath ?? '';

  // Show last 2 path segments (e.g., "aaron/weft-flow")
  const segments = repoPath.split('/').filter(Boolean);
  const displayPath = segments.slice(-2).join('/');
  const branch = node.branch ?? 'main';

  return (
    <div className="min-w-[200px] rounded-lg border-l-4 border-l-green-500 bg-zinc-800 px-4 py-3 shadow-lg">
      <div className="text-sm font-semibold text-zinc-100">{displayPath || 'Unknown Repo'}</div>
      <div className="mt-1 text-xs text-zinc-400">{branch}</div>
      <Handle type="source" position={Position.Right} className="!bg-green-500" />
    </div>
  );
}
