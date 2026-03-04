import { useState, useCallback, useEffect, useRef } from 'react';
import { FlowCanvas } from './components/FlowCanvas.tsx';
import { PromptEditor } from './components/panels/PromptEditor.tsx';
import { TerminalPeek } from './components/panels/TerminalPeek.tsx';
import { DoneList } from './components/panels/DoneList.tsx';
import { Settings } from 'lucide-react';

import { useWebSocket } from './hooks/useWebSocket.ts';
import { useGraph } from './hooks/useGraph.ts';
import type { ImageAttachment } from '../shared/types.ts';
import { useTheme } from './themes/ThemeProvider.tsx';

export default function App() {
  const processMessage = useGraph((s) => s.processMessage);
  const nodes = useGraph((s) => s.nodes);
  const doneList = useGraph((s) => s.doneList);
  const { send, isConnected } = useWebSocket(processMessage);
  const { openThemePicker } = useTheme();

  const [doneListOpen, setDoneListOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Ref to the canvas container for floating terminal positioning
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  // Track the element that had focus before terminal opened, for focus restoration
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ── PromptEditor state ──────────────────────────────────────────────
  const [promptEditor, setPromptEditor] = useState<{
    isOpen: boolean;
    parentNodeId: string;
    spawnType: 'feature' | 'subtask';
  }>({ isOpen: false, parentNodeId: '', spawnType: 'feature' });

  // ── Selected node (single source of truth: Zustand store) ──────────
  const selectedNodeId = useGraph((s) => s.selectedNodeId);

  // Determine the selected node's type so we can skip terminal for repo nodes
  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null;
  const selectedNodeType = selectedNode?.type;

  // Subscribe/unsubscribe terminal when selectedNodeId changes
  useEffect(() => {
    // Don't subscribe to terminal for repo nodes (they don't have sessions)
    if (selectedNodeId && selectedNodeType !== 'repo') {
      send({ type: 'subscribe_terminal', nodeId: selectedNodeId });
    }
    return () => {
      if (selectedNodeId && selectedNodeType !== 'repo') {
        send({ type: 'unsubscribe_terminal', nodeId: selectedNodeId });
      }
    };
  }, [selectedNodeId, selectedNodeType, send]);

  // Focus management: capture focus before terminal opens, restore on close
  useEffect(() => {
    if (selectedNodeId && selectedNodeType !== 'repo') {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [selectedNodeId, selectedNodeType]);

  // ── Handlers ────────────────────────────────────────────────────────

  const pickingFolderRef = useRef(false);

  const handleAddRepo = useCallback(async () => {
    if (pickingFolderRef.current) return; // prevent double-fire from double-click or key repeat
    pickingFolderRef.current = true;
    try {
      const res = await fetch('/api/pick-folder');
      const data = await res.json();
      if (data.path) {
        send({ type: 'add_repo', path: data.path });
      }
    } catch (err) {
      console.error('[add-repo] Failed:', err);
    } finally {
      pickingFolderRef.current = false;
    }
  }, [send]);

  // ── Global keyboard shortcuts ───────────────────────────────────────
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // Don't intercept shortcuts when typing in an input or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        // The useFloatingWindow hook handles Escape during active gestures
        // via a capture-phase listener, so it won't reach here during drag/resize.
        if (promptEditor.isOpen) {
          setPromptEditor((prev) => ({ ...prev, isOpen: false }));
        } else if (settingsOpen) {
          setSettingsOpen(false);
        } else if (selectedNodeId) {
          useGraph.getState().setSelectedNode(null);
        } else if (doneListOpen) {
          setDoneListOpen(false);
        }
      }

      // Cmd+N: Add Repo via folder picker
      if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !isInputFocused) {
        e.preventDefault();
        handleAddRepo();
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [promptEditor.isOpen, settingsOpen, selectedNodeId, doneListOpen, handleAddRepo]);

  useEffect(() => {
    if (!settingsOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (!settingsMenuRef.current) return;
      if (!settingsMenuRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [settingsOpen]);

  const handleSpawn = useCallback(
    (nodeId: string, spawnType: 'feature' | 'subtask') => {
      if (spawnType === 'feature') {
        // Features open an interactive Claude session immediately — no prompt editor
        send({
          type: 'spawn_feature',
          parentId: nodeId,
          title: 'New feature',
          prompt: '',
        });
      } else {
        setPromptEditor({ isOpen: true, parentNodeId: nodeId, spawnType });
      }
    },
    [send],
  );

  const handlePromptSubmit = useCallback(
    (prompt: string) => {
      const { parentNodeId, spawnType } = promptEditor;
      const msgType = spawnType === 'feature' ? 'spawn_feature' : 'spawn_subtask';

      // Derive a short title from the prompt (first 40 chars)
      const title = prompt.length > 40 ? prompt.slice(0, 40) + '...' : prompt;

      send({
        type: msgType,
        parentId: parentNodeId,
        title,
        prompt,
      });

      setPromptEditor((prev) => ({ ...prev, isOpen: false }));
    },
    [promptEditor, send],
  );

  const handleTerminalClose = useCallback(() => {
    useGraph.getState().setSelectedNode(null);
  }, []);

  const handleStopSession = useCallback(() => {
    if (selectedNodeId) {
      send({ type: 'stop_session', nodeId: selectedNodeId });
    }
  }, [selectedNodeId, send]);

  const handleTerminalInput = useCallback(
    (text: string, images?: ImageAttachment[]) => {
      if (selectedNodeId) {
        send({
          type: 'send_input',
          nodeId: selectedNodeId,
          payload: { kind: 'text_input', text, images },
        });
      }
    },
    [selectedNodeId, send],
  );

  const handleQuestionAnswer = useCallback(
    (answer: string) => {
      if (selectedNodeId) {
        send({
          type: 'send_input',
          nodeId: selectedNodeId,
          payload: { kind: 'question_answer', answer },
        });
      }
    },
    [selectedNodeId, send],
  );

  const handleDequeue = useCallback(
    (action: 'pop_last' | 'clear_all') => {
      if (selectedNodeId) {
        send({ type: 'dequeue', nodeId: selectedNodeId, action });
      }
    },
    [selectedNodeId, send],
  );

  const handleOpenThemePicker = useCallback(() => {
    setSettingsOpen(false);
    openThemePicker();
  }, [openThemePicker]);

  // Get the title for the selected node (only needed when terminal is shown)
  const selectedNodeTitle =
    selectedNodeId && selectedNodeType !== 'repo'
      ? (selectedNode?.data as Record<string, unknown> | undefined)?.title as string ?? 'Terminal'
      : 'Terminal';

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0f0f0f]">
      {/* Canvas takes full space */}
      <div ref={canvasContainerRef} className="relative flex-1">
        <FlowCanvas send={send} onSpawn={handleSpawn} />

        {/* Top-right status and quick actions */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <div className="flex h-8 items-center gap-2 rounded-md bg-zinc-800/80 px-3 text-xs backdrop-blur">
            <div
              className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>

          <button
            onClick={() => setDoneListOpen((prev) => !prev)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-zinc-800/80 px-3 text-xs text-zinc-300 backdrop-blur transition-colors hover:bg-zinc-700/80"
            title={doneListOpen ? 'Hide done list' : 'Show done list'}
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

          <div ref={settingsMenuRef} className="relative">
            <button
              onClick={() => setSettingsOpen((prev) => !prev)}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-800/80 text-zinc-200 backdrop-blur transition-colors hover:bg-zinc-700/80"
              aria-label="Open settings menu"
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
            >
              <Settings className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </button>

            {settingsOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-40 rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
              >
                <button
                  onClick={handleOpenThemePicker}
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800"
                  role="menuitem"
                >
                  Change theme
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Toolbar buttons */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <button
            onClick={handleAddRepo}
            className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600 transition-colors"
          >
            + Add Repo
          </button>
          <button
            onClick={() => useGraph.getState().relayout()}
            className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600 transition-colors"
            title="Re-layout graph (dagre)"
          >
            Re-layout
          </button>
        </div>

        {/* Prompt Editor modal */}
        <PromptEditor
          isOpen={promptEditor.isOpen}
          onClose={() => setPromptEditor((prev) => ({ ...prev, isOpen: false }))}
          onSubmit={handlePromptSubmit}
          parentNodeId={promptEditor.parentNodeId}
          spawnType={promptEditor.spawnType}
        />

        {/* Floating Terminal window — sibling of ReactFlow, not child */}
        {selectedNodeId && selectedNodeType !== 'repo' && (
          <TerminalPeek
            nodeId={selectedNodeId}
            nodeTitle={selectedNodeTitle}
            containerRef={canvasContainerRef}
            onClose={handleTerminalClose}
            onSendInput={handleTerminalInput}
            onAnswerQuestion={handleQuestionAnswer}
            onStopSession={handleStopSession}
            onDequeue={handleDequeue}
          />
        )}

        {/* Done List sidebar */}
        <DoneList
          doneList={doneList}
          isOpen={doneListOpen}
          onToggle={() => setDoneListOpen((prev) => !prev)}
          hideToggleButton
        />

      </div>
    </div>
  );
}
