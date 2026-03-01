# Architect Review (Round 2): Repo Delete with Cascading Subtree Removal

**Reviewer:** Architect (distributed systems, state management, process lifecycle)
**Plan:** `plans/repo-delete-cascade.md` (revision 2)
**Date:** 2026-03-01

---

## Round 1 Fix Assessment

The five must-fix / medium issues from Round 1 were all addressed. Here is a per-issue status:

### R1-1 (Must-fix): `getDescendants()` edge mutation hazard
**Status: Fixed correctly.** The plan now snapshots edges at the top of `getDescendants`: `const snapshot = [...edges]` and iterates over `snapshot`. This eliminates the mutation hazard regardless of call order. No issues introduced.

### R1-2 (Must-fix): Terminal subscriptions not cleaned up
**Status: Fixed correctly.** A new `clearTerminalSubscriptions(nodeId)` helper is added to `state.ts` and called in the per-node cleanup loop in Section 3. The implementation (`terminalSubscriptions.delete(nodeId)`) is the right approach -- it removes the entire entry rather than iterating subscribers.

### R1-3 (Must-fix): N-render "popping" / selectedNodeId not cleared
**Status: Fixed correctly.** This was the most substantial change. The plan now introduces a dedicated `tree_removed` server message (`{ type: 'tree_removed', nodeIds: string[] }`) and a corresponding frontend handler that does batch removal + selection clearing in a single `set()` call. This is the right design: it avoids N re-renders, avoids the visible node-by-node popping, and handles `selectedNodeId` in the same atomic state update. The existing `node_removed` handler is preserved for single-node removals (e.g., `close_node` / `autoMoveIfComplete`). Clean separation.

### R1-4 (Medium): No cycle guard in BFS
**Status: NOT addressed.** The `getDescendants` BFS in Section 1 still has no `visited` Set. The plan was updated with the edge snapshot fix but the cycle guard was not added. See Issue 1 below.

### R1-5 (Medium): No node type guard on server
**Status: NOT addressed.** The server handler in Section 3 still does not validate that `nodeId` refers to a repo node (or any existing node at all). See Issue 2 below.

**Overall Round 1 verdict:** The three must-fix issues were resolved well. The two medium issues were not addressed. No regressions were introduced by the fixes.

---

## Remaining and New Issues

### 1. [Medium] BFS still has no cycle guard (carried from R1-4)

**Section:** 1 (`getDescendants` helper in `server/state.ts`)

The BFS does not track visited nodes. If a cycle exists in the edge data (should not happen in a DAG, but could via a bug or corrupted state), the `while (queue.length > 0)` loop runs forever, hanging the single-threaded Bun event loop and freezing the entire server.

```typescript
const queue = [nodeId];
while (queue.length > 0) {
  const current = queue.shift()!;
  for (const edge of snapshot) {
    if (edge.source === current) {
      descendants.push(edge.target);  // pushed every time, even if already seen
      queue.push(edge.target);
    }
  }
}
```

**Suggested fix:** Add a `visited` Set. Three lines of change:

```typescript
const visited = new Set<string>([nodeId]);
// ...inside the inner loop:
if (edge.source === current && !visited.has(edge.target)) {
  visited.add(edge.target);
  descendants.push(edge.target);
  queue.push(edge.target);
}
```

This also prevents duplicate entries in the `descendants` array if the graph has diamond shapes (A -> B, A -> C, B -> D, C -> D would currently push D twice). Without the guard, `killSession(D)` would be called twice -- harmless (it returns early on second call) but wasteful and semantically wrong for the `tree_removed` broadcast which would contain duplicate IDs.

**Why plan-level:** A server hang from a cycle is unrecoverable without restart. The fix is three lines and eliminates an entire class of failure.

---

### 2. [Medium] No existence or type guard on `delete_tree` handler (carried from R1-5)

**Section:** 3 (`server/index.ts` handler)

The handler immediately calls `getDescendants(nodeId)` without first verifying that `nodeId` exists in the node map. If a stale or malformed client message arrives with a nonexistent `nodeId`:

