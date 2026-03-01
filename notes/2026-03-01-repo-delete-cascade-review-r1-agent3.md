# Repo Delete Cascade Plan Review — Product/UX (R1, Agent 3)

Reviewer focus: user-facing behavior, error states, interaction design, visual consistency, and DAG integrity during cascade deletion.

---

## [Must-fix] Rapid-fire `node_removed` broadcasts will cause visible "popping" — nodes disappear one at a time

**Section:** 3. `server/index.ts` — Handle `delete_tree`

**Issue:** The plan broadcasts a separate `node_removed` message for each node in the subtree. The client-side `node_removed` handler (useGraph.ts line 149) filters nodes and edges one at a time per message. For a repo with 5-10 descendants, the user will see nodes vanish individually over multiple render cycles, edges dangling momentarily as targets disappear before sources (or vice versa), and the dagre layout potentially reflowing between each removal. This creates a visually jarring "popping" effect rather than a clean single-frame subtree removal.

**Suggested fix:** Either (a) introduce a new server message `tree_removed` with `{ type: 'tree_removed'; nodeIds: string[] }` that the client handles in a single `set()` call filtering all IDs at once, or (b) batch all `node_removed` messages into a single WebSocket frame (e.g., `{ type: 'batch'; messages: ServerMessage[] }`) so the client can process them in one Zustand update. Option (a) is simpler and more explicit.

---

## [Must-fix] Terminal subscription leak — deleted nodes leave orphaned subscription entries

**Section:** 3. `server/index.ts` — Handle `delete_tree`

