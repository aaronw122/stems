interface PRBadgeProps {
  prUrl: string | null;
  prState: 'open' | 'merged' | 'closed' | null;
}

export function PRBadge({ prUrl, prState }: PRBadgeProps) {
  if (!prUrl || !prState) return null;

  // Extract PR number from URL
  const match = prUrl.match(/\/pull\/(\d+)/);
  const prNumber = match ? match[1] : '?';

  const config = {
    open: {
      bg: 'bg-blue-900/30',
      text: 'text-blue-400',
      dot: 'bg-blue-400',
      label: `PR #${prNumber}`,
    },
    merged: {
      bg: 'bg-purple-900/30',
      text: 'text-purple-400',
      dot: 'bg-purple-400',
      label: 'Merged',
    },
    closed: {
      bg: 'bg-zinc-700/30',
      text: 'text-zinc-400',
      dot: 'bg-zinc-400',
      label: 'Closed',
    },
  } as const;

  const c = config[prState];

  return (
    <a
      href={prUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 rounded-full ${c.bg} px-1.5 py-0.5 text-[10px] ${c.text} hover:brightness-125 transition-all cursor-pointer no-underline`}
      title={prUrl}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </a>
  );
}
