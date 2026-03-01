# Terminal Rendering Plan Review — Round 2, Backend Data Pipeline

**Reviewer:** Backend Data Pipeline Architect (Agent 2)
**Date:** 2026-03-01
**Plan:** `plans/claude-terminal-theming.md` (revision 5)
**Scope:** Verify Round 1 fixes are architecturally sound; focus on backend data handling, SDK protocol correctness, and server/client type contracts.

---

## Round 1 Fix Verification

### 1. `extractToolSummary` for tool_use text — PARTIALLY FIXED

**Plan (line 135, 143-191):** Specifies `extractToolSummary(name, input)` helper and uses it in the tool_use mapping.

**Current code (`message-processor.ts:190`):**
```typescript
messages.push({ type: 'tool_use', text: name, toolName: name });
```

The plan correctly specifies the fix, but **the code has not been updated yet** — it still sets `text: name` which produces `ToolName ToolName` in the renderer. The plan is sound; implementation just hasn't landed.

**Severity:** Impl-note (the plan is correct; this is an implementation gap, not a plan issue).

### 2. `handleUser()` for tool_result blocks — NOT YET IMPLEMENTED (plan spec needs scrutiny)

**Plan (lines 193-219):** Specifies adding a `case 'user'` branch and `handleUser()` function.

**Current code:** No `case 'user'` exists in `processMessage()`. The dead `tool_result` code is still inside `handleAssistant()` (lines 162-177).

The plan specification is correct that this needs to move. See Issue #1 below for the critical question about whether `'user'` messages actually arrive through the stream.

### 3. Missing `└` connector — FIXED IN PLAN, NOT IN CODE

**Plan (lines 355-368):** Correctly specifies `└` (U+2514) connector.

**Current code (`TerminalMessageRenderer.tsx:106-108`):** Still uses a colored bullet `●`. Plan is correct; code hasn't caught up.

**Severity:** Impl-note.

### 4. Running/error status fields — PARTIALLY SPECIFIED IN PLAN, NOT IN TYPES

**Plan (lines 103-111):** Specifies `toolUseId?: string` and `status?: 'running' | 'success' | 'error'` on `TerminalMessage`.

**Current types (`shared/types.ts:12-18`):** Missing both `toolUseId` and `status` fields. The type only has `type`, `text`, `toolName`, `isSuccess`, `costUsd`.

