import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import AnsiToHtml from 'ansi-to-html';
import { useTerminal } from '../../hooks/useTerminal.ts';
import { useFloatingWindow } from '../../hooks/useFloatingWindow.ts';

interface TerminalPeekProps {
  nodeId: string;
  nodeTitle: string;
  containerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onSendInput: (text: string) => void;
}

const EMPTY_LINES: string[] = [];

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const EDGE_CURSORS: Record<ResizeEdge, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};

export function TerminalPeek({ nodeId, nodeTitle, containerRef, onClose, onSendInput }: TerminalPeekProps) {
  const [input, setInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const prevLineCountRef = useRef(0);

  const converter = useMemo(
    () => new AnsiToHtml({ fg: '#ffb000', bg: '#1a1a1a', newline: false }),
    [],
  );

  const {
    rect,
    isGestureActive,
    onTitleBarPointerDown,
    onTitleBarPointerMove,
    onTitleBarPointerUp,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerUp,
    RESIZE_HANDLE_SIZE,
  } = useFloatingWindow(containerRef);

  const lines = useTerminal((s) => s.buffers.get(nodeId) ?? EMPTY_LINES);

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

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

  // Stop pointer events from reaching the canvas
  const stopPropagation = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  // Tab trapping within the terminal window
  const handleTabTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    const root = rootRef.current;
    if (!root) return;

    const focusable = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  // Resize handle component
  const renderResizeHandle = useCallback(
    (edge: ResizeEdge) => {
      const h = RESIZE_HANDLE_SIZE;
      const isCorner = edge.length === 2;
      const baseClass = isCorner ? 'terminal-resize-corner' : 'terminal-resize-edge';

      // Position styles for each edge/corner
      const positionStyles: Record<ResizeEdge, React.CSSProperties> = {
        n:  { top: -h / 2, left: h, right: h, height: h, cursor: EDGE_CURSORS.n },
        s:  { bottom: -h / 2, left: h, right: h, height: h, cursor: EDGE_CURSORS.s },
        e:  { top: h, right: -h / 2, bottom: h, width: h, cursor: EDGE_CURSORS.e },
        w:  { top: h, left: -h / 2, bottom: h, width: h, cursor: EDGE_CURSORS.w },
        nw: { top: -h / 2, left: -h / 2, width: h * 2, height: h * 2, cursor: EDGE_CURSORS.nw },
        ne: { top: -h / 2, right: -h / 2, width: h * 2, height: h * 2, cursor: EDGE_CURSORS.ne },
        sw: { bottom: -h / 2, left: -h / 2, width: h * 2, height: h * 2, cursor: EDGE_CURSORS.sw },
        se: { bottom: -h / 2, right: -h / 2, width: h * 2, height: h * 2, cursor: EDGE_CURSORS.se },
      };

      return (
        <div
          key={edge}
          className={`absolute z-50 ${baseClass} terminal-resize-handle--${edge}`}
          style={{ ...positionStyles[edge], position: 'absolute' }}
          onPointerDown={(e) => onResizePointerDown(edge, e)}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
      );
    },
    [RESIZE_HANDLE_SIZE, onResizePointerDown, onResizePointerMove, onResizePointerUp],
  );

  const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

  return (
    <div
      ref={rootRef}
      className="absolute z-40 flex flex-col overflow-hidden rounded-lg bg-[#1a1a1a] shadow-2xl terminal-floating-window"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        // Prevent user-select during drag/resize
        userSelect: isGestureActive() ? 'none' : undefined,
      }}
      onPointerDown={stopPropagation}
      onPointerMove={stopPropagation}
      onPointerUp={stopPropagation}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleTabTrap}
    >
      {/* Resize handles */}
      {edges.map(renderResizeHandle)}

      {/* Mac OS X-style title bar — drag handle */}
      <div
        className="terminal-titlebar flex items-center px-4 py-2.5 rounded-t-lg cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onTitleBarPointerDown}
        onPointerMove={onTitleBarPointerMove}
        onPointerUp={onTitleBarPointerUp}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
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

      {/* Terminal output — nowheel prevents React Flow panOnScroll */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="nowheel flex-1 overflow-y-auto px-4 py-3"
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
          ref={inputRef}
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
