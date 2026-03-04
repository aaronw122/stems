function getContextColor(percent: number): string {
  if (percent >= 40) return 'text-green-500';
  if (percent >= 20) return 'text-orange-500';
  return 'text-red-500';
}

export function ContextBadge({ contextPercent }: { contextPercent: number | null }) {
  if (contextPercent == null) return null;

  const rounded = Math.round(contextPercent);
  const color = getContextColor(contextPercent);

  return (
    <span className={`absolute -top-5 right-0 text-[11px] font-medium ${color} pointer-events-none`}>
      {rounded}% context
    </span>
  );
}
