---
title: "Auto Subtask Nodes for Subagents"
author: "human:aaron"
version: 2
created: 2026-03-02
---

# Auto Subtask Nodes for Subagents

## WANT

When a Claude agent spawns subagents (via the Agent tool), automatically create child nodes in the DAG so the user can see what's happening under the hood.

Each phantom node shows **operational visibility**:
- **Status** — running, completed, failed
- **Duration** — how long the subagent has been running
- **Token usage** — best-effort count from `task_progress` updates (may lag or arrive in jumps; not a guaranteed real-time counter)
- **Summary** — what the subagent accomplished (on completion)

Full terminal streaming (seeing the subagent's actual output) is a bonus if the SDK supports multiplexing child output into the parent stream. The metadata above is the guaranteed baseline.

> **v2 note:** Blocked/waiting detection is not feasible with the current SDK — `task_started`, `task_progress`, and `task_notification` carry no blocked-state field, and sessions run with `--dangerously-skip-permissions` so permission blocks don't apply. This could be revisited if full terminal streaming becomes available.

Phantom nodes appear as children of the parent agent node, connected by edges in the DAG. They auto-remove after the subagent completes successfully. Failed subagents stay visible so the user knows something went wrong.

## DON'T

- **No spawning from phantom nodes.** Users cannot create child tasks from phantom nodes — they are read-only indicators of subagent activity, not interactive workflow nodes.
- **No editing phantom nodes.** No renaming, no manual status changes, no drag-to-reparent.
- **No persistence.** Phantom nodes are transient. They should not survive app restart as real nodes. (Leaked phantom nodes from `updateNode` side effects are cleaned up on startup.)
- **No user input to phantom nodes.** Interaction boundaries:
  - `send_input` to a phantom node is silently dropped — phantom nodes don't accept user input
  - `close_node` on a phantom node stops the subagent and removes the phantom node
  - `delete_tree` on a parent cleans up all phantom children along with the parent
- **No DAG clutter.** If an agent spawns many subagents rapidly, the layout should handle it gracefully — no overlapping nodes, no layout thrash.

## LIKE

No specific external inspiration. Should feel native to the existing Stems DAG — same visual language, same node patterns, just clearly distinguishable as transient/agent-managed rather than user-created.

## FOR

- **Audience:** Developers using Stems as a local agent orchestration tool
- **Environment:** Localhost only, single user
- **Stack:** Bun + Vite + React + TypeScript + React Flow + Tailwind + Zustand
- **Integration:** Claude CLI streaming JSON protocol via `Bun.spawn`, SDK task lifecycle messages (`task_started`, `task_progress`, `task_notification`)

## ENSURE

- [ ] When an agent spawns a subagent, a child node appears in the DAG within 1 second
- [ ] Phantom nodes display status (running/completed/failed), duration, and token count
- [ ] Clicking a phantom node opens a read-only TerminalPeek (same component as regular nodes) with the input area hidden/disabled. If the phantom auto-removes while selected, selection falls back to the parent node
- [ ] Completed subagent nodes auto-remove after a brief delay (~2s) — but NOT while the phantom node is currently selected (auto-remove resumes once the user selects away)
- [ ] Failed subagent nodes stay visible with an error state — do not auto-remove
- [ ] Phantom nodes do not steal terminal focus from the parent agent
- [ ] Phantom nodes do not appear in the "done list" or persist across restarts
- [ ] Spawning 5+ subagents simultaneously does not cause layout thrash or overlapping nodes
- [ ] If terminal streaming is available from the SDK, subagent output streams into the phantom node's terminal
- [ ] If the parent node's session ends (crash, close, or completion), all its phantom child nodes immediately remove
- [ ] Stopped subagents (user-cancelled or timed out) auto-remove after the same brief delay as completed ones

## TRUST

**[autonomous]** Node positioning, layout algorithm, dagre configuration
**[autonomous]** Visual styling — colors, borders, animations, fade-out timing
**[autonomous]** Edge case handling — rapid spawns, cleanup timing, race conditions
**[autonomous]** SDK message parsing implementation details
**[autonomous]** Terminal buffer management for phantom nodes
**[ask]** Data model changes to shared types (`WeftNode`, `PersistedNode`)
**[ask]** Changes to existing node behavior (auto-select, `selectedNodeId`, completion logic)
