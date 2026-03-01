# Architect Review: Repo Delete with Cascading Subtree Removal

**Reviewer:** Architect (distributed systems, state management, process lifecycle)
**Plan:** `plans/repo-delete-cascade.md`
**Date:** 2026-03-01

---

## Summary

The plan is well-scoped and structurally sound. The decision to use a distinct `delete_tree` message rather than overloading `close_node` is correct. The BFS traversal, children-first teardown order, and reusable `ConfirmDialog` are all good design choices. Issues below are mostly about missing cleanup steps and a subtle mutation hazard in the traversal.

---

## Issues

### 1. [Must-fix] `getDescendants()` traverses edges that are mutated by `removeNode()`

**Section:** 3 (server/index.ts handler) + 1 (getDescendants helper)

The plan calls `getDescendants(nodeId)` first to collect all IDs, then iterates over them calling `removeNode(id)` for each. This is correct **only if `getDescendants` returns a snapshot** and does not re-read the `edges` array during the loop. The plan's implementation in Section 1 reads directly from the module-level `edges` array:

```typescript
for (const edge of edges) {
```

Since `removeNode()` in `state.ts` splices entries out of the same `edges` array (lines 93-101 of `server/state.ts`), there is a potential issue: if `getDescendants` were ever called lazily or if someone refactored to interleave traversal and removal, iteration would silently skip edges.

Currently the plan collects all IDs up front before any removal, so it works. But this is fragile. The fix is defensive and cheap:

**Suggested fix:** In `getDescendants`, snapshot the edges array at the top: `const snapshot = [...edges]` and iterate over `snapshot`. This makes the function safe regardless of call order and costs nothing meaningful.

---

### 2. [Must-fix] Missing cleanup: terminal subscriptions not cleared for deleted nodes

**Section:** 3 (server/index.ts handler)

The cleanup list in the plan is:
- `killSession(id)`
- `clearOverlapNode(id)`
- `stopPRTracking(id)`
- `clearTerminalBuffer(id)`
- `removeNode(id)`

Missing: **`terminalSubscriptions` are never cleaned up for deleted nodes.** The `terminalSubscriptions` map in `state.ts` (line 13) tracks which WebSocket clients are subscribed to a node's terminal stream. When a node is deleted, its entry in `terminalSubscriptions` remains, leaking memory and potentially causing `broadcastTerminal` to try sending data to a deleted node's subscribers.

The existing `close_node` handler has the same gap, so this is a pre-existing issue. But since `delete_tree` is the first bulk-deletion operation, it amplifies the leak (one invocation can orphan N subscription entries).

**Suggested fix:** Add a `clearTerminalSubscriptions(nodeId: string)` export in `state.ts` that deletes the entry from the `terminalSubscriptions` map. Call it in the per-node cleanup loop alongside `clearTerminalBuffer`. (Optionally, also fix `close_node` to match.)

---

### 3. [Must-fix] Frontend `node_removed` handler does not clear `selectedNodeId` -- plan acknowledges this but assigns it to the wrong file

**Section:** 7 (useGraph.ts)

The plan correctly identifies that the selected node must be deselected when removed, and assigns this to `useGraph.ts`. But looking at the actual code, `selectedNodeId` is managed **inside** the same Zustand store (`useGraph`), and the `node_removed` case handler is at line 149. The fix belongs there. Good.

However, the plan does not account for the fact that the `delete_tree` handler broadcasts `node_removed` **once per node** in the subtree. If 5 nodes are deleted, 5 `node_removed` messages arrive. The `node_removed` handler in `useGraph.ts` calls `set()` for each, triggering 5 React re-renders of `nodes` and `edges` arrays. Each re-render re-filters the full node/edge arrays.

**Suggested fix:** Consider introducing a batch `tree_removed` server message (e.g., `{ type: 'tree_removed', nodeIds: string[] }`) that the frontend handles in a single `set()` call. This avoids N renders for an N-node subtree. If you keep the per-node approach, this is functional but the N-render cost is worth documenting as a known tradeoff.

---

### 4. [Medium] `getDescendants` does not guard against cycles in the edge graph

**Section:** 1 (getDescendants helper)

The BFS in the plan does not track visited nodes:

```typescript
const queue = [nodeId];
while (queue.length > 0) {
  const current = queue.shift()!;
  for (const edge of edges) {
    if (edge.source === current) {
      descendants.push(edge.target);
      queue.push(edge.target);
    }
  }
}
```

If a cycle exists in the edge data (which should not happen in a DAG but could via a bug), this loops infinitely, hanging the server's single-threaded event loop.

