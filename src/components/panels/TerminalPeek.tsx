import { useState, useCallback, useRef, useEffect } from 'react';
import { useTerminal } from '../../hooks/useTerminal.ts';
import { useFloatingWindow } from '../../hooks/useFloatingWindow.ts';
import { useGraph } from '../../hooks/useGraph.ts';
import { useAutocomplete } from '../../hooks/useAutocomplete.ts';
import type { TerminalMessage, WeftNode, ImageAttachment, QueuedMessage, AskUserQuestionPayload } from '../../../shared/types.ts';
import { TerminalMessageRenderer } from './TerminalMessageRenderer.tsx';
import { AutocompleteDropdown } from './AutocompleteDropdown.tsx';
import { SubagentSummary } from './SubagentSummary.tsx';
import { QuestionOptions } from './QuestionOptions.tsx';

// ── Thinking indicator ──────────────────────────────────────────────

const THINKING_WORDS = [
  'Pontificating', 'Ruminating', 'Cogitating', 'Deliberating',
  'Musing', 'Contemplating', 'Mulling', 'Reasoning',
];

function ThinkingIndicator({ nodeId }: { nodeId: string }) {
  const [elapsed, setElapsed] = useState(0);
  const [word] = useState(() => THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)]);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const timeStr = elapsed < 60
    ? `${elapsed}s`
    : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <div className="my-0.5 flex items-start gap-1.5">
      <span style={{ color: 'var(--term-tool-error)' }}>✱</span>
      <span style={{ color: 'var(--term-tool-error)' }}>
        {word}… ({timeStr} · thinking)
      </span>
    </div>
  );
}

interface TerminalPeekProps {
  nodeId: string;
  nodeTitle: string;
  containerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onSendInput: (text: string, images?: ImageAttachment[]) => void;
  onAnswerQuestion: (answer: string) => void;
  onStopSession: () => void;
  onDequeue: (action: 'pop_last' | 'clear_all') => void;
}

const EMPTY_MESSAGES: TerminalMessage[] = [];

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