**Issue:** The cleanup sequence calls `killSession`, `clearOverlapNode`, `stopPRTracking`, `clearTerminalBuffer`, and `removeNode` — but never cleans up `terminalSubscriptions` for the deleted nodes. If a client is subscribed to a terminal for any node in the subtree, the subscription entry persists in the `terminalSubscriptions` Map in `server/state.ts`. This is a server-side memory leak that grows with each delete cycle. Unlike `close_node` (which also doesn't clean subscriptions but only handles one node at a time), cascade delete could leave many orphaned entries at once.

**Suggested fix:** Add a `clearTerminalSubscriptions(id)` call (new export from `state.ts`) to the cleanup sequence for each node, or have `removeNode` clean up subscriptions as a side effect. The existing `unsubscribeTerminal` function only removes a single client, so a new function that deletes the entire subscription Set for a nodeId is needed.

---

## [Must-fix] No count or details in confirmation dialog — user can't assess blast radius

**Section:** 4. `src/components/ConfirmDialog.tsx` and 6. `src/components/FlowCanvas.tsx`

**Issue:** The plan says the confirm dialog shows the repo node's title, but nothing about the number or identity of descendant nodes that will be destroyed. If a repo has 8 features with 20 subtasks across them, the user sees "Delete [repo name]?" with no indication that 28 nodes and their sessions will be killed. This is a significant UX gap for a destructive, non-undoable action — the user needs to understand the blast radius before confirming.

**Suggested fix:** Before showing the dialog, count descendants (client-side BFS on the edges in the Zustand store). Display something like: "This will permanently delete **stems** and all 28 child nodes (8 features, 20 subtasks). Active sessions will be terminated." The counts should be computed client-side from the graph store so no extra server round-trip is needed.

---

## [Medium] No undo or grace period — deletion is instant and irreversible

**Section:** 3. `server/index.ts` — Handle `delete_tree`, 6. `src/components/FlowCanvas.tsx`

**Issue:** Once the user confirms, every session is killed and every node is permanently removed. There is no undo, no "deleted recently" state, and no toast with an undo action. For a product that manages expensive Claude CLI sessions (which cost real money and take real time to run), accidental deletion of an entire subtree is a high-consequence mistake. The confirmation dialog helps, but confirmation dialogs are well-documented to suffer from "click-through" behavior — users develop muscle memory and confirm without reading.

**Suggested fix:** Consider a 5-second undo toast pattern: on confirm, immediately hide the nodes from the canvas (optimistic removal), show a toast "Deleted stems and 28 nodes. [Undo]", and only send the `delete_tree` message after the grace period expires. If the user clicks Undo, restore the hidden nodes. This is a pattern used by Gmail, Slack, and other tools for destructive actions. If this is too complex for v1, at minimum log it as a known UX debt item and ensure the confirmation dialog is sufficiently detailed (see previous issue).

---

## [Medium] No error handling for partial cascade failure on the server

**Section:** 3. `server/index.ts` — Handle `delete_tree`

**Issue:** The cleanup loop calls `killSession(id)` for each descendant, which is async. If any `killSession` call throws (e.g., the process is already dead but cleanup fails, or the session is in an unexpected state), the plan doesn't specify error handling. A thrown error in the `handleMessage` function would be caught by the top-level `.catch()` in `server/index.ts` (line 410), which sends a generic "Internal server error" to the client. But by that point, some nodes may have already been removed and broadcast. The user would see a partially deleted subtree with no way to recover — some nodes gone, others orphaned.

**Suggested fix:** Wrap each per-node cleanup in a try/catch so that a failure on one node doesn't abort the rest. Log the error and continue. After the loop, if any nodes failed to clean up, broadcast an error message identifying which nodes couldn't be fully removed. This is the standard pattern for batch operations — fail-open on individual items, report at the end.

---

## [Medium] Delete button placement and accidental click risk on RepoNode

**Section:** 5. `src/components/nodes/RepoNode.tsx` — Add delete button

**Issue:** The plan says to add a "small delete button" but doesn't specify where relative to the existing "+ Feature" button. The current RepoNode is compact (200px min-width). Placing a delete/trash icon close to the "+ Feature" button creates a misclick risk — the user reaches for "spawn feature" and hits "delete repo" instead. On a DAG canvas where nodes are draggable, accidental clicks during drag release are also possible.

**Suggested fix:** Place the delete button in the opposite corner from "+ Feature" (e.g., top-right corner as a small icon, while "+ Feature" is bottom-right). Use a distinct visual treatment — muted/dim by default, red on hover — so it doesn't draw attention during normal workflow. Also consider adding `e.stopPropagation()` and a small `pointer-events` guard to prevent drag-end from triggering delete.

---

## [Medium] Selected node cleanup is incomplete — terminal panel will show stale data briefly

**Section:** 7. `src/hooks/useGraph.ts` — Handle selected node cleanup

**Issue:** The plan says to clear `selectedNodeId` if the removed node is selected. But looking at `App.tsx` (lines 34-43), the `useEffect` that manages terminal subscriptions sends `unsubscribe_terminal` on cleanup. When `selectedNodeId` is cleared, the effect will try to unsubscribe from a node that no longer exists on the server. This is mostly harmless (the server's `unsubscribeTerminal` will be a no-op for an unknown nodeId), but the plan should also consider: what if the user has the terminal open for a *child* of the repo being deleted? The child gets removed (clearing subscription server-side via the leak fix above), but the client's `selectedNodeId` might still point to it until its specific `node_removed` message arrives. During that window, the terminal panel renders for a node that's already dead.

**Suggested fix:** In the `node_removed` handler (or the proposed `tree_removed` handler), check if `selectedNodeId` is in the set of removed IDs, and clear it in the same `set()` call that removes the nodes. This ensures the terminal panel closes in the same render frame the nodes disappear.

---

## [Low] `getDescendants` uses the server's mutable `edges` array directly — fragile coupling

**Section:** 1. `server/state.ts` — Add `getDescendants()` helper

**Issue:** The proposed `getDescendants` function references `edges` directly (the module-level array in state.ts). This works, but the BFS is iterating over an array that `removeNode` mutates by splicing. If `removeNode` is called during iteration (it isn't in the current plan since descendants are collected first), the results would be wrong. This is more of a correctness landmine than a current bug. The plan does collect descendants *before* starting removal, which is correct.

**Suggested fix:** Have `getDescendants` take an explicit edges parameter or use `getEdges()` (which returns a copy). This makes the function pure and testable, and prevents future refactors from accidentally introducing iteration-during-mutation bugs.

---

## [Low] No keyboard accessibility for the confirmation dialog

**Section:** 4. `src/components/ConfirmDialog.tsx`

**Issue:** The plan defines the component's props but doesn't mention keyboard interaction. For a destructive confirmation dialog, the standard pattern is: focus trap inside the dialog while open, Enter to confirm, Escape to cancel, Tab cycles between Cancel and Confirm buttons. The PromptEditor modal (referenced as the pattern to follow) may or may not implement these. If the dialog opens and focus isn't managed, keyboard users can't interact with it.

**Suggested fix:** Add to the spec: Escape closes (calls `onCancel`), focus is trapped, and auto-focus lands on the Cancel button (not Confirm) to prevent accidental Enter-key confirmation. This matches the macOS/web convention of defaulting to the safe action for destructive dialogs.

---

## [Impl-note] `delete_tree` should validate the target is actually a repo node

**Issue:** The plan doesn't restrict `delete_tree` to repo nodes. A `delete_tree` message with a feature or subtask nodeId would cascade-delete that subtree, which might be intentional functionality but isn't mentioned in the plan's scope. If this is intentional, the plan should say so. If it's repo-only, the handler should validate `node.type === 'repo'` and reject otherwise.

---

## [Impl-note] Edge case: deleting a repo while a child node's session is mid-spawn

**Issue:** If a feature was just spawned (session spawn is async — see `spawnSession` in the handler), and the user immediately deletes the repo, the `killSession` call might race with session initialization. The kill might no-op because the session hasn't been registered in the sessions Map yet, leaving an orphaned Claude process. This is a race condition to handle defensively during implementation.

---

## [Impl-note] The `ConfirmDialog` should prevent interaction with the canvas while open

**Issue:** While the plan specifies a `bg-black/60 backdrop-blur-sm` overlay (matching PromptEditor), it should ensure the overlay captures all pointer events. Otherwise, the user could drag nodes, click other buttons, or spawn features while the "are you sure?" dialog is up, leading to confusing state.

---

## Summary

| Severity | Count | Key themes |
|----------|-------|------------|
| Must-fix | 3 | Visual popping from per-node broadcasts, terminal subscription leak, missing blast radius info in confirmation |
| Medium | 4 | No undo pattern, partial failure handling, delete button placement, stale terminal during cascade |
| Low | 2 | Fragile edge iteration coupling, keyboard accessibility |
| Impl-note | 3 | Node type validation, spawn race condition, overlay pointer capture |

The plan's core architecture is sound — BFS traversal, distinct message type, children-first ordering, and reusable dialog component are all good decisions. The main gaps are on the UX side: the user needs more information before confirming (blast radius), the visual transition should be atomic (batch removal), and server cleanup should be comprehensive (terminal subscriptions) and resilient (try/catch per node).
