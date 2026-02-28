import { useState, useCallback } from 'react';
import { FlowCanvas } from './components/FlowCanvas.tsx';
import { useWebSocket } from './hooks/useWebSocket.ts';
import { useGraph } from './hooks/useGraph.ts';

export default function App() {
  const { processMessage } = useGraph();
  const { send, isConnected } = useWebSocket(processMessage);

  const [showAddRepo, setShowAddRepo] = useState(false);
  const [repoPath, setRepoPath] = useState('');

  const handleAddRepo = useCallback(() => {
    if (repoPath.trim()) {
      send({ type: 'add_repo', path: repoPath.trim() });
      setRepoPath('');
      setShowAddRepo(false);
    }
  }, [repoPath, send]);

  const handleKeyDown = useCallback(
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

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0f0f0f]">
      {/* Canvas takes full space */}
      <div className="relative flex-1">
        <FlowCanvas send={send} />

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
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-[400px] rounded-lg bg-zinc-800 p-6 shadow-2xl">
              <h2 className="mb-4 text-lg font-semibold text-zinc-100">Add Repository</h2>
              <input
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                onKeyDown={handleKeyDown}
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
      </div>
    </div>
  );
}
