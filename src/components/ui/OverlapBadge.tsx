interface OverlapBadgeProps {
  overlap: { hasOverlap: boolean; overlappingNodes: string[] };
}

export function OverlapBadge({ overlap }: OverlapBadgeProps) {
  if (!overlap.hasOverlap) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-1.5 py-0.5 text-[10px] text-green-400"
        title="No file conflicts"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
        clear
      </span>
    );
  }

  const count = overlap.overlappingNodes.length;
  const tooltip = `File conflict with ${count} node${count > 1 ? 's' : ''}: ${overlap.overlappingNodes.join(', ')}`;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-red-900/30 px-1.5 py-0.5 text-[10px] text-red-400"
      title={tooltip}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
      {count} overlap{count > 1 ? 's' : ''}
    </span>
  );
}
