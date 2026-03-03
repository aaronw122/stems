import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownViewerProps {
  filePath: string | null;
  onClose: () => void;
}

export function MarkdownViewer({ filePath, onClose }: MarkdownViewerProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) return;

    setLoading(true);
    setError(null);
    setContent('');

    fetch(`/api/read-file?path=${encodeURIComponent(filePath)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to read file (${res.status})`);
        return res.json() as Promise<{ content: string }>;
      })
      .then((data) => {
        setContent(data.content);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [filePath]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!filePath) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filePath, handleKeyDown]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!filePath) return null;

  const fileName = filePath.split('/').pop() ?? filePath;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div className="relative flex max-h-[80vh] w-[720px] flex-col rounded-lg border border-zinc-700 bg-zinc-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{fileName}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">{filePath}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M6 6L14 14M14 6L6 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex h-32 items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading...
              </div>
            </div>
          )}

          {error && (
            <div className="flex h-32 items-center justify-center">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!loading && !error && content && (
            <div className="markdown-viewer-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