- `getDescendants` returns `[]` (no edges reference a nonexistent node)
- The loop iterates over `[nodeId]` and calls `killSession(nodeId)` (no-op), `clearOverlapNode(nodeId)` (no-op), etc.
- `removeNode(nodeId)` returns `null` (node doesn't exist)
- `broadcast({ type: 'tree_removed', nodeIds: [nodeId] })` goes out to all clients
- The frontend removes nothing (the ID isn't in the store), but this is a wasted broadcast

More importantly, the plan frames this feature as repo-specific (Section 5 puts the button only on `RepoNode`), but the server handler is generic. A crafted or buggy client message like `{ type: 'delete_tree', nodeId: '<some-feature-id>' }` would cascade-delete a feature subtree without any UI confirmation dialog (since the dialog is only wired to repo nodes).

**Suggested fix:** Add a guard at the top of the handler:

```typescript
const targetNode = getNode(msg.nodeId);
if (!targetNode) return;
// Optionally, if repo-only: if (targetNode.type !== 'repo') return;
```

If the intent is to support subtree deletion from any node type in the future, document that explicitly and omit the type guard -- but the existence check is mandatory regardless.

**Why plan-level:** Without the existence check, the handler does meaningless work and broadcasts phantom `tree_removed` messages. The type guard question affects API contract design.

---

### 3. [Medium] `removeFromDoneList` interaction with `autoMoveIfComplete` creates a timing gap

**Section:** 1 (`removeFromDoneList` in `state.ts`) + 3 (handler)

The plan adds `removeFromDoneList(id)` to handle descendants that were auto-moved to the done list before the tree delete. This is a good catch -- but there's a subtle ordering issue.

Consider this sequence:
1. User has a repo with Feature A (running) and Subtask B (completed, auto-moved to done list via `autoMoveIfComplete`)
2. When B was auto-moved, `removeNode(B)` was called (B is no longer in the nodes map) and `autoMoveIfComplete` checked the parent (Feature A), which wasn't complete yet
3. User clicks delete on the repo
4. `getDescendants(repoId)` walks edges -- but B's edges were already removed when B was auto-moved to done (line 92-101 of `state.ts`: `removeNode` deletes related edges)
5. So `getDescendants` returns `[featureA_id]` -- it never finds B because the edge `featureA -> B` no longer exists
6. The cleanup loop processes Feature A and the repo, but **never calls `removeFromDoneList(B)`**
7. B remains as a ghost entry in the done list

The `removeFromDoneList` helper exists but it will never be called for nodes that were already moved to done, because those nodes have already been severed from the edge graph.

**Suggested fix:** After the BFS walk, also scan the done list for nodes whose `parentId` chain leads to the deleted root. Alternatively, simpler: scan `doneList` for any node whose `parentId` is in the `allIds` set (the set of nodes being deleted). This catches direct children that were done-listed. For deeper nesting, use a recursive check or maintain a `subtreeRoot` field on done-list entries.

The simplest approach: after building `allIds` from BFS, add a second pass:

```typescript
const allIdsSet = new Set(allIds);
for (const doneNode of getDoneList()) {
  if (doneNode.parentId && allIdsSet.has(doneNode.parentId)) {
    allIdsSet.add(doneNode.id);
    allIds.push(doneNode.id);
  }
}
```

Note this only catches one level of done-list nesting. If grandchildren are also in the done list, you'd need to iterate until stable. For the expected tree depth (repo -> feature -> subtask, max 3 levels), a second pass is likely sufficient.

**Why plan-level:** This is a data consistency issue. Ghost entries in the done list sidebar will confuse users and won't be clearable through normal UI interactions.

---

### 4. [Medium] Client-side BFS for blast radius uses Zustand edges, which may be stale relative to server

**Section:** 6 (`FlowCanvas.tsx` client-side BFS)

The plan has the client run its own BFS over Zustand store edges to count descendants for the confirmation dialog's "blast radius" message. The server independently runs its own BFS over server-side edges when the `delete_tree` message arrives.

These two BFS traversals operate on different data sources. If a node was added or removed between the client's last `full_state`/`node_added` message and the moment the user clicks delete, the blast radius count in the dialog could differ from what the server actually deletes. This is cosmetic (the server is authoritative), but a user seeing "Delete 1 feature, 2 subtasks" and then observing 3 subtasks disappear would be confusing.

**Suggested fix:** This is acceptable for v1 -- the Zustand store is kept closely in sync via WebSocket, and the window for divergence is small. Document this as a known limitation. If it matters later, the confirmation flow could be made two-phase: client sends a `preview_delete_tree` request, server responds with the authoritative count, client shows dialog, client sends `confirm_delete_tree`.

**Why plan-level (barely):** It's a design tradeoff worth documenting. No rework needed if the team understands and accepts it.

---

### 5. [Low] `close_node` handler still lacks `clearTerminalSubscriptions` -- divergence from `delete_tree`

**Section:** 3 (server/index.ts handler), referencing existing `close_node` handler

The R1 review (Issue 2) noted that `close_node` has the same terminal subscription leak. The plan added `clearTerminalSubscriptions` to the `delete_tree` handler's cleanup loop but did not update `close_node` (lines 219-230 of `server/index.ts`). The two handlers now have different cleanup step lists:

| Step | `close_node` | `delete_tree` |
|------|:---:|:---:|
| `killSession` | yes | yes |
| `clearOverlapNode` | yes | yes |
| `stopPRTracking` | yes | yes |
| `clearTerminalBuffer` | yes | yes |
| `clearTerminalSubscriptions` | **no** | yes |
| `removeFromDoneList` | n/a | yes |
| `removeNode` | yes | yes |

This divergence is exactly the problem R1 Issue 8 flagged. The plan did not extract a shared cleanup helper, and the two handlers are now inconsistent.

**Suggested fix:** Either add `clearTerminalSubscriptions` to `close_node` in the plan, or extract the shared `cleanupAndRemoveNode` helper suggested in R1 Issue 8. The latter prevents future divergence.

---

### 6. [Low] `tree_removed` nodeIds array could include IDs unknown to client

**Section:** 7 (`useGraph.ts` handler)

If a node was auto-moved to the done list before the tree delete (see Issue 3), the server's `tree_removed` broadcast might include its ID even though the client's Zustand `nodes` array no longer contains it (it was already removed via the earlier `node_removed` broadcast from `autoMoveIfComplete`). The client-side `filter` handles this gracefully (filtering out an absent ID is a no-op), so no bug occurs. But the `selectedNodeId` check could theoretically clear selection for a node that was already gone. Again, harmless since `selectedNodeId` would have been cleared when the node was originally removed -- unless the user manually re-selected something else in the meantime, in which case the check correctly does nothing.

**Suggested fix:** No action needed. Noting for completeness that the handler is resilient to this case.

---

### 7. [Impl-note] Race: delete during mid-spawn (carried from R1-6)

The race condition from R1 Issue 6 remains relevant. If a user deletes a repo while a child's `spawnSession` is between `sessions.set(nodeId, session)` (line 64 of `session.ts`) and the first message from `consumeTurn`, `killSession` will find the session and abort it correctly. The more dangerous window is between `addNode` in `server/index.ts` (line 145) and `sessions.set` in `session.ts` (line 64) -- during this gap, `killSession` returns early (no session), and the SDK `query()` call hasn't started yet so there's nothing to abort. The `await spawnSession(...)` will then start the query after the node has been removed.

However, `consumeTurn` handles this: after the turn completes, it calls `getNode(nodeId)` (line 151 of `session.ts`) which returns `undefined` for a deleted node, and the function returns early. The SDK query runs to completion (or until its own timeout), but no state corruption occurs. The orphaned Claude CLI process is the only concern -- it will run until its query finishes naturally.

**Suggested fix:** Implementation-time concern. During implementation, consider adding an early-exit check in `consumeTurn`'s `for await` loop: if `getNode(nodeId)` returns falsy, abort and return.

---

### 8. [Impl-note] `killSession` is async but not awaited in the plan's loop description

**Section:** 3 (server/index.ts handler)

The plan's Step 3 lists `killSession(id)` as part of a synchronous-looking loop. Looking at the actual code, `killSession` is `async` (line 214 of `session.ts`) though its current implementation doesn't actually await anything (the abort is synchronous, `sessions.delete` is synchronous). If the implementation adds any async cleanup (e.g., waiting for the CLI process to exit), the loop would need `await killSession(id)` for each node. As-is, this works but is worth noting.

---

## Verdict

The three must-fix items from Round 1 were handled well. The `tree_removed` batch message is a solid improvement over per-node broadcasts. The plan is structurally sound and ready for implementation with the following adjustments:

**Should fix before implementing (Medium):**
1. Add a `visited` Set to `getDescendants` BFS (Issue 1) -- 3 lines, prevents infinite loops and duplicate IDs
2. Add existence guard at top of `delete_tree` handler (Issue 2) -- 2 lines, prevents phantom broadcasts
3. Address done-list ghost entries for already-completed descendants (Issue 3) -- requires a second pass over the done list after BFS

**Should fix but won't block (Low):**
4. Sync `close_node` cleanup steps with `delete_tree`, or extract shared helper (Issue 5)

Everything else can be discovered and handled during implementation.
