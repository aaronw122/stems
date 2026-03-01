import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import AnsiToHtml from 'ansi-to-html';
import { useTerminal } from '../../hooks/useTerminal.ts';

interface TerminalPeekProps {
  nodeId: string;
  nodeTitle: string;
  onClose: () => void;
  onSendInput: (text: string) => void;
}

const EMPTY_LINES: string[] = [];

export function TerminalPeek({ nodeId, nodeTitle, onClose, onSendInput }: TerminalPeekProps) {
  const [input, setInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLineCountRef = useRef(0);

  const converter = useMemo(
    () => new AnsiToHtml({ fg: '#ffb000', bg: '#1a1a1a', newline: false }),
    [],
  );

  const lines = useTerminal((s) => s.buffers.get(nodeId) ?? EMPTY_LINES);

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
    <div className="absolute top-0 right-0 bottom-0 z-40 flex w-[480px] flex-col overflow-hidden rounded-l-lg bg-[#1a1a1a] shadow-2xl">
      {/* Mac OS X-style title bar */}
      <div className="terminal-titlebar flex items-center px-4 py-2.5 rounded-tl-lg">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="traffic-light traffic-light--red"
            aria-label="Close terminal"
          />
          <span className="traffic-light traffic-light--yellow" />
          <span className="traffic-light traffic-light--green" />
        </div>
        <div className="flex-1 text-center text-[13px] font-medium text-[#4a4a4a] truncate select-none">
          {nodeTitle}
        </div>
        {/* Spacer to balance the traffic lights */}
        <div className="w-[52px]" />
      </div>

      {/* Terminal output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        <pre className="terminal-glow whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[#ffb000]">
          {lines.map((line, i) => (
            <div
              key={i}
              dangerouslySetInnerHTML={{ __html: converter.toHtml(line) }}
            />
          ))}
          {lines.length === 0 && (
            <span className="text-[#7a5800]">
              Waiting for output...<span className="terminal-cursor" />
            </span>
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
          className="mx-4 mb-1 rounded bg-[#2a2000]/80 px-2 py-1 text-xs text-[#ffb000]/60 hover:text-[#ffb000] transition-colors"
        >
          Scroll to bottom
        </button>
      )}

      {/* Input area */}
      <div className="flex items-center gap-2 border-t border-[#3a3000] px-4 py-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send input to session..."
          className="flex-1 rounded-md border border-[#5a4500] bg-[#111000] px-3 py-1.5 font-mono text-sm text-[#ffb000] placeholder-[#7a5800] outline-none focus:border-[#ffb000]"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="rounded-md bg-[#2a2000] px-3 py-1.5 text-sm text-[#ffb000] hover:bg-[#3a3000] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}
