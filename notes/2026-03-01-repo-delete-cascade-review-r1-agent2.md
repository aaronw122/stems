# Review: Repo Delete with Cascading Subtree Removal

**Reviewer:** Process & State Management Specialist
**Date:** 2026-03-01
**Plan file:** `plans/repo-delete-cascade.md`

---

## Summary

The plan is well-structured and covers the core workflow: BFS descendant collection, cascading kill/cleanup, confirmation UI, and store cleanup. The message type separation (`delete_tree` vs `close_node`) is a good design call. Six issues found, most at medium severity, with one must-fix around process cleanup ordering.

---

## Issues

### 1. [Must-fix] Terminal subscriptions not cleaned up for deleted nodes

**Section:** 3 — `server/index.ts` — Handle `delete_tree`

The cleanup list (step 3) calls `killSession`, `clearOverlapNode`, `stopPRTracking`, `clearTerminalBuffer`, and `removeNode` — but never cleans up `terminalSubscriptions` in `server/state.ts`. When a node is deleted, any WebSocket clients subscribed to that node's terminal remain in the `terminalSubscriptions` map as dangling entries. This is a memory leak, and more importantly, if a new node happened to reuse the same ID (UUIDs make this near-impossible, but the principle stands), it would inherit stale subscribers.

The existing `close_node` handler has the same gap, but that's pre-existing — `delete_tree` should not replicate it.

**Fix:** Add a `clearTerminalSubscriptions(nodeId: string)` export to `server/state.ts` that deletes the nodeId key from the `terminalSubscriptions` map. Call it in the cascade loop alongside `clearTerminalBuffer`. Alternatively, have `removeNode` itself clean up terminal subscriptions, since a removed node should never have subscribers.

---

### 2. [Must-fix] `getDescendants` reads `edges` module-level array directly — but `edges` is not exported

**Section:** 1 — `server/state.ts` — Add `getDescendants()` helper

The plan's `getDescendants` function references a bare `edges` variable:

```typescript
for (const edge of edges) {
```

In the actual codebase, `edges` is a module-private `const edges: WeftEdge[] = []` inside `state.ts`. The function is defined as an export of `state.ts`, so it *does* have closure access to the private array. This will work as written.

However, there is a subtle correctness issue: `removeNode(id)` mutates the `edges` array (splicing out edges for the removed node). The plan's cascade loop in Section 3 processes children first, root last. When a child is removed via `removeNode(id)`, its edges are spliced from the array. If `getDescendants` was called *before* the loop (which it is — step 1 collects all IDs, then step 3 iterates), this is fine because the ID list is already captured. But this ordering dependency should be documented since it's fragile: if someone later refactors the handler to interleave discovery and removal, it will silently miss descendants.

**Fix:** Add a comment in the plan's cascade handler noting that `getDescendants` must be called before any `removeNode` calls, since `removeNode` mutates the edges array. The current plan already does this correctly — this is about making the invariant explicit.

---

### 3. [Medium] Rapid `node_removed` broadcasts cause N+1 Zustand updates for N descendants

**Section:** 3 — `server/index.ts` — Handle `delete_tree`

The plan broadcasts `node_removed` once per node in the subtree. Each broadcast triggers a separate `processMessage` call in the Zustand store, each of which calls `set()` with a new filtered array. For a tree of depth 3 with, say, 10 subtasks, that's 12 separate state updates causing 12 re-renders — each one filtering over the full node/edge arrays.

This won't cause *bugs*, but it's architecturally worth addressing now since it affects the contract between server and client.

**Fix:** Consider adding a batch message type like `{ type: 'nodes_removed'; nodeIds: string[] }` that the client handles in a single `set()` call. Alternatively, keep the per-node broadcasts but have the client batch them (e.g., `requestAnimationFrame` debounce in `processMessage`). The batch message approach is cleaner and avoids adding debounce complexity to the store.

---

### 4. [Medium] No `done_list_updated` broadcast — but `close_node` sends one

**Section:** 3 — `server/index.ts` — Handle `delete_tree`

The plan says "Do NOT add to done list (this is a delete, not a close)" — which is correct. But the existing `close_node` handler broadcasts `done_list_updated` after adding to the done list. If the deleted nodes were *already* on the done list from a previous `autoMoveIfComplete` cycle (e.g., a completed subtask that was auto-moved but whose parent tree is now being deleted), the done list could contain stale references to nodes that no longer exist.