export function TerminalPeek({ nodeId, nodeTitle, containerRef, onClose, onSendInput, onAnswerQuestion, onStopSession, onDequeue }: TerminalPeekProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [selectedChipIndex, setSelectedChipIndex] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [fontSize, setFontSize] = useState(12);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

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

  const autocomplete = useAutocomplete(nodeId);
  const [cursorAtEnd, setCursorAtEnd] = useState(true);
  const imageCounterRef = useRef(0);

  // ── Image attachment helpers ────────────────────────────────────────

  const readFileAsImage = useCallback((file: File): Promise<ImageAttachment> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // Strip the data URL prefix to get raw base64
        const base64 = dataUrl.split(',')[1] ?? '';
        const mediaType = file.type || 'image/png';
        const name = `Image ${imageCounterRef.current}`;
        imageCounterRef.current += 1;
        resolve({ data: base64, mediaType, name });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }, []);

  const addImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith('image/'),
      );
      if (imageFiles.length === 0) return;

      const newImages = await Promise.all(imageFiles.map(readFileAsImage));
      setImages((prev) => [...prev, ...newImages]);
      setSelectedChipIndex(null);
    },
    [readFileAsImage],
  );

  // ── Paste handler (Cmd+V with image data) ──────────────────────────

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        const hasImages = Array.from(files).some((f) => f.type.startsWith('image/'));
        if (hasImages) {
          e.preventDefault();
          addImageFiles(files);
        }
      }
    },
    [addImageFiles],
  );

  // ── Drag and drop handlers ─────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (e.dataTransfer?.files) {
        addImageFiles(e.dataTransfer.files);
      }
    },
    [addImageFiles],
  );

  const messages = useTerminal((s) => s.buffers.get(nodeId) ?? EMPTY_MESSAGES);
  const queuedMessages = useTerminal((s) => s.queues.get(nodeId));

  // Get the node data for thinking indicator + context bar
  const nodeData = useGraph((s) => {
    const flowNode = s.nodes.find((n) => n.id === nodeId);
    return flowNode?.data as WeftNode | undefined;
  });
  const nodeState = nodeData?.nodeState ?? 'idle';
  const contextPercent = nodeData?.contextPercent ?? null;

  // Parse structured question options from humanNeededPayload
  const questionPayload: AskUserQuestionPayload | null =
    nodeData?.humanNeededType === 'question' && nodeData.humanNeededPayload
      ? parseQuestionPayload(nodeData.humanNeededPayload)
      : null;

  // Find the session_banner message (may not be at index 0 — user prompt can arrive first)
  const bannerMsg = messages.find(m => m.type === 'session_banner');
  const bannerData = bannerMsg?.bannerData;

  // Show thinking indicator when node is running and last message isn't streaming text
  const lastMsg = messages[messages.length - 1];
  const showThinking = nodeState === 'running'
    && messages.length > 0
    && lastMsg?.type !== 'assistant_text';

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // Cmd+Plus / Cmd+Minus to zoom terminal text
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setFontSize((s) => Math.min(24, s + 1));
      } else if (e.key === '-') {
        e.preventDefault();
        setFontSize((s) => Math.max(8, s - 1));
      } else if (e.key === '0') {
        e.preventDefault();
        setFontSize(12);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length !== prevMessageCountRef.current) {
      prevMessageCountRef.current = messages.length;
      if (autoScroll && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [messages, autoScroll]);

  // Detect scroll position to toggle auto-scroll + show scrollbar
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);

    setIsScrolling(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => setIsScrolling(false), 1000);
  }, []);

  // Event delegation for .md-file-link clicks — opens rendered markdown in new window
  const handleTerminalClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('.md-file-link') as HTMLElement | null;
    if (link?.dataset.mdPath) {
      const params = new URLSearchParams({ path: link.dataset.mdPath });
      if (bannerData?.cwd) params.set('cwd', bannerData.cwd);
      window.open(`/api/view-md?${params}`, '_blank', 'width=900,height=700,scrollbars=yes');
    }
  }, [bannerData?.cwd]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (trimmed || images.length > 0) {
      onSendInput(trimmed, images.length > 0 ? images : undefined);
      setInput('');
      setImages([]);
      setSelectedChipIndex(null);
    }
  }, [input, images, onSendInput]);

  // Apply an autocomplete acceptance result to the textarea
  const applyAcceptance = useCallback(
    (result: { newValue: string; newCursorPosition: number }) => {
      setInput(result.newValue);
      const pos = result.newCursorPosition;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.setSelectionRange(pos, pos);
          // Also re-trigger auto-resize for the new value
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }
      });
    },
    [],
  );

  // Handle autocomplete item click: set selected index, then accept
  const handleAutocompleteItemClick = useCallback(
    (index: number) => {
      autocomplete.onItemClick(index);
      const result = autocomplete.accept();
      if (result) applyAcceptance(result);
      // Re-focus the textarea after clicking a dropdown item
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [autocomplete, applyAcceptance],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Delegate to autocomplete first — if it consumed the event, handle acceptance
      const consumed = autocomplete.onKeyDown(e);
      if (consumed) {
        // Tab or Enter with highlighted item — accept the selection
        if (e.key === 'Tab' || e.key === 'Enter') {
          const result = autocomplete.accept();
          if (result) applyAcceptance(result);
        }
        // Escape, ArrowUp, ArrowDown — already handled by the hook
        return;
      }

      // Ctrl+C — stop running session
      if (e.ctrlKey && e.key === 'c' && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (nodeState === 'running') {
          e.preventDefault();
          onStopSession();
          return;
        }
      }

      // Readline-style keybindings (Ctrl+key, no meta/alt/shift)
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const el = inputRef.current;
        if (!el) return;
        const pos = el.selectionStart ?? 0;

        switch (e.key) {
          // Ctrl+U — kill line before cursor
          case 'u': {
            e.preventDefault();
            const after = input.slice(pos);
            setInput(after);
            requestAnimationFrame(() => {
              el.setSelectionRange(0, 0);
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            });
            return;
          }
          // Ctrl+K — kill from cursor to end of line
          case 'k': {
            e.preventDefault();
            const before = input.slice(0, pos);
            setInput(before);
            requestAnimationFrame(() => {
              el.setSelectionRange(pos, pos);
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            });
            return;
          }
          // Ctrl+W — kill word before cursor
          case 'w': {
            e.preventDefault();
            const before = input.slice(0, pos);
            const after = input.slice(pos);
            const trimmed = before.replace(/\s+$/, '');
            const wordStart = Math.max(0, trimmed.lastIndexOf(' ') + 1);
            const newBefore = before.slice(0, wordStart);
            setInput(newBefore + after);
            requestAnimationFrame(() => {
              el.setSelectionRange(wordStart, wordStart);
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            });
            return;
          }
          // Ctrl+L — scroll to bottom (terminal "clear" equivalent)
          case 'l': {
            e.preventDefault();
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
            return;
          }
        }
      }


      // ── Image chip keyboard navigation ────────────────────────────
      // When chips are focused (selectedChipIndex is not null):
      if (selectedChipIndex !== null) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setSelectedChipIndex(Math.max(0, selectedChipIndex - 1));
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (selectedChipIndex < images.length - 1) {
            setSelectedChipIndex(selectedChipIndex + 1);
          } else {
            // Move focus back to textarea
            setSelectedChipIndex(null);
            inputRef.current?.focus();
          }
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          const newLength = images.length - 1;
          setImages((prev) => prev.filter((_, i) => i !== selectedChipIndex));
          if (newLength <= 0) {
            setSelectedChipIndex(null);
            inputRef.current?.focus();
          } else if (selectedChipIndex >= newLength) {
            setSelectedChipIndex(newLength - 1);
          }
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'Escape') {
          e.preventDefault();
          setSelectedChipIndex(null);
          inputRef.current?.focus();
          return;
        }
        // Any other key — return focus to textarea
        setSelectedChipIndex(null);
        return;
      }

      // ArrowUp from empty input or cursor at position 0 — navigate to chips
      if (e.key === 'ArrowUp' && images.length > 0) {
        const el = inputRef.current;
        const cursorPos = el?.selectionStart ?? 0;
        if (!input || cursorPos === 0) {
          e.preventDefault();
          setSelectedChipIndex(images.length - 1);
          return;
        }
      }

      // Up arrow — pop last queued message into input for editing
      if (e.key === 'ArrowUp' && !input && queuedMessages && queuedMessages.length > 0) {
        e.preventDefault();
        const lastQueued = queuedMessages[queuedMessages.length - 1]!;
        setInput(lastQueued.text);
        if (lastQueued.images) {
          setImages((prev) => [...prev, ...lastQueued.images!]);
        }
        onDequeue('pop_last');
        // Resize textarea for the new content
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) {
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
            el.setSelectionRange(lastQueued.text.length, lastQueued.text.length);
          }
        });
        return;
      }

      // Escape — move all queued messages back to input
      if (e.key === 'Escape' && queuedMessages && queuedMessages.length > 0) {
        e.preventDefault();
        const allQueued = queuedMessages.map((m) => m.text).join('\n');
        // Aggregate all images from queued messages
        const queuedImages: ImageAttachment[] = [];
        for (const m of queuedMessages) {
          if (m.images) queuedImages.push(...m.images);
        }
        setInput(allQueued);
        if (queuedImages.length > 0) {
          setImages((prev) => [...prev, ...queuedImages]);
        }
        onDequeue('clear_all');
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (el) {
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
            el.setSelectionRange(allQueued.length, allQueued.length);
          }
        });
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [autocomplete, applyAcceptance, handleSubmit, input, images, selectedChipIndex, nodeState, onStopSession, queuedMessages, onDequeue],
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
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

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
      className="absolute z-40 flex flex-col overflow-hidden rounded-lg shadow-2xl terminal-floating-window"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        backgroundColor: 'var(--term-bg)',
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
        onClick={handleTerminalClick}
        className={`nowheel flex-1 overflow-y-auto px-4 py-3${isScrolling ? ' is-scrolling' : ''}`}
      >
        <pre className="whitespace-pre-wrap break-words font-mono" style={{ color: 'var(--term-text)', fontSize: `${fontSize}px`, lineHeight: '1.6' }}>
          {/* Render banner first regardless of buffer position */}
          {bannerMsg && <TerminalMessageRenderer key="banner" message={bannerMsg} />}
          {messages.map((msg, i) => (
            msg.type === 'session_banner' ? null : <TerminalMessageRenderer key={i} message={msg} />
          ))}
          {messages.length === 0 && (
            <span style={{ color: 'var(--term-text-dim)' }}>
              Waiting for output...<span className="terminal-cursor" />
            </span>
          )}
        </pre>
        {/* Live subagent summary — above thinking indicator */}
        <SubagentSummary parentNodeId={nodeId} />
        <pre className="whitespace-pre-wrap break-words font-mono" style={{ color: 'var(--term-text)', fontSize: `${fontSize}px`, lineHeight: '1.6' }}>
          {showThinking && <ThinkingIndicator nodeId={nodeId} />}
          {queuedMessages && queuedMessages.length > 0 && (
            <div className="mt-1">
              {queuedMessages.map((msg, i) => (
                <div key={`q-${i}`} className="my-0.5 flex items-start gap-1.5">
                  <span style={{ color: 'var(--term-user)' }}>›</span>
                  <span style={{ color: 'var(--term-user)' }}>
                    {msg.images && msg.images.length > 0 && (
                      <>{msg.images.map((img) => `[${img.name}]`).join(' ')} </>
                    )}
                    {msg.text}
                  </span>
                </div>
              ))}
              <div className="mt-0.5" style={{ color: 'var(--term-text-dim)', fontSize: `${fontSize - 1}px` }}>
                Press up to edit queued messages
              </div>
            </div>
          )}
        </pre>
        {/* Structured question options — inside scroll area so user can scroll past */}
        {questionPayload && (
          <QuestionOptions
            payload={questionPayload}
            onAnswer={onAnswerQuestion}
          />
        )}
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
          className="mx-4 mb-1 rounded px-2 py-1 text-xs transition-colors"
          style={{
            backgroundColor: 'var(--term-input-bg)',
            color: 'var(--term-text-dim)',
          }}
        >
          Scroll to bottom
        </button>
      )}

      {/* Input area — terminal-style with chevron + image chips */}
      <div
        className="flex flex-col px-4 py-2"
        style={{
          borderTop: '1px solid var(--term-input-border)',
          ...(isDragOver ? { backgroundColor: 'rgba(59, 130, 246, 0.08)' } : {}),
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Image chips */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {images.map((img, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs"
                style={{
                  backgroundColor: selectedChipIndex === i
                    ? 'rgba(59, 130, 246, 0.3)'
                    : 'var(--term-input-bg, rgba(255,255,255,0.06))',
                  color: 'var(--term-text)',
                  border: selectedChipIndex === i
                    ? '1px solid rgba(59, 130, 246, 0.6)'
                    : '1px solid transparent',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setSelectedChipIndex(i);
                }}
              >
                [{img.name}]
                <button
                  className="ml-0.5 leading-none opacity-60 hover:opacity-100"
                  style={{ color: 'var(--term-text-dim)' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setImages((prev) => prev.filter((_, idx) => idx !== i));
                    if (selectedChipIndex === i) {
                      setSelectedChipIndex(null);
                    } else if (selectedChipIndex !== null && selectedChipIndex > i) {
                      setSelectedChipIndex(selectedChipIndex - 1);
                    }
                  }}
                  aria-label={`Remove ${img.name}`}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-start gap-2">
        <span
          className="font-mono text-sm leading-5 select-none pt-px"
          style={{ color: 'var(--term-text)' }}
        >
          ❯
        </span>
        <div className="terminal-ghost-wrapper flex-1">
          {/* Mirror div: invisible typed text + visible ghost text */}
          <div
            aria-hidden="true"
            className="terminal-ghost-mirror font-mono text-sm leading-5 whitespace-pre-wrap break-words"
          >
            <span style={{ visibility: 'hidden' }}>{input}</span>
            {autocomplete.ghostText && cursorAtEnd && (
              <span style={{ color: 'var(--term-text-dim)', opacity: 0.6 }}>{autocomplete.ghostText}</span>
            )}
          </div>
          {/* Textarea on top */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              const value = e.target.value;
              // Read cursor position BEFORE DOM mutations (auto-resize)
              const cursorPos = e.target.selectionStart ?? value.length;
              setInput(value);
              // Typing always moves cursor to end of insertion
              setCursorAtEnd(cursorPos === value.length);
              // Auto-resize
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
              // Notify autocomplete
              autocomplete.onInputChange(value, cursorPos);
            }}
            onSelect={(e) => {
              const el = e.target as HTMLTextAreaElement;
              setCursorAtEnd(el.selectionStart === el.value.length);
            }}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            rows={1}
            className="resize-none bg-transparent font-mono text-sm leading-5 outline-none w-full p-0"
            style={{ color: 'var(--term-input-text)' }}
            role="combobox"
            aria-expanded={autocomplete.isOpen}
            aria-activedescendant={autocomplete.activeDescendantId ?? undefined}
            aria-controls={autocomplete.listboxId}
          />
        </div>
        </div>
      </div>

      {/* Autocomplete dropdown (portal-rendered above the textarea) — hidden when ghost text is active */}
      {!autocomplete.ghostText && (
        <AutocompleteDropdown
          items={autocomplete.items}
          selectedIndex={autocomplete.selectedIndex}
          triggerType={autocomplete.triggerType}
          isOpen={autocomplete.isOpen}
          onItemClick={handleAutocompleteItemClick}
          onItemHover={autocomplete.onItemHover}
          activeDescendantId={autocomplete.activeDescendantId}
          listboxId={autocomplete.listboxId}
          textareaRef={inputRef}
        />
      )}

      {/* Status bar — below input, matches Claude CLI bottom bar */}
      {bannerData && (
        <div className="terminal-status-bar">
          <span className="terminal-status-model">
            {bannerData.modelDisplayName}
          </span>
          {' in '}
          <span className="terminal-status-cwd">
            {bannerData.cwd}
          </span>
          {contextPercent !== null && (
            <>
              <span className="terminal-status-divider"> | </span>
              <span className="terminal-status-context">
                Context remaining:{' '}
                {'['}
                <span className="terminal-context-bar-filled">
                  {'█'.repeat(Math.round(contextPercent / 10))}
                </span>
                <span className="terminal-context-bar-empty">
                  {'█'.repeat(10 - Math.round(contextPercent / 10))}
                </span>
                {']'}
                {' '}{contextPercent.toFixed(1)}%
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Safely parse the humanNeededPayload into a typed AskUserQuestion structure */
function parseQuestionPayload(raw: unknown): AskUserQuestionPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Payload shape: { questions: [{ question, header, options, multiSelect }] }
  if (!Array.isArray(obj.questions) || obj.questions.length === 0) return null;

  // Verify at least one question has options
  const hasOptions = obj.questions.some((q: unknown) => {
    if (!q || typeof q !== 'object') return false;
    const qObj = q as Record<string, unknown>;
    return Array.isArray(qObj.options) && qObj.options.length > 0;
  });
  if (!hasOptions) return null;

  return raw as AskUserQuestionPayload;
}
