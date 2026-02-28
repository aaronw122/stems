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
  parentNodeId: _parentNodeId,
  spawnType,
}: PromptEditorProps) {
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  // Reset prompt when modal opens
  useEffect(() => {
    if (isOpen) {
      setPrompt('');
    }
  }, [isOpen]);

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
      : 'Describe the subtask...\n\nContext from the parent task will be provided automatically.';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] rounded-lg border border-zinc-700 bg-zinc-800 p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-zinc-100">{title}</h2>

        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={6}
          className="mb-2 w-full resize-none rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500"
        />

        <div className="mb-4 text-xs text-zinc-500">
          Press Cmd+Enter to launch
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
