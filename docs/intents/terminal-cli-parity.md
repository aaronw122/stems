---
title: "Terminal CLI Parity"
author: "human:aaron"
version: 1
created: 2026-03-01
---

# Terminal CLI Parity

## WANT

Make the Stems terminal peek panel visually match the Claude Code CLI running in a macOS terminal. Every message type should look like its Claude CLI counterpart.

### Specific changes needed

1. **Tool results with tree connectors** — Replace the current green-dot bullet on tool_result with `└` tree connector, indented under the parent tool_use. Claude CLI shows results like:
   ```
   ● Bash(git status)
   └ On branch main
   └ nothing to commit
   ```

2. **Thinking/Pontificating indicator** — When the agent is processing (between messages, during thinking), show:
   ```
   ✱ Pontificating… (Xs · thinking)
   ```
   Red/orange asterisk, animated ellipsis, live elapsed time. This appears when the node is running but not actively streaming text or tool calls.

3. **Tool result summaries** — Match Claude CLI's summary style:
   - Read: `● Read(path/to/file.ts)` (already done)
   - Bash: `● Bash(command)` with results on `└` lines below (need tree connectors)
   - Edit/Update: `● Edit(path/to/file.ts)` with diff block below (already done)
   - WebSearch: `● Web Search("query")` → `└ Did 1 search in Xs`
   - WebFetch/Fetch: `● Fetch(url)` → `└ Received 1.9MB (200 OK)`

4. **Tool display names** — Some tools have different display names in Claude CLI:
   - `Edit` → `Update` in Claude CLI (shows as "Update(file.ts)")
   - `WebSearch` → `Web Search`
   - `WebFetch` → `Fetch`

## DON'T

- No keyboard shortcuts (ctrl+o expand etc.) — browser panel, not terminal
- No status bar (model name, context remaining) — already shown elsewhere in Stems
- Don't break existing functionality (diff rendering, markdown, user messages)

## LIKE

- Claude Code CLI running in Terminal.app on macOS (dark theme)
- Reference screenshots provided during interview

## FOR

- Stems terminal peek panel (React component in browser)
- Users who are familiar with Claude Code CLI and expect visual consistency

## ENSURE

- Visual side-by-side comparison by user (Aaron will eyeball it)
- All existing message types still render correctly
- Thinking indicator appears during processing gaps
- Tree connectors on all tool results

## TRUST

- [autonomous] All implementation decisions — colors, spacing, animation timing
- [autonomous] Commit and PR without checking back
- [autonomous] Display name mapping (Edit→Update, WebSearch→Web Search, etc.)
