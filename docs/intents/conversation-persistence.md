---
title: "Conversation Persistence"
author: "human:aaron"
version: 1
created: 2026-03-03
---

# Conversation Persistence

## WANT
Persist terminal conversation history (TerminalMessage[] buffers) to disk so that closing your laptop or restarting the server restores the full rendered terminal view for every node. If a session is still active after restore, new events continue appending seamlessly.

## DON'T
- No database — file-based only, consistent with existing `~/.stems/workspace.json` persistence
- No re-streaming/replay animation on restore — load the final state instantly
- Don't break the existing 500-message client-side trim limit
- Don't persist phantom (subagent) node conversations (they're already excluded from node persistence)

## LIKE
The feeling of closing your laptop and opening it back up with terminal sessions still there — seamless, invisible persistence. No ceremony.

## FOR
- Aaron's local development use
- Stems localhost GUI
- Existing stack: Bun server, Zustand client stores, file-based persistence at `~/.stems/`
- Data: `TerminalMessage[]` arrays keyed by nodeId

## ENSURE
- After server restart, clicking a node shows its full conversation history in TerminalPeek
- If a Claude CLI session is still running (or resumable) after restore, new messages append after the restored history
- Persistence uses the same debounced atomic-write pattern as existing workspace saves
- Restored messages render identically to live messages (same types, same formatting)
- No noticeable delay when loading a conversation (instant, not streamed)

## TRUST
- [autonomous] File format and storage location (alongside workspace.json, separate file, etc.)
- [autonomous] Serialization approach (when to write, how to batch)
- [autonomous] How to hook into the existing persistence pipeline
- [autonomous] Whether to store per-node files or a single combined file
- [autonomous] Implementation of the restore path using existing `terminal_replay` WebSocket message type
