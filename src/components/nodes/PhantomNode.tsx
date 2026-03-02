import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { WeftNode, NodeState } from '../../../shared/types.ts';

const STATE_STYLES: Record<NodeState, string> = {
  idle: 'border-zinc-600',
  running: 'border-violet-500/60',
  'needs-human': 'border-red-500/60',
  completed: 'border-green-500/60',
  crashed: 'border-red-600/60',
};

const STATE_DOT: Record<NodeState, string> = {
  idle: 'bg-zinc-500',
  running: 'bg-violet-400',
  'needs-human': 'bg-red-400',
  completed: 'bg-green-400',
  crashed: 'bg-red-500',
};

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function PhantomNode({ data }: NodeProps) {
  const node = data as unknown as WeftNode;
  const borderClass = STATE_STYLES[node.nodeState] ?? STATE_STYLES.idle;
  const dotClass = STATE_DOT[node.nodeState] ?? STATE_DOT.idle;

  const toolUseCount = node.toolUseCount ?? 0;
  const totalTokens = node.totalTokens ?? 0;
  const currentActivity = node.currentActivity ?? '';

  return (
    <div className={`min-w-[120px] max-w-[180px] rounded border-l-2 ${borderClass} bg-zinc-800/60 px-2.5 py-1.5 shadow-sm`}>
      {/* Header: dot + agent name */}
      <div className="flex items-center gap-1.5">
        <div className={`h-1.5 w-1.5 rounded-full ${dotClass} shrink-0`} />
        <span className="truncate text-[10px] font-medium text-zinc-300">
          {node.title}
        </span>
      </div>

      {/* Stats row: tool uses + tokens */}
      <div className="mt-1 flex items-center gap-2 text-[9px] text-zinc-500">
        <span>{toolUseCount} tool{toolUseCount !== 1 ? 's' : ''}</span>
        <span className="text-zinc-600">&middot;</span>
        <span>{formatTokens(totalTokens)} tokens</span>
      </div>

      {/* Activity status line */}
      {currentActivity && (
        <div className="mt-0.5 truncate text-[9px] text-zinc-500 italic">
          {currentActivity}
        </div>
      )}

      <Handle type="target" position={Position.Left} className="!bg-zinc-500 !w-1.5 !h-1.5" />
    </div>
  );
}
