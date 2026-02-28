import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { WeftNode, NodeState } from '../../../shared/types.ts';
import { OverlapBadge } from '../ui/OverlapBadge.tsx';
import { StageBadge } from '../ui/StageBadge.tsx';
import { HumanFlash } from '../ui/HumanFlash.tsx';
import { EditableTitle } from '../ui/EditableTitle.tsx';

const STATE_STYLES: Record<NodeState, string> = {
  idle: 'border-zinc-500',
  running: 'border-blue-500',
  'needs-human': 'border-red-500 needs-human-pulse',
  completed: 'border-green-500',
  crashed: 'border-red-600',
};

const STATE_DOT: Record<NodeState, string> = {
  idle: 'bg-zinc-500',
  running: 'bg-blue-500',
  'needs-human': 'bg-red-500',
  completed: 'bg-green-500',
  crashed: 'bg-red-600',
};

interface SubtaskNodeData extends WeftNode {
  onSpawn?: (nodeId: string, spawnType: 'feature' | 'subtask') => void;
  onUpdateTitle?: (nodeId: string, title: string) => void;
}

export function SubtaskNode({ data }: NodeProps) {
  const node = data as unknown as SubtaskNodeData;
  const borderClass = STATE_STYLES[node.nodeState] ?? STATE_STYLES.idle;
  const dotClass = STATE_DOT[node.nodeState] ?? STATE_DOT.idle;

  return (
    <div className={`min-w-[140px] rounded-md border-l-3 ${borderClass} bg-zinc-800/90 px-3 py-2 shadow-md`}>
      <div className="flex items-center gap-1.5">
        <div className={`h-2 w-2 rounded-full ${dotClass} shrink-0`} />
        <EditableTitle
          title={node.title}
          nodeId={node.id}
          onUpdateTitle={node.onUpdateTitle ?? (() => {})}
          className="text-xs font-medium text-zinc-200"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            node.onSpawn?.(node.id, 'subtask');
          }}
          className="rounded bg-zinc-600/40 p-0.5 text-zinc-400 hover:bg-zinc-600/70 hover:text-zinc-200 transition-colors shrink-0"
          title="Spawn Subtask"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <StageBadge displayStage={node.displayStage} nodeState={node.nodeState} />
        {node.nodeState === 'running' && <OverlapBadge overlap={node.overlap} />}
      </div>
      <HumanFlash needsHuman={node.needsHuman} humanNeededType={node.humanNeededType} />
      <Handle type="target" position={Position.Left} className="!bg-zinc-400" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-400" />
    </div>
  );
}
