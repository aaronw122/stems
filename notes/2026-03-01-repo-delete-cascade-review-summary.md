# Plan Review Summary

**Plan:** plans/repo-delete-cascade.md
**Rounds:** 2
**Final revision:** 2

## Issues Found & Fixed

### Round 1 — Must-Fix Issues (All Fixed in Revision 2)

**Terminal subscription leak** (flagged by all 3 agents)
The cascade cleanup loop omitted `clearTerminalSubscriptions` for deleted nodes, leaving dangling entries in the `terminalSubscriptions` map. Fixed by adding a new `clearTerminalSubscriptions(nodeId)` helper to `server/state.ts` and calling it in the per-node cleanup loop alongside `clearTerminalBuffer`.

**Visual "popping" from per-node `node_removed` broadcasts** (Agent 1 framed as N-render cost; Agents 2 and 3 flagged as visible UX problem)
The original plan broadcast a separate `node_removed` message per node, causing nodes to disappear one at a time over multiple render cycles with dangling edges visible between frames. Fixed by introducing a dedicated `tree_removed` server message (`{ type: 'tree_removed'; nodeIds: string[] }`) that the client handles in a single `set()` call, removing all nodes and edges atomically in one re-render.

**Missing blast radius info in confirmation dialog** (Agent 3)
The confirmation dialog showed only the repo name with no indication of how many descendants would be destroyed. Fixed by adding a client-side BFS in `FlowCanvas.tsx` that counts descendants by type and passes a details string to `ConfirmDialog` via a new `details` prop: "This will permanently delete [name] and N child nodes (X features, Y subtasks). Active sessions will be terminated."

**`getDescendants()` edge mutation hazard** (Agents 1 and 2)
The BFS iterated directly over the live `edges` array, which `removeNode` mutates by splicing. Fixed by snapshotting the array at the top of `getDescendants`: `const snapshot = [...edges]`.

**`selectedNodeId` not cleared on cascade removal** (Agents 2 and 3)
The `node_removed` handler did not clear `selectedNodeId`, leaving the terminal panel open for a deleted node. Fixed by including selection clearing in the new `tree_removed` handler via a conditional spread in the same `set()` call.

**Done list not pruned for already-completed descendants** (Agent 2)
Nodes that had been auto-moved to the done list via `autoMoveIfComplete` would remain as ghost entries after cascade deletion because `removeNode` had already severed their edges, making them invisible to the BFS. Fixed by adding `removeFromDoneList(nodeId)` to `server/state.ts` (using `findIndex` + `splice`) and calling it in the cascade loop, with a conditional `done_list_updated` broadcast if any were removed.

---

## Remaining Issues

**Medium — BFS cycle guard still missing (all 3 agents, both rounds)**
`getDescendants` has no `visited` Set. If a cycle exists in edge data (bug elsewhere, corrupted state), the BFS infinite-loops and hangs the single-threaded Bun event loop. Also causes duplicate IDs in diamond-shaped DAGs, resulting in `killSession` being called twice per node. Three-line fix: add `const visited = new Set<string>([nodeId])` and gate pushes with `!visited.has(edge.target)`.

**Medium — No existence/type guard on `delete_tree` handler (Agents 1 and 2, both rounds)**
The handler calls `getDescendants(nodeId)` without verifying the node exists. A nonexistent or stale ID results in a phantom `tree_removed` broadcast. The handler is also not restricted to repo nodes despite the UI placing the button only on `RepoNode` — a crafted message can cascade-delete any subtree without the UI confirmation dialog. Minimum fix: add an early-return existence check. Optional: add a type guard if this is intended to be repo-only.

**Medium — `node_removed` handler still does not clear `selectedNodeId`** (Agent 2, Round 2)
The new `tree_removed` handler correctly clears selection, but the existing `node_removed` handler (used by `close_node` / `autoMoveIfComplete`) does not. If a node the user is viewing is auto-completed and moved to the done list, the terminal panel will reference a deleted node. Pre-existing bug, but this plan touches the handler and adding the fix is one line.

