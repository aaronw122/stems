import { useState, useCallback, useEffect, useRef } from 'react';
import { FlowCanvas } from './components/FlowCanvas.tsx';
import { PromptEditor } from './components/panels/PromptEditor.tsx';
import { TerminalPeek } from './components/panels/TerminalPeek.tsx';
import { DoneList } from './components/panels/DoneList.tsx';
import { useWebSocket } from './hooks/useWebSocket.ts';
import { useGraph } from './hooks/useGraph.ts';

export default function App() {
  const processMessage = useGraph((s) => s.processMessage);
  const nodes = useGraph((s) => s.nodes);
  const doneList = useGraph((s) => s.doneList);
  const { send, isConnected } = useWebSocket(processMessage);

  const [doneListOpen, setDoneListOpen] = useState(false);

  // Ref to the canvas container for floating terminal positioning
  const canvasContainerRef = useRef<HTMLDivElement>(null);

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
  }, [promptEditor.isOpen, selectedNodeId, doneListOpen, handleAddRepo]);

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
    (text: string) => {
      if (selectedNodeId) {
        send({
          type: 'send_input',
          nodeId: selectedNodeId,
          payload: { kind: 'text_input', text },
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

        {/* Connection indicator */}
        <div className="absolute top-4 right-4 flex items-center gap-2 rounded-md bg-zinc-800/80 px-3 py-1.5 text-xs backdrop-blur">
          <div
            className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          {isConnected ? 'Connected' : 'Disconnected'}
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
            onStopSession={handleStopSession}
            onDequeue={handleDequeue}
          />
        )}

        {/* Done List sidebar */}
        <DoneList
          doneList={doneList}
          isOpen={doneListOpen}
          onToggle={() => setDoneListOpen((prev) => !prev)}
        />
      </div>
    </div>
  );
}