This isn't about `delete_tree` adding to the done list — it's about `delete_tree` needing to *remove* already-done descendants from the done list. The `doneList` in `server/state.ts` is a plain array that never gets pruned by the current `removeNode` function.

**Fix:** Check whether any of the nodes being deleted exist in the `doneList` and remove them. Add a `removeFromDoneList(nodeId: string)` helper to `state.ts`. If any were removed, broadcast `done_list_updated`. This prevents the client's done list sidebar from showing ghost entries for deleted nodes.

---

### 5. [Medium] `node_removed` handler in `useGraph.ts` does not clear `selectedNodeId`

**Section:** 7 — `src/hooks/useGraph.ts` — Handle selected node cleanup

The plan correctly identifies this gap and says to fix it. However, the plan's description is incomplete: it says "if the removed node is the currently selected node, clear selection" — but the user could also be viewing a *child* of the deleted repo. In a cascade delete, the repo node is removed last (children first, root last per the plan). So if the user has a subtask's terminal open and the repo is deleted, the subtask's `node_removed` message arrives first and correctly deselects.

But consider this: the `node_removed` handler in `useGraph.ts` currently only filters nodes/edges. The plan says to add selection clearing, but doesn't show the implementation. The fix needs to be inside the existing `node_removed` case, checking `state.selectedNodeId === msg.nodeId`. This is straightforward but worth being explicit about.

**Fix:** The plan's Section 7 implementation should be:

```typescript
case 'node_removed': {
  set((state) => ({
    nodes: state.nodes.filter((n) => n.id !== msg.nodeId),
    edges: state.edges.filter(
      (e) => e.source !== msg.nodeId && e.target !== msg.nodeId,
    ),
    ...(state.selectedNodeId === msg.nodeId ? { selectedNodeId: null } : {}),
  }));
  break;
}
```

This also triggers the `useEffect` cleanup in `App.tsx` that sends `unsubscribe_terminal`, which is important for the terminal subscription cleanup chain.

---

### 6. [Low] `getDescendants` does not include cycle detection

**Section:** 1 — `server/state.ts` — Add `getDescendants()` helper

The BFS implementation has no visited set. If a cycle somehow exists in the edge data (bug elsewhere, corrupted state), this becomes an infinite loop. DAGs should not have cycles, but a defensive `visited` set costs almost nothing and prevents a server hang.

**Fix:** Add a `visited` set:

```typescript
export function getDescendants(nodeId: string): string[] {
  const descendants: string[] = [];
  const visited = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        visited.add(edge.target);
        descendants.push(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return descendants;
}
```

---

### 7. [Impl-note] `killSession` is async but the cascade loop doesn't await concurrently

**Section:** 3 — `server/index.ts` — Handle `delete_tree`

The plan lists `killSession(id)` in the per-node loop. Looking at the actual `killSession` implementation, it calls `abortController.abort()` synchronously and deletes from the map — the `async` signature is vestigial (the function doesn't actually await anything). So sequential execution is fine today. If `killSession` later becomes truly async (e.g., waiting for graceful shutdown), the cascade should use `Promise.all` for the kill phase before proceeding to state cleanup, to avoid removing nodes from state while their sessions are still shutting down. Log for implementation but not a plan-level issue.

---

### 8. [Impl-note] Error handling for partial cascade failure

**Section:** 3 — `server/index.ts` — Handle `delete_tree`

If `killSession` throws for one node mid-cascade, the remaining nodes won't be cleaned up. In practice `killSession` swallows errors today, but a try/catch around the full loop with continue-on-error semantics would be more robust. Implementation-level concern.

---

### 9. [Impl-note] `RepoNode` delete button UX — click target and accidental deletion

**Section:** 5 — `src/components/nodes/RepoNode.tsx`

The plan says "small delete button" but doesn't specify placement relative to the existing `+ Feature` button. Given the node is `min-w-[200px]`, space is tight. The confirmation dialog handles accidental clicks, so this is just a layout/UX detail for implementation.

---

## Overall Assessment

The plan is solid and covers the essential pieces. The two must-fix issues (terminal subscription cleanup, done list pruning) would cause real state leaks if missed. The batch broadcast issue (medium) is a design decision worth making before implementation since it affects the server-client message contract. Everything else is implementable as-is with minor adjustments.
