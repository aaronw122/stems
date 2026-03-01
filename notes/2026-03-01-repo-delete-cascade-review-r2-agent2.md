# Review (Round 2): Repo Delete with Cascading Subtree Removal

**Reviewer:** Process & State Management Specialist
**Date:** 2026-03-01
**Plan file:** `plans/repo-delete-cascade.md` (revision 2)
**Prior review:** `notes/2026-03-01-repo-delete-cascade-review-r1-agent2.md`

---

## Round 1 Fix Assessment

The R1 review raised 5 must-fix/medium issues (issues 1-5) and 1 low. Here is how each was addressed in revision 2:

### R1 Issue 1 (Must-fix): Terminal subscriptions not cleaned up
**Status: Fixed correctly.** The plan now adds `clearTerminalSubscriptions(nodeId)` to `server/state.ts` and calls it in the cascade loop (Section 3, step 3). The implementation deletes the entire key from the `terminalSubscriptions` map, which is correct.

### R1 Issue 2 (Must-fix): `getDescendants` reads edges directly / ordering fragility
**Status: Fixed correctly.** The plan now snapshots the edges array at the start of `getDescendants`: `const snapshot = [...edges]`. This decouples discovery from later `removeNode` mutations. The ordering invariant is still implicit (getDescendants is called before the loop), but the snapshot makes it resilient to refactoring. Good fix.

### R1 Issue 3 (Medium): N+1 Zustand updates from per-node broadcasts
**Status: Fixed correctly.** The plan now introduces a `tree_removed` server message with a `nodeIds: string[]` payload. The server broadcasts once after the loop. The client handles it in a single `set()` call with `Set`-based filtering. This is the clean batch approach suggested in R1.

### R1 Issue 4 (Medium): No done list pruning for already-completed descendants
**Status: Fixed correctly.** The plan adds `removeFromDoneList(nodeId)` to `server/state.ts` and calls it in the cascade loop. It tracks whether any returned `true` and conditionally broadcasts `done_list_updated`. The implementation uses `findIndex` + `splice`, which is correct for a plain array.

### R1 Issue 5 (Medium): `node_removed` handler in `useGraph.ts` does not clear `selectedNodeId`
**Status: Fixed correctly, and improved.** Rather than patching the existing `node_removed` handler (which the R1 review suggested), the plan takes a better approach: the new `tree_removed` handler in Section 7 includes selection clearing in the same `set()` call via conditional spread. The `node_removed` handler is left unchanged for single-node removals (from `close_node` / `autoMoveIfComplete`), which is acceptable since those are move-to-done operations where the terminal would close naturally. However, see Issue 1 below for a residual concern.

### R1 Issue 6 (Low): No cycle detection in BFS
**Status: Not addressed.** The `getDescendants` implementation still has no `visited` set. See Issue 2 below.

**Overall: 4 of 5 actionable issues were fixed correctly. No regressions introduced by the fixes.**

---

## New Issues in Revision 2

### 1. [Medium] `node_removed` handler still does not clear `selectedNodeId` for single-node removals

**Section:** 7 — `src/hooks/useGraph.ts`

The new `tree_removed` handler correctly clears `selectedNodeId`. But the existing `node_removed` handler (lines 149-157 of current `useGraph.ts`) does not, and the plan explicitly says it "remains unchanged." This means if `autoMoveIfComplete` in `completion.ts` removes a node the user is currently viewing (by broadcasting `node_removed`), the terminal panel will reference a deleted node — `selectedNodeId` will point at a node that no longer exists in the `nodes` array.

This is a pre-existing bug, not introduced by revision 2. But the plan touches this exact handler and explicitly decides not to fix it. Since the plan is adding selection-clearing logic right next to it, it would cost one line to also fix `node_removed`. Without it, the `tree_removed` handler handles the cascade case correctly, but the single-node auto-completion case still leaves a dangling selection.

**Fix:** Add the same conditional spread to the existing `node_removed` case:
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

This is a one-line addition that eliminates a real (if edge-case) bug while you are already working in this handler.

---

### 2. [Low] `getDescendants` BFS still has no cycle detection

**Section:** 1 — `server/state.ts`

Carried forward from R1 Issue 6. The snapshot fix from R1 is good, but the BFS still lacks a `visited` set. If a cycle were introduced (e.g., by a future bug in edge creation), `getDescendants` would infinite-loop, hanging the server's main thread. A `Set<string>` costs one allocation and prevents a server freeze.

