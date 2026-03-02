import { useSubagents, type SubagentInfo } from '../../hooks/useSubagents.ts';
import { useGraph } from '../../hooks/useGraph.ts';

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

interface SubagentSummaryProps {
  /** The parent node ID whose subagents to display */
  parentNodeId: string;
}

/**
 * Live widget showing active subagent stats in the terminal panel.
 * Renders as a separate section above the terminal input, matching the
 * native Claude Code CLI display format:
 *
 *   Running 2 agents...
 *   |- agent name . 5 tool uses . 12.3k tokens
 *   |  '- current activity...
 */
export function SubagentSummary({ parentNodeId }: SubagentSummaryProps) {
  const edges = useGraph((s) => s.edges);
  const activeSubagents = useSubagents((s) => s.activeSubagents);

  // Find phantom child node IDs for this parent
  const childPhantomIds = new Set<string>();
  for (const edge of edges) {
    if (edge.source === parentNodeId && activeSubagents.has(edge.target)) {
      childPhantomIds.add(edge.target);
    }
  }

  // Collect running subagents for this parent
  const entries: [string, SubagentInfo][] = [];
  for (const id of childPhantomIds) {
    const info = activeSubagents.get(id);
    if (info && info.status === 'running') {
      entries.push([id, info]);
    }
  }

  if (entries.length === 0) return null;

  return (
    <div
      className="mx-4 mb-2 rounded border px-3 py-2 font-mono text-xs"
      style={{
        borderColor: 'var(--term-input-border)',
        backgroundColor: 'color-mix(in srgb, var(--term-bg) 80%, var(--term-input-bg))',
        color: 'var(--term-text-dim)',
      }}
    >
      <div className="font-medium" style={{ color: 'var(--term-text)' }}>
        Running {entries.length} agent{entries.length !== 1 ? 's' : ''}...
      </div>
      {entries.map(([id, info], i) => {
        const isLast = i === entries.length - 1;
        const connector = isLast ? '\u2514\u2500' : '\u251C\u2500';
        const indent = isLast ? '   ' : '\u2502  ';

        return (
          <div key={id} className="leading-relaxed">
            <div>
              <span className="text-zinc-600">{connector} </span>
              <span style={{ color: 'var(--term-text)' }}>{info.name}</span>
              <span className="text-zinc-600"> &middot; </span>
              <span>{info.toolUseCount} tool use{info.toolUseCount !== 1 ? 's' : ''}</span>
              <span className="text-zinc-600"> &middot; </span>
              <span>{formatTokens(info.totalTokens)} tokens</span>
            </div>
            {info.currentActivity && (
              <div className="italic text-zinc-600">
                {indent}<span className="text-zinc-700">{'\u21B3'}</span> {info.currentActivity}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
