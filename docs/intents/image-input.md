---
title: "Image Input for Stems"
author: "human:aaron"
version: 1
created: 2026-03-03
---

# Image Input for Stems

## WANT
Add image attachment support to Stems agent sessions. Users should be able to send images alongside text messages to Claude sessions, enabling screenshot-based debugging, design mockup references, and general visual reasoning.

**Input methods:**
- Paste from clipboard (Cmd+V)
- Drag and drop from Finder
- File path reference (type or autocomplete a path like `/tmp/screenshot.png`)

**UX model:** Claude Code CLI style — images appear as compact chips (`[Image #1]`) above the text input. Arrow-up from the input navigates into the chip list; delete/backspace removes the selected chip. No inline image preview — just labeled chips.

**Multiple images per message** — users can attach several images before sending.

## DON'T
- Don't add artificial size or format limits beyond what Claude's API natively accepts
- Don't show inline image previews — chips only, matching CLI aesthetic
- Don't break the existing text-only input flow — images are additive

## LIKE
- Claude Code CLI image attachment UX (compact `[Image #N]` chips, arrow-up to select, delete to remove)

## FOR
- Aaron and other Stems users managing Claude agent sessions
- Desktop browser environment (Electron-like localhost app)
- Existing stack: React + TypeScript + Zustand + WebSocket + Bun server + Claude SDK

## ENSURE
- Paste an image (Cmd+V) → chip appears above input → send with text → Claude's response references the image content
- Drag a .png from Finder into TerminalPeek → chip appears → send → Claude sees it
- Type/autocomplete a file path to an image → chip appears → send → Claude sees it
- Multiple images can be attached to a single message
- Arrow-up from empty or beginning-of-input navigates to chip list; delete removes selected chip
- Images survive the message queue — if Claude is busy, queued messages retain their image attachments and Claude receives them when the turn starts
- Sending a message clears all chips (fresh state for next message)

## TRUST
- Encoding approach (base64 vs file path passthrough) [autonomous]
- WebSocket protocol changes (new payload fields, message format) [autonomous]
- Chip component styling and layout [autonomous]
- Server-side image handling and Claude SDK integration [autonomous]
- Overall UX feel and interaction patterns [ask] — present for review once built
