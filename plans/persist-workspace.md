# Plan: Persist Workspace Across Restarts

## Context

All Stems state (repos, features, subtasks, edges, done list) lives in ephemeral in-memory Maps in `server/state.ts`. Server restart = everything gone. We need to save this to a JSON file on disk so the tree survives restarts.

## Approach

Hook persistence into `state.ts` — it's already the single source of truth. Every mutation triggers a debounced save. On startup, hydrate from disk.

**File location:** `~/.stems/workspace.json` (user-level, since Stems manages multiple repos — no single project root makes sense)

## What Gets Persisted vs. Reset

| Persist (as-is) | Reset on load |
|---|---|
| id, type, parentId, title | nodeState: `running`/`needs-human` → `idle` |
| repoPath, branch, prompt | displayStage → `'planning'` |
| prUrl, prState | sessionId → `null` |
| costUsd, tokenUsage | needsHuman → `false`, humanNeeded* → `null` |
| edges (full) | overlap → cleared |
| doneList (same treatment) | x, y → `0, 0` (auto-layout on reload) |

## Changes

### 1. New: `server/persistence.ts`

Core persistence module:

- **`toPersistedNode(node)`** — strips volatile fields, keeps structural + metric data
- **`toWeftNode(persisted)`** — reconstitutes full WeftNode with safe defaults for volatile fields
- **`scheduleSave(getState)`** — debounced (2s) write. Stores a `getState` callback so the snapshot is always fresh at write time
- **`flushSave()`** — immediate write, called on shutdown
- **`saveNow()`** — atomic write via temp file + rename (prevents corruption from mid-write crash)
- **`loadWorkspace()`** — reads JSON, validates version + structure, returns `null` on any error (start fresh)

File schema:
```ts
{ version: 1, savedAt: string, nodes: PersistedNode[], edges: WeftEdge[], doneList: PersistedNode[] }
```

### 2. Modify: `server/state.ts`

- Import `scheduleSave` from persistence
- Add `getStateSnapshot()` helper returning `{ nodes, edges, doneList }`
- Add `hydrateState(data)` to populate Maps from loaded data
- Add `scheduleSave(getStateSnapshot)` call at the end of every mutation: `addNode`, `updateNode`, `removeNode`, `addEdge`, `addToDoneList`, `removeFromDoneList`, `clearHumanNeeded`
- Re-export `flushSave` for shutdown use

### 3. Modify: `server/index.ts`

- Import `loadWorkspace` from persistence, `hydrateState`/`flushSave` from state
- Before `Bun.serve()`: call `loadWorkspace()` → if data, call `hydrateState(data)`
- In both SIGTERM/SIGINT handlers: call `flushSave()` before `killAllSessions()`

## What Does NOT Change

- `shared/types.ts` — PersistedNode is internal to server
- All client code — client already handles `full_state` messages
- `session.ts`, `completion.ts`, `pr-tracker.ts`, `message-processor.ts`
- Terminal buffers — ephemeral by design

## Verification

1. Start server, add a repo, spawn a feature
2. Stop server (Ctrl-C)
3. Check `~/.stems/workspace.json` exists with correct data
4. Restart server, connect client — repo and feature should appear
5. Delete `~/.stems/workspace.json`, restart — should start fresh without errors
6. Corrupt the file (write garbage), restart — should start fresh without errors