**Severity:** Impl-note (plan is correct, types haven't been updated yet).

### 5. Collapse/expand — SPECIFIED IN PLAN, NOT IN CODE

**Plan (lines 390-421):** Specifies collapse/expand with `useState` and correctly notes the hooks-in-switch-case issue requiring a sub-component extraction.

**Current code:** No collapse behavior, no sub-component.

**Severity:** Impl-note.

### 6. "Completed" system message — NOT YET REMOVED

**Plan (lines 506-513):** Correctly specifies removing the `messages.push({ type: 'system', text: 'Completed', ... })` at line 275.

**Current code (`message-processor.ts:275`):** Still present.

**Severity:** Impl-note.

---

## New Issues Found

### Issue #1: SDK does NOT emit `'user'` messages through the stream in normal operation

**Severity: Must-fix (plan specification is wrong about protocol)**

**The problem:** The plan (lines 193-219) specifies adding a `case 'user'` handler to `processMessage()` to catch `SDKUserMessage` events containing `tool_result` blocks. However, examining the SDK types and the actual stream behavior:

1. The SDK `Query` type (`sdk.d.ts:1249`) is `AsyncGenerator<SDKMessage, void>`. The union type `SDKMessage` does include `SDKUserMessage`, so theoretically `'user'` messages could appear in the stream.

2. **But in practice, the SDK's stream-json protocol for `query()` does not emit `user` messages during a normal turn.** The flow is:
   - `system` (init) -> `stream_event` (deltas) -> `assistant` (complete message with tool_use blocks) -> internally the SDK executes tools and builds the `user` message -> `stream_event` (next turn deltas) -> `assistant` (next turn) -> ... -> `result`

3. The `SDKUserMessage` type exists primarily for:
   - **Resume/replay scenarios** (`SDKUserMessageReplay` with `isReplay: true`)
   - **The `streamInput()` API** where the caller provides user messages
   - **Internal protocol** between the SDK and CLI

4. Looking at the actual stream consumption in `session.ts:114`:
   ```typescript
   for await (const msg of queryInstance) {
     processor.processMessage(msg);
   }
   ```
   The processor receives whatever the `Query` async generator yields. If the SDK does yield `user` messages between turns (which some SDK versions do for conversation history replay), the handler would work. But if it doesn't, `handleUser()` would be dead code.

**Recommendation:** This needs empirical verification. Add a debug log for `case 'user'` to confirm whether the SDK actually yields these messages. The plan should include a fallback strategy:

- **If `user` messages ARE yielded:** The plan is correct as-is.
- **If `user` messages are NOT yielded:** Tool results are invisible to the terminal. The alternative is to extract tool result information from the *next* `assistant` message's context, or to use `SDKToolProgressMessage` events (which the SDK does emit and which are currently ignored in the `default` branch).

Check `SDKToolProgressMessage`:

```typescript
// Currently ignored in the default case — but may contain tool output
export declare type SDKToolProgressMessage = {
    type: 'tool_progress';
    // ... likely has tool_use_id and partial output
};
```

**Why this matters:** If `handleUser()` never fires, there are zero tool results in the terminal. Users see tool invocations spinning forever (since status never updates from `'running'`) and no output. This is a core UX failure.

### Issue #2: `toolUseIdToName` map is scoped correctly but has no cleanup path

**Severity: Low**

The plan (lines 214-215) specifies `toolUseIdToName: Map<string, string>` in the "processor closure." In `createMessageProcessor()`, this would be a local variable captured in the closure, scoped to the lifetime of the processor. This is correct — the map lives and dies with the processor.

However, for long-running sessions (features that stay open for hours), this map grows monotonically. Each tool invocation adds an entry and nothing ever removes entries.

**Scale check:** A typical Claude session might invoke 200-500 tools. Each entry is ~100 bytes (UUID + tool name). At 500 entries, that's ~50KB — negligible.

**Verdict:** Not a real problem. No action needed.

### Issue #3: `updateToolStatus` store method has a subtle Zustand immutability violation

**Severity: Medium (would cause missed re-renders in production)**

The plan (lines 378-386) specifies:
```typescript
updateToolStatus: (nodeId: string, toolUseId: string, status: 'success' | 'error') => {
  const messages = get().buffers.get(nodeId);
  if (!messages) return;
  const msg = messages.find(m => m.toolUseId === toolUseId);
  if (msg) msg.status = status;
}
```

This **mutates the existing message object in-place** without calling `set()`. Zustand uses referential equality to detect changes. Since `set()` is never called, React components subscribed to this store will not re-render. The spinner will keep spinning even after the status changes to `'success'` — until the next unrelated state update triggers a re-render.

**Fix:** The method must create a new `Map`, find the message, create a new message object with the updated status, and call `set()`:

```typescript
updateToolStatus: (nodeId: string, toolUseId: string, status: 'success' | 'error') => {
  set((state) => {
    const existing = state.buffers.get(nodeId);
    if (!existing) return state;
    const newMessages = existing.map(m =>
      m.toolUseId === toolUseId ? { ...m, status } : m
    );
    const newBuffers = new Map(state.buffers);
    newBuffers.set(nodeId, newMessages);
    return { buffers: newBuffers };
  });
}
```

This follows the same immutable update pattern already used by `appendMessages` and `setMessages` in the current `useTerminal.ts`.

### Issue #4: No wire protocol for tool status updates from server to client

**Severity: Medium (architecture gap — requires new message type or piggyback design)**

The plan (lines 372-388) describes two options for updating tool status and says "Option 2 is cleaner" (store method). But it then says:

> "The server broadcasts a new message type for status updates, or piggybacks on the `tool_result` message with the `toolUseId` so the client can correlate."

This is vague. The actual wire protocol needs to be specified. Currently:

1. `TerminalMessage` in `shared/types.ts` lacks `toolUseId` and `status` fields.
2. `terminal_data` messages carry `TerminalMessage[]` — there's no separate status update message type.
3. The `useWebSocket` hook only handles `terminal_data` and `terminal_replay`.

**The cleanest approach** (piggyback) is:
- Add `toolUseId` and `status` to `TerminalMessage` type (plan already specifies this)
- When emitting `tool_result`, include the corresponding `toolUseId`
- Client-side `appendMessages` checks incoming messages: if a message has `toolUseId` AND the buffer already contains a `tool_use` message with that `toolUseId`, update the existing message's `status`

This means `appendMessages` in both `useTerminal.ts` (client) and `state.ts` (server) need the correlation logic, not a separate `updateToolStatus` method. This keeps the wire protocol simple (no new message type) and keeps the store update atomic with the append.

**Why this matters:** Without a concrete protocol decision, the implementer will either:
- Build `updateToolStatus` (plan's option 2) and then realize there's no way to trigger it from `useWebSocket`
- Invent a new `ServerMessage` type at implementation time, causing type drift

### Issue #5: `handleAssistant` dead code for `tool_result` will cause confusion

**Severity: Low**

The plan (line 219) correctly says "Remove the dead `tool_result` handling from `handleAssistant()`." But the current code at `message-processor.ts:162-177` is substantial (16 lines including PR URL scanning). When implementing `handleUser()`, an implementer might not realize this code needs to be deleted, leading to duplicate handling if `user` messages do arrive.

The plan is clear on this. Just flagging that the PR URL scanning logic in the dead code (`extractPRUrls`) needs to be preserved in whatever replaces it.

### Issue #6: `handleResultSuccess` check for `'success'` subtype is fragile

**Severity: Low**

Current code (`message-processor.ts:341`):
```typescript
if ('subtype' in msg && msg.subtype === 'success') {
```

The SDK types show:
- `SDKResultSuccess` has `subtype: 'success'`
- `SDKResultError` has `subtype: 'error_during_execution' | 'error_max_turns' | ...`

The current check works but is inverted from the safer pattern. Since `result` type messages are always `SDKResultSuccess | SDKResultError`, the code should either:
- Check `msg.is_error === true` (both types have this field)
- Or use a type guard

Not a plan issue per se — the plan doesn't touch this code. Just noting it for implementation.

### Issue #7: Server-side `appendTerminalMessages` doesn't handle status updates either

**Severity: Impl-note (follows from Issue #4)**

`server/state.ts` `appendTerminalMessages()` currently only merges consecutive `assistant_text` messages. If the piggyback approach from Issue #4 is adopted, this function also needs the `toolUseId` correlation logic to keep the server-side buffer consistent. Otherwise:
- Server buffer has `tool_use` with `status: 'running'` forever
- `terminal_replay` (sent on subscribe) replays stale status
- Client sees spinners on tools that completed hours ago

---

## Protocol/Type Contract Summary

| Layer | Current State | Plan Specifies | Gap |
|-------|--------------|----------------|-----|
| `TerminalMessage` type | Missing `toolUseId`, `status` | Has both | Types need updating |
| `terminal_data` wire format | Carries `TerminalMessage[]` | Same | OK once types updated |
| `terminal_replay` wire format | Carries `TerminalMessage[]` | Same | OK once types updated |
| Tool status updates | No mechanism | Vague (two options) | Needs concrete spec |
| `user` message handling | Not handled | `handleUser()` | SDK behavior unverified |
| `tool_result` in assistant | Dead code present | Specifies removal | Needs implementation |

---

## Summary

| # | Issue | Severity | Action |
|---|-------|----------|--------|
| 1 | `SDKUserMessage` may not be yielded by `query()` stream — `handleUser()` could be dead code | Must-fix | Verify empirically; add fallback using `tool_progress` events |
| 3 | `updateToolStatus` mutates in-place without `set()` — breaks Zustand reactivity | Medium | Use immutable update pattern in plan spec |
| 4 | No concrete wire protocol for tool status updates server->client | Medium | Specify piggyback approach in `appendMessages` |
| 7 | Server-side buffer doesn't update tool status on replay | Impl-note | Add correlation logic to `appendTerminalMessages` |
| 2 | `toolUseIdToName` map grows monotonically | Low | Negligible at expected scale |
| 5 | Dead `tool_result` code in `handleAssistant` has PR URL scanning | Low | Preserve when migrating |
| 6 | `result` subtype check could use `is_error` field | Low | Defensive improvement |

The most important finding is **Issue #1**: the plan assumes `SDKUserMessage` events flow through the `query()` async generator, but this needs empirical verification. If the SDK does not yield `'user'` messages, the entire tool result rendering pipeline is broken — no tool output will ever appear in the terminal, and all tool spinners will spin forever. The plan needs a verified answer and a fallback strategy before implementation proceeds.