**Medium — `removeFromDoneList` does not catch nodes already severed from the edge graph** (Agent 1, Round 2)
After the BFS, `removeFromDoneList` is called only for nodes the BFS found. But nodes already auto-moved to done have had their edges removed by an earlier `removeNode` call, so the BFS never discovers them. They remain as ghost entries in the done list. Fix requires a second pass: after building `allIds`, scan `getDoneList()` for entries whose `parentId` is in `allIds` and add them to the set for cleanup.

**Medium — Partial cascade failure leaves client/server state inconsistent** (Agent 3, both rounds)
If any `killSession` call throws mid-loop, the error bubbles to the top-level `.catch()`, which sends a generic error — but by that point, some nodes may be removed from server state while `tree_removed` hasn't been broadcast yet. On refresh, the client sees a half-deleted tree with no explanation. Fix: wrap each per-node cleanup in try/catch with continue-on-error, collect successfully-cleaned IDs, and always broadcast `tree_removed` with the IDs that succeeded.

**Medium — Delete button placement unspecified** (Agent 3, both rounds)
The plan says "small delete button" without specifying placement relative to the existing "+ Feature" button. Placing them adjacent creates misclick risk for a high-consequence destructive action. Recommended: place the delete button in the top-right corner (opposite from "+ Feature" at bottom-right), hidden by default with `opacity-0 group-hover:opacity-100`, with `e.stopPropagation()` to prevent drag-end triggers.

**Low — `close_node` handler does not call `clearTerminalSubscriptions`** (Agents 1, 2, and 3, Round 2)
`delete_tree` now cleans terminal subscriptions, but `close_node` still does not. The helper is being created anyway — adding the call to `close_node` is one line and fixes a pre-existing bug while the work is adjacent.

**Low — Client-side BFS for blast radius can diverge from server** (Agents 1 and 2, Round 2)
The confirmation dialog's descendant count is computed from Zustand store edges, while the server BFS runs on its own `edges` array. If the stores have drifted (e.g., due to a concurrent `autoMoveIfComplete`), the user sees a count that doesn't match what the server actually deletes. Acceptable for v1 — needs a plan comment documenting that the client-side count is informational/best-effort and the server is authoritative.

**Low — ConfirmDialog keyboard accessibility** (Agent 3, both rounds)
No specification for Escape-to-cancel, focus trapping, or initial focus. More urgent than it first appeared: the existing global Escape handler in `App.tsx` is not aware of the dialog and may close the terminal selection or toggle the done list instead of dismissing the dialog. The dialog should intercept Escape with `e.stopPropagation()` and call `onCancel`. Auto-focus should land on Cancel (not Confirm) as the safe default for destructive actions.

**Low — Undo/grace period absent** (Agent 3, both rounds)
Deletion is instant and irreversible after confirmation. No toast with undo action. Flagged as a known UX debt item and deferred, but the plan should explicitly acknowledge the omission and note "Future: consider 5-second undo toast pattern (optimistic UI removal with delayed server-side deletion)" so implementers know it was intentional.

---

## Implementation Notes

**Children-first ordering in the deletion loop** (Agent 1, Round 1)
The plan deletes `[...descendantIds, nodeId]`. BFS returns nodes in top-down order (direct children before grandchildren), so the array is not strictly leaf-first. For correctness this does not matter (all nodes get cleaned up regardless of order), but if leaf-first processing is ever required, the array should be reversed.

**Broadcast storm for large subtrees** (Agent 1, Round 1)
N `node_removed` broadcasts per N nodes was a concern before the `tree_removed` fix. Now moot — the batch message replaces it. The batch broadcast is one WebSocket send per connected client regardless of subtree size.

**`removeNode` O(N*E) edge cleanup during cascade** (Agent 1, Round 1)
Each `removeNode(id)` call iterates the full `edges` array to splice out related edges. A cascade of N deletions is O(N*E). Acceptable at current scale; if DAGs grow large, a single-pass filter over all node IDs would be more efficient.