**Fix:** Same as R1 — add a visited set:
```typescript
export function getDescendants(nodeId: string): string[] {
  const snapshot = [...edges];
  const descendants: string[] = [];
  const visited = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of snapshot) {
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

### 3. [Medium] Client-side BFS in FlowCanvas duplicates server-side logic and can diverge

**Section:** 6 — `src/components/FlowCanvas.tsx`

The plan adds a `getDescendantIds` function to FlowCanvas that duplicates the BFS logic from `server/state.ts`. The client version walks Zustand store edges to compute blast radius for the confirmation dialog, while the server version walks its own `edges` array to determine what to actually delete.

These two data sources can diverge: the client's Zustand store reflects the last-received server state, but there could be edges the server has added/removed since the last `full_state` or `node_added` broadcast that the client hasn't seen yet (e.g., a race with a concurrent `autoMoveIfComplete` that removes a completed child). In that case, the confirmation dialog would show a count that doesn't match what the server actually deletes.

This is not architecturally wrong — the server is always authoritative, and the dialog is just informational. But it is worth calling out as a design decision: the confirmation message is a best-effort estimate, not a guarantee.

**Fix:** Add a brief comment in the plan noting that the client-side BFS is for display purposes only and the server is authoritative. No code change needed, just intent documentation so the implementer doesn't try to "fix" the divergence by making the client authoritative.

---

### 4. [Low] `close_node` handler also lacks `clearTerminalSubscriptions`

**Section:** 3 — `server/index.ts`

The R1 review noted this as pre-existing. Now that `clearTerminalSubscriptions` is being added to `state.ts` for `delete_tree`, the existing `close_node` handler (lines 219-229 of `server/index.ts`) still does not call it. The `delete_tree` handler will clean up subscriptions, but `close_node` (which moves a single node to the done list) leaves the `terminalSubscriptions` map entry dangling.

In practice this is harmless: the `App.tsx` `useEffect` sends `unsubscribe_terminal` when `selectedNodeId` changes, so the client-side cleanup usually happens. But if the close happens while no client is subscribed, the empty `Set` entry persists as a minor memory leak.

**Fix:** Add `clearTerminalSubscriptions(msg.nodeId)` to the `close_node` handler alongside `clearTerminalBuffer`. This is a one-line opportunistic fix while the helper is being created.

---

### 5. [Impl-note] `removeFromDoneList` uses linear search — fine for now

**Section:** 1 — `server/state.ts`

`removeFromDoneList` uses `findIndex` + `splice` on the `doneList` array. For a cascade of N nodes, this is O(N*D) where D is the done list size. Given realistic tree sizes (tens of nodes, not thousands), this is fine. If the done list grows large in the future, a Map-based lookup would be better. Not a plan-level concern.

---

### 6. [Impl-note] `delete_tree` handler does not validate that `nodeId` is a repo node

**Section:** 3 — `server/index.ts`

The plan describes this as a repo-delete feature with a delete button on `RepoNode`, but the server handler does not check that the requested node is actually of type `repo`. If a malformed client message sends a feature or subtask ID as the `nodeId`, the handler would still cascade-delete everything below it. This could be intentional (generic tree delete) or a gap. If it's intentional, the handler name and message type are fine. If it should be repo-only, add a type check. Either way, this is an implementation detail — the server should decide at coding time.

---

### 7. [Impl-note] `onDelete` prop threading through `nodeTypes` needs React Flow data injection

**Section:** 5-6 — RepoNode + FlowCanvas

The plan says FlowCanvas passes `onDelete` to RepoNode "via `nodeTypes` data." The existing pattern (visible in `FlowCanvas.tsx` lines 46-53) injects callbacks via `nodesWithCallbacks`, which spreads `onSpawn` and `onUpdateTitle` into `node.data`. The plan should follow the same pattern for `onDelete`. The plan references this pattern correctly ("passed down from FlowCanvas") but the `send` function also needs to be available in the handler scope, since on-confirm sends a WebSocket message. This is straightforward given the existing `send` prop, but worth noting.

---

## Summary

Revision 2 is in good shape. The R1 fixes all landed correctly and the batch `tree_removed` message is a clean solution. Two medium issues remain:

1. **`node_removed` handler still lacks selection clearing** — one-line fix, same pattern as the new `tree_removed` handler
2. **Client/server BFS divergence** — design decision, just needs intent documentation

One low issue (`close_node` missing `clearTerminalSubscriptions`) is a natural fix-while-you're-here opportunity. The BFS cycle detection is still a low-severity gap.

**Verdict:** Ready for implementation with the two medium items addressed.
