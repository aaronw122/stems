import type { DisplayStage, NodeState } from '../../../shared/types.ts';

const STAGE_STYLES: Record<DisplayStage, string> = {
  planning: 'bg-blue-500/20 text-blue-400',
  executing: 'bg-amber-500/20 text-amber-400',
  testing: 'bg-green-500/20 text-green-400',
};

const STAGE_LABELS: Record<DisplayStage, string> = {
  planning: 'Planning',
  executing: 'Executing',
  testing: 'Testing',
};

interface StageBadgeProps {
  displayStage: DisplayStage;
  nodeState: NodeState;
}

export function StageBadge({ displayStage, nodeState }: StageBadgeProps) {
  // Override display for terminal states
  if (nodeState === 'completed') {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-500/20 px-2 py-0.5 text-xs text-zinc-400">
        Done
      </span>
    );
  }

  if (nodeState === 'crashed') {
    return (
      <span className="inline-flex items-center rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
        Crashed
      </span>
    );
  }

  const style = STAGE_STYLES[displayStage] ?? STAGE_STYLES.planning;
  const label = STAGE_LABELS[displayStage] ?? 'Planning';

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${style}`}>
      {label}
    </span>
  );
}
