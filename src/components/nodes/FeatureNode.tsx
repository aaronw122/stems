import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { WeftNode, NodeState } from '../../../shared/types.ts';
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

interface FeatureNodeData extends WeftNode {
  onSpawn?: (nodeId: string, spawnType: 'feature' | 'subtask') => void;
  onUpdateTitle?: (nodeId: string, title: string) => void;
}

export function FeatureNode({ data }: NodeProps) {
  const node = data as unknown as FeatureNodeData;
  const borderClass = STATE_STYLES[node.nodeState] ?? STATE_STYLES.idle;
  const dotClass = STATE_DOT[node.nodeState] ?? STATE_DOT.idle;

  return (
    <div className={`min-w-[180px] rounded-lg border-l-4 ${borderClass} bg-zinc-800 px-4 py-3 shadow-lg`}>
      <div className="flex items-center gap-2">
        <div className={`h-2.5 w-2.5 rounded-full ${dotClass} shrink-0`} />
        <EditableTitle
          title={node.title}
          nodeId={node.id}
          onUpdateTitle={node.onUpdateTitle ?? (() => {})}
          className="text-sm font-medium text-zinc-100"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            node.onSpawn?.(node.id, 'subtask');
          }}
          className="rounded bg-blue-600/20 p-0.5 text-blue-400 hover:bg-blue-600/40 transition-colors shrink-0"
          title="Spawn Subtask"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <StageBadge displayStage={node.displayStage} nodeState={node.nodeState} />
      </div>
      <HumanFlash needsHuman={node.needsHuman} humanNeededType={node.humanNeededType} />
      <Handle type="target" position={Position.Left} className="!bg-zinc-400" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-400" />
    </div>
  );
}
