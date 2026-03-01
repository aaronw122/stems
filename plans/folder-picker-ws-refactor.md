# Plan: Refactor Folder Picker from HTTP to WebSocket

## Context

The `/api/pick-folder` endpoint spawns a native macOS `osascript` dialog that blocks until the user picks a folder (or cancels). Bun.serve's default 10s idle timeout kills the connection before most users can browse. We bumped `idleTimeout` to 120s as a band-aid, but the real fix is to use the existing WebSocket channel — which has no idle timeout and already handles all other client↔server communication.

## Current Flow

```
App.tsx handleAddRepo()
  → fetch('/api/pick-folder')           ← HTTP, blocks, subject to timeout
  → server spawns osascript, awaits
  → HTTP response: { path } or { cancelled }
  → ws.send({ type: 'add_repo', path }) ← already uses WS for the second half
```

## New Flow

```
App.tsx handleAddRepo()
  → ws.send({ type: 'pick_folder' })
  → server spawns osascript, awaits
  → ws.send({ type: 'folder_picked', path }) back to requesting client only
  → App.tsx onMessage handler receives folder_picked → dispatches add_repo
```

Single round-trip over WS. No HTTP timeout. The response targets only the requesting client (not broadcast), since `handleWsMessage` already receives the specific `ws` socket.

## Changes

### 1. `shared/types.ts` — Add message types

Add to `ClientMessage`:
```typescript
| { type: 'pick_folder' }
```

Add to `ServerMessage`:
```typescript
| { type: 'folder_picked'; path: string }
| { type: 'folder_pick_cancelled' }
```

### 2. `server/index.ts` — Move handler from HTTP to WS

**Add** `pick_folder` case to `handleWsMessage()`:
- Spawn osascript (same logic as current HTTP handler)
- On success: `ws.send(JSON.stringify({ type: 'folder_picked', path }))`
- On cancel/error: `ws.send(JSON.stringify({ type: 'folder_pick_cancelled' }))`
- Note: sends to the specific `ws` client, not `broadcast()`

**Remove** the `/api/pick-folder` HTTP route entirely.

**Revert** the `idleTimeout: 120` back to default (no longer needed — the only long-blocking endpoint was the folder picker).

### 3. `src/App.tsx` — Replace fetch with WS message

**Replace** `handleAddRepo()`:
- Instead of `fetch('/api/pick-folder')`, call `send({ type: 'pick_folder' })`
- Move the `add_repo` dispatch into the WS message handler (on `folder_picked`)

**Add** handler for `folder_picked` in the `onMessage` callback:
- `case 'folder_picked': send({ type: 'add_repo', path: msg.path })`

**Add** handler for `folder_pick_cancelled`:
- No-op (or optional: show brief "Cancelled" status)

### 4. `src/hooks/useWebSocket.ts` — Route new message types

The `folder_picked` / `folder_pick_cancelled` messages will flow through the existing `onMessageRef.current?.(msg)` path into App.tsx's `onMessage` handler. No changes needed here unless we want to add explicit routing — which we don't, since the existing pattern handles it.

## Files

| File | Change |
|------|--------|
| `shared/types.ts` | Add 3 message types |
| `server/index.ts` | Move osascript handler to WS, remove HTTP route, revert idleTimeout |
| `src/App.tsx` | Replace fetch with WS send/receive |

## Verification

1. `bun run dev`
2. Click "Add Repo" → macOS folder picker should appear
3. Pick a folder → repo node should appear on canvas
4. Cancel the picker → nothing should happen (no error, no timeout)
5. Wait 30+ seconds before picking → should still work (no timeout)

## Follow-up (not in scope)

`/api/context/:nodeId` also blocks (spawns `claude -p` for summarization). Same pattern could apply, but it's less urgent since it's faster and less user-visible.