**Suggested fix:** Add a `visited` Set. Skip nodes already in the set. Cheap insurance.

---

### 5. [Medium] No node type guard: `delete_tree` can be called on any node, not just repos

**Section:** 3 (server/index.ts handler)

The plan says the delete button is on `RepoNode` (Section 5), but the server handler does not validate that the target `nodeId` is actually a repo node. Any client message `{ type: 'delete_tree', nodeId: '<feature-id>' }` would cascade-delete that feature and its subtasks without confirmation from the UI.

This may be intentional (a generic subtree delete), but the plan's framing is exclusively about repo deletion. If the intent is repo-only, the handler should guard with a type check. If the intent is generic, the plan should say so and consider adding the delete button to feature nodes too.

**Suggested fix:** Either add `if (node.type !== 'repo') return;` in the handler, or rename the feature to "subtree delete" and document that it works for any node type.

---

### 6. [Medium] Race condition: user deletes a repo while a session is mid-spawn

**Section:** 3 (server/index.ts handler)

`spawnSession` in `session.ts` is async -- it calls `query()` from the SDK and sets up the session map entry before the async stream starts. If the user clicks "Delete" on a repo while a child's `spawnSession` is still in progress (between `addNode` on line 145 of `server/index.ts` and the session being fully registered), `killSession` will find no session to kill (it returns early on line 216 of `session.ts`). The `consumeTurn` async loop will then try to `updateNode` on a node that no longer exists.

This will not crash (the `updateNode` returns null for missing nodes, and broadcasts are no-ops), but the Claude CLI process may continue running as an orphan since `abortController.abort()` was never called.

**Suggested fix:** Document this as a known edge case. One mitigation: in `consumeTurn`, check `getNode(nodeId)` at the top of each loop iteration and bail out (abort self) if the node is gone. Alternatively, the delete handler could set a "deleting" flag that `spawnSession` checks before registering.

---

### 7. [Low] Plan does not specify what happens to the `ConfirmDialog` if the WebSocket disconnects mid-confirmation

**Section:** 6 (FlowCanvas.tsx)

If the user opens the confirmation dialog and then the WebSocket disconnects (server restart, network blip), clicking "Confirm" will call `send()` on a dead socket. The message will be silently dropped (the `send` in `useWebSocket` likely has a guard, but the dialog will close and the user will think the delete happened).

**Suggested fix:** Either disable the confirm button when `!isConnected`, or dismiss the dialog on disconnect. Low severity since this is a general UX issue, not specific to this feature.

---

### 8. [Low] `close_node` handler's cleanup list differs from `delete_tree` -- consider extracting a shared helper

**Section:** 3 (server/index.ts handler)

The `close_node` handler (line 219-230 of `server/index.ts`) does the same cleanup steps as `delete_tree` minus the cascading. If a new cleanup step is added to one but not the other, they'll diverge.

**Suggested fix:** Extract a `cleanupAndRemoveNode(id: string, addToDone: boolean)` helper that both handlers call. The `delete_tree` handler passes `addToDone: false`, `close_node` passes `addToDone: true`.

---

### 9. [Impl-note] Children-first ordering in the deletion loop

**Section:** 3

The plan says `[...descendantIds, nodeId]` (children first, root last). This is the correct order for cleanup (kill child sessions before parent). During implementation, verify that `getDescendants` returns a BFS ordering where deeper nodes come first, or reverse the array. The current BFS returns nodes in top-down order (direct children before grandchildren), so `[...descendantIds, nodeId]` actually processes children *before* grandchildren, then the root. This is fine for correctness (all get deleted regardless of order), but if the intent is specifically leaf-first, a reverse would be needed.

---

### 10. [Impl-note] Broadcast storm for large subtrees

N `node_removed` broadcasts for N nodes in a subtree means N separate WebSocket writes per connected client. For a subtree of 20 nodes with 3 clients, that is 60 WebSocket sends in a tight loop. Functional, but worth noting during implementation -- if performance matters, batch into a single message.

---

### 11. [Impl-note] `removeNode` does redundant edge cleanup when called per-node in a cascade

Each call to `removeNode(id)` iterates the full `edges` array to remove related edges. In a cascade of N deletions, this is O(N * E) where E is the total edge count. For the expected scale (small DAGs), this is fine. For larger graphs, consider collecting all node IDs and doing a single pass edge filter.

---

## Verdict

The plan is ready for implementation with fixes to issues 1-3 applied first (snapshot edges in `getDescendants`, clean up terminal subscriptions, handle `selectedNodeId` clearing). Issues 4-5 (cycle guard, type guard) are medium-priority improvements that would make the feature more robust. The rest can be addressed during or after implementation.
