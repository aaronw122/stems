import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import AnsiToHtml from 'ansi-to-html';
import { useTerminal } from '../../hooks/useTerminal.ts';

interface TerminalPeekProps {
  nodeId: string;
  nodeTitle: string;
  onClose: () => void;
  onSendInput: (text: string) => void;
}

export function TerminalPeek({ nodeId, nodeTitle, onClose, onSendInput }: TerminalPeekProps) {
  const [input, setInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLineCountRef = useRef(0);

  const converter = useMemo(
    () => new AnsiToHtml({ fg: '#d4d4d4', bg: '#1a1a1a', newline: false }),
    [],
  );

  const lines = useTerminal((s) => s.buffers.get(nodeId) ?? []);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (lines.length !== prevLineCountRef.current) {
      prevLineCountRef.current = lines.length;
      if (autoScroll && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [lines, autoScroll]);

  // Detect scroll position to toggle auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If user is within 40px of the bottom, re-enable auto-scroll
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (trimmed) {
      onSendInput(trimmed);
      setInput('');
    }
  }, [input, onSendInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="absolute top-0 right-0 bottom-0 z-40 flex w-[480px] flex-col border-l border-zinc-700 bg-[#1a1a1a] shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
        <div className="text-sm font-medium text-zinc-200 truncate">{nodeTitle}</div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          aria-label="Close terminal"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Terminal output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2"
      >
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">
          {lines.map((line, i) => (
            <div
              key={i}
              dangerouslySetInnerHTML={{ __html: converter.toHtml(line) }}
            />
          ))}
          {lines.length === 0 && (
            <span className="text-zinc-600">Waiting for output...</span>
          )}
        </pre>
      </div>

      {/* Scroll indicator */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className="mx-4 mb-1 rounded bg-zinc-700/80 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Scroll to bottom
        </button>
      )}

      {/* Input area */}
      <div className="flex items-center gap-2 border-t border-zinc-700 px-4 py-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send input to session..."
          className="flex-1 rounded-md border border-zinc-600 bg-zinc-900 px-3 py-1.5 font-mono text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}
