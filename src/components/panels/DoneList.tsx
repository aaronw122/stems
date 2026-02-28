import type { WeftNode } from '../../../shared/types.ts';
import { PRBadge } from '../ui/PRBadge.tsx';

interface DoneListProps {
  doneList: WeftNode[];
  isOpen: boolean;
  onToggle: () => void;
}

export function DoneList({ doneList, isOpen, onToggle }: DoneListProps) {
  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={onToggle}
        className="absolute top-4 right-40 z-20 flex items-center gap-1.5 rounded-md bg-zinc-800/80 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur hover:bg-zinc-700/80 transition-colors"
        title={isOpen ? 'Hide done list' : 'Show done list'}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 7.5l2.5 2.5L11 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Done ({doneList.length})
      </button>

      {/* Sidebar panel */}
      {isOpen && (
        <div className="absolute top-14 right-4 z-20 w-72 max-h-[70vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-2xl backdrop-blur">
          <div className="sticky top-0 flex items-center justify-between border-b border-zinc-700 bg-zinc-900/95 px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-200">Completed</h3>
            <button
              onClick={onToggle}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {doneList.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-500">
              No completed items yet
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {doneList.map((node) => (
                <li key={node.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-2">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      className="mt-0.5 shrink-0 text-green-500"
                    >
                      <path
                        d="M3 7.5l2.5 2.5L11 4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-zinc-300">
                        {node.title}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] text-zinc-500">{node.type}</span>
                        <PRBadge prUrl={node.prUrl} prState={node.prState} />
                        {node.costUsd > 0 && (
                          <span className="text-[10px] text-zinc-500">
                            ${node.costUsd.toFixed(4)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
