import { useState, useCallback, useEffect } from 'react';
import { FlowCanvas } from './components/FlowCanvas.tsx';
import { PromptEditor } from './components/panels/PromptEditor.tsx';
import { TerminalPeek } from './components/panels/TerminalPeek.tsx';
import { useWebSocket } from './hooks/useWebSocket.ts';
import { useGraph } from './hooks/useGraph.ts';

export default function App() {
  const { processMessage, nodes } = useGraph();
  const { send, isConnected } = useWebSocket(processMessage);

  const [showAddRepo, setShowAddRepo] = useState(false);
  const [repoPath, setRepoPath] = useState('');

  // ── PromptEditor state ──────────────────────────────────────────────
  const [promptEditor, setPromptEditor] = useState<{
    isOpen: boolean;
    parentNodeId: string;
    spawnType: 'feature' | 'subtask';
  }>({ isOpen: false, parentNodeId: '', spawnType: 'feature' });

  // ── TerminalPeek state ──────────────────────────────────────────────
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Sync with graph store's selectedNodeId
  const graphSelectedNodeId = useGraph((s) => s.selectedNodeId);
  useEffect(() => {
    setSelectedNodeId(graphSelectedNodeId);
  }, [graphSelectedNodeId]);

  // Subscribe/unsubscribe terminal when selectedNodeId changes
  useEffect(() => {
    if (selectedNodeId) {
      send({ type: 'subscribe_terminal', nodeId: selectedNodeId });
    }
    return () => {
      if (selectedNodeId) {
        send({ type: 'unsubscribe_terminal', nodeId: selectedNodeId });
      }
    };
  }, [selectedNodeId, send]);

  // ── Global Esc key ──────────────────────────────────────────────────
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (promptEditor.isOpen) {
          setPromptEditor((prev) => ({ ...prev, isOpen: false }));
        } else if (selectedNodeId) {
          setSelectedNodeId(null);
          useGraph.getState().setSelectedNode(null);
        } else if (showAddRepo) {
          setShowAddRepo(false);
          setRepoPath('');
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [promptEditor.isOpen, selectedNodeId, showAddRepo]);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleAddRepo = useCallback(() => {
    if (repoPath.trim()) {
      send({ type: 'add_repo', path: repoPath.trim() });
      setRepoPath('');
      setShowAddRepo(false);
    }
  }, [repoPath, send]);

  const handleRepoKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleAddRepo();
      } else if (e.key === 'Escape') {
        setShowAddRepo(false);
        setRepoPath('');
      }
    },
    [handleAddRepo],
  );

  const handleSpawn = useCallback(
    (nodeId: string, spawnType: 'feature' | 'subtask') => {
      setPromptEditor({ isOpen: true, parentNodeId: nodeId, spawnType });
    },
    [],
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
    setSelectedNodeId(null);
    useGraph.getState().setSelectedNode(null);
  }, []);

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

  // Get the title for the selected node
  const selectedNodeTitle =
    selectedNodeId
      ? (nodes.find((n) => n.id === selectedNodeId)?.data as Record<string, unknown> | undefined)?.title as string ?? 'Terminal'
      : 'Terminal';

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0f0f0f]">
      {/* Canvas takes full space */}
      <div className="relative flex-1">
        <FlowCanvas send={send} onSpawn={handleSpawn} />

        {/* Connection indicator */}
        <div className="absolute top-4 right-4 flex items-center gap-2 rounded-md bg-zinc-800/80 px-3 py-1.5 text-xs backdrop-blur">
          <div
            className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>

        {/* Add Repo button */}
        <button
          onClick={() => setShowAddRepo(true)}
          className="absolute top-4 left-4 rounded-md bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600 transition-colors"
        >
          + Add Repo
        </button>

        {/* Add Repo modal */}
        {showAddRepo && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-[400px] rounded-lg bg-zinc-800 p-6 shadow-2xl">
              <h2 className="mb-4 text-lg font-semibold text-zinc-100">Add Repository</h2>
              <input
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                onKeyDown={handleRepoKeyDown}
                placeholder="/path/to/your/repo"
                className="mb-4 w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowAddRepo(false);
                    setRepoPath('');
                  }}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddRepo}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Prompt Editor modal */}
        <PromptEditor
          isOpen={promptEditor.isOpen}
          onClose={() => setPromptEditor((prev) => ({ ...prev, isOpen: false }))}
          onSubmit={handlePromptSubmit}
          parentNodeId={promptEditor.parentNodeId}
          spawnType={promptEditor.spawnType}
        />

        {/* Terminal Peek panel */}
        {selectedNodeId && (
          <TerminalPeek
            nodeId={selectedNodeId}
            nodeTitle={selectedNodeTitle}
            onClose={handleTerminalClose}
            onSendInput={handleTerminalInput}
          />
        )}
      </div>
    </div>
  );
}