**`killSession` is async but not awaited in the plan's loop description** (Agents 1 and 2, Round 1 and 2)
Current `killSession` implementation is async in signature only — the abort is synchronous. If `killSession` later becomes truly async (e.g., waiting for process exit), the cascade loop will need `await killSession(id)` or a `Promise.all` phase. No action needed now.

**Error handling — fail-open per node** (Agents 2 and 3, Round 1)
`killSession` currently swallows errors, so partial failure is unlikely in practice. However, if it becomes truly async with graceful shutdown, errors could surface. The try/catch-per-node pattern (see Remaining Issues: partial cascade failure) should be the implementation target regardless.

**`onDelete` prop threading through `nodeTypes`** (Agent 2, Round 2)
`FlowCanvas` passes callbacks to node components via `nodesWithCallbacks` (spreading into `node.data`). `onDelete` should follow this same pattern. The `send` function also needs to be in scope for the on-confirm handler, which it is given the existing `send` prop in FlowCanvas.

**`removeFromDoneList` linear search** (Agent 2, Round 2)
Uses `findIndex` + `splice` — O(N*D) for a cascade of N nodes with done list size D. Fine at realistic scale (tens of nodes). A Map-based lookup would be better if the done list grows large.

**`delete_tree` node type restriction** (Agents 1, 2, and 3)
The plan scopes this as repo-delete but the server handler accepts any `nodeId`. This could be intentional (generic subtree delete) or a gap. The ambiguity should be resolved before implementation: either add a `node.type === 'repo'` guard or rename the feature to "subtree delete" and consider adding the button to feature nodes too.

**Spawn race condition** (Agents 1 and 3, both rounds)
If a child's `spawnSession` is between `addNode` (in `server/index.ts`) and `sessions.set` (in `session.ts`) when the repo is deleted, `killSession` will no-op (no session registered yet). The SDK query will start after the node is gone. `consumeTurn` handles this gracefully — it checks `getNode(nodeId)` per iteration and returns early if the node is missing. The orphaned Claude CLI process runs to natural completion. Add an early-exit check in `consumeTurn`'s `for await` loop as a defensive measure.

**`done_list_updated` broadcast payload** (Agent 3, Round 2)
The plan says "broadcast `done_list_updated`" without specifying payload shape. Match the existing `close_node` pattern: send `{ type: 'done_list_updated', doneList: getDoneList() }` — the full current done list, not just the removed IDs, since the client replaces its entire `doneList` state on this message.

**ConfirmDialog overlay pointer events** (Agent 3, Round 1)
The overlay (`bg-black/60 backdrop-blur-sm`) must capture all pointer events to prevent canvas interactions (dragging nodes, clicking "+ Feature") while the dialog is open. Verify the overlay has `pointer-events-auto` or that the modal container blocks events correctly.

---

## Reviewer Personas Used

**Agent 1 — Architect (Distributed Systems, State Management, Process Lifecycle)**
Focused on server-side correctness, concurrency hazards, cleanup ordering, process orphan risks, and the WebSocket message contract between server and client. Primary contributions: mutation hazard in `getDescendants`, terminal subscription leak, N-render problem, done-list ghost entry edge case with the BFS-severs-edges ordering.

**Agent 2 — Process & State Management Specialist**
Focused on Zustand store correctness, server-client state consistency, and the full cleanup step inventory across handlers. Primary contributions: done-list pruning for already-completed descendants, `node_removed` handler selection clearing for single-node removals, client/server BFS divergence as a documented design decision, `close_node` / `delete_tree` cleanup divergence.

**Agent 3 — Product / UX**
Focused on user-facing behavior, destructive action patterns, interaction design, visual consistency, and error recovery. Primary contributions: blast radius info in confirmation dialog, partial cascade failure UX impact, delete button placement risk, undo/grace period as acknowledged UX debt, keyboard accessibility and Escape key conflict with App.tsx global handler.
