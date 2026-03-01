import { useState, useCallback, useRef, useEffect } from 'react';

interface PromptEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
  parentNodeId: string;
  spawnType: 'feature' | 'subtask';
}

export function PromptEditor({
  isOpen,
  onClose,
  onSubmit,
  parentNodeId,
  spawnType,
}: PromptEditorProps) {
  const [prompt, setPrompt] = useState('');
  const [loadingContext, setLoadingContext] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && textareaRef.current && !loadingContext) {
      textareaRef.current.focus();
    }
  }, [isOpen, loadingContext]);

  // Fetch context summary for subtasks, reset for features
  useEffect(() => {
    if (!isOpen) return;

    if (spawnType === 'subtask' && parentNodeId) {
      setLoadingContext(true);
      setPrompt('');
      fetch(`/api/context/${parentNodeId}`)
        .then((res) => res.json() as Promise<{ context?: string }>)
        .then((data) => {
          if (data.context) {
            setPrompt(`[Context: ${data.context}]\n\n`);
          }
        })
        .catch(() => {
          // Silently fall through — user can type from scratch
        })
        .finally(() => {
          setLoadingContext(false);
        });
    } else {
      setPrompt('');
      setLoadingContext(false);
    }
  }, [isOpen, spawnType, parentNodeId]);

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setPrompt('');
    }
  }, [prompt, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  if (!isOpen) return null;

  const title = spawnType === 'feature' ? 'New Feature' : 'New Subtask';
  const placeholder =
    spawnType === 'feature'
      ? 'Describe the feature to implement...'
      : 'Describe the subtask...';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] rounded-lg border border-zinc-700 bg-zinc-800 p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-zinc-100">{title}</h2>

        {loadingContext ? (
          <div className="mb-2 flex h-[144px] items-center justify-center rounded-md border border-zinc-600 bg-zinc-900">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Summarizing parent context...
            </div>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={6}
            className="mb-2 w-full resize-none rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500"
          />
        )}

        <div className="mb-4 text-xs text-zinc-500">
          {spawnType === 'subtask' && !loadingContext && prompt.startsWith('[Context:')
            ? 'Context pre-filled from parent session (editable). Press Cmd+Enter to launch.'
            : 'Press Cmd+Enter to launch'}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Launch
          </button>
        </div>
      </div>
    </div>
  );
}
