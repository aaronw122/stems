# Claude Terminal Theming Plan Review (Round 2) — Product/UX Perspective

**Reviewer:** Agent 3 (Product/UX)
**Date:** 2026-03-01
**Plan:** `plans/claude-terminal-theming.md` (revision 2)
**Round 1 review:** `notes/2026-03-01-claude-terminal-theming-review-r1-agent3.md`

---

## Summary

Revision 2 addressed several of the most actionable Round 1 findings well. The three strongest fixes: (1) the `permission` message type was added with proper AskUserQuestion detection and a distinct visual treatment, (2) the CSS variable-to-source-token fallback mapping table resolves the incomplete palette gap comprehensively, and (3) the first-boot picker was redesigned as a non-blocking dismissible overlay. The Agent SDK migration coordination is also now explicit and correct.

The remaining issues are primarily around scope boundaries the plan deliberately chose (canvas theming excluded, terminal chrome state indicators excluded) and a few smaller gaps introduced or uncovered by the revision.

---

## Round 1 Issue Tracker

### Fixed

| R1 # | Severity | Issue | Status |
|-------|----------|-------|--------|
| 3 | Must-fix | Incomplete palettes / no token-to-CSS mapping | **Fixed.** The new fallback mapping table (lines 161-191) resolves every CSS variable for every theme with explicit fallback chains. Well done — this was the highest-effort fix. |
| 4 | Medium | `terminal_replay` not updated in protocol change | **Fixed.** Replay is now explicitly included in the protocol change section (lines 120-122) and the files-affected list (lines 124-128). |
| 5 | Medium | First-boot picker blocks the entire app | **Fixed.** ThemeProvider now defaults to `'dark'` immediately, renders children always, and shows the picker as a dismissible modal overlay using a separate `stems-theme-chosen` flag (lines 197-204). |
| 7 | Medium | SDK migration file conflict (stream-parser.ts) | **Fixed.** Step 1 now explicitly targets `server/message-processor.ts` and states the SDK migration must land first (lines 78). The event mappings reference SDK `MessageEvent` types. |
| 8 | Medium | No `permission` message type | **Fixed.** Added to the `TerminalMessageType` union (line 100), mapped from `AskUserQuestion` tool_use (line 134), and given a distinct visual treatment in the renderer table (line 218) with dedicated CSS variables (`--term-permission-bg`, `--term-permission-text`, `--term-permission-border`). |

### Acknowledged / Deferred (acceptable)

| R1 # | Severity | Issue | Status |
|-------|----------|-------|--------|
| 1 | Must-fix | DAG canvas theming not included | **Not fixed, but acceptable.** The plan's scope is "terminal content theming" — this is a reasonable scope boundary. The intent spec's TRUST section says to "[ask] Architecture decisions that affect the DAG/node system." Canvas theming is a separate effort. However, see Finding 1 below — the plan should explicitly note this as a known visual inconsistency. |
| 2 | Must-fix | No state-aware terminal chrome | **Not fixed.** Same reasoning — this is outside the terminal content theming scope. But the gap is more acute in an orchestration UX. See Finding 2. |
| 6 | Medium | No contrast ratio validation | **Not fixed.** The plan uses Claude Code's own colors, so contrast parity with Claude Code is inherent. See Finding 3 for a remaining nuance. |

---

## New/Remaining Findings

### 1. [Medium] Plan should explicitly scope-out canvas theming and note the visual inconsistency

**Section:** Context / Implementation Order

The plan's scope is terminal content theming — that's fine. But revision 2 doesn't state this boundary explicitly, which means an implementer might wonder whether the DAG nodes, edges, and background should also pick up theme tokens. The light theme in particular will create a noticeable split: a dark canvas (`#0f0f0f` in `flow.css` line 6) with light-themed terminal windows floating on top.

**Why this is plan-level:** Without an explicit scope statement, the implementer either spends time scoping it themselves or accidentally starts theming canvas elements. A one-sentence note prevents both.

**Suggested fix:** Add a note in the Context section or Implementation Order: "This plan covers terminal content and window theming only. DAG canvas elements (node borders, edges, background, MiniMap) remain unchanged and will be addressed in a follow-up. Light and daltonized themes will produce a visual contrast between the dark canvas and themed terminal windows until canvas theming lands."

---

### 2. [Medium] No state-aware terminal chrome for multi-session triage

**Section:** Step 3, Step 4

This was R1 Finding 2 and remains unaddressed. In an orchestration tool where users have 3-4 TerminalPeek windows open simultaneously, there is no way to tell at a glance which sessions need attention. The terminal window itself communicates nothing about the session's state — you have to read the content or look back at the DAG node.

With the Agent SDK migration introducing richer lifecycle states, and the `permission` message type now creating a visually distinct in-content signal, there is an opportunity gap: the terminal *content* now shouts "I need attention" via the permission block styling, but the terminal *chrome* (title bar, border) stays inert. If a user has scrolled up in a terminal window, they will miss the permission prompt entirely.

**Why this is plan-level:** The TerminalPeek component and the theme token vocabulary are being redesigned in this plan. Adding state-aware title bar tinting later means re-touching both.

**Suggested fix:** Either (a) add 2-3 state-aware CSS variables (`--term-chrome-running`, `--term-chrome-attention`, `--term-chrome-completed`) and apply a subtle title bar or border tint based on the node's `humanNeededType`, or (b) explicitly defer this as a follow-up with a note: "Terminal chrome state indicators (title bar tint for needs-human, completed, crashed) are a follow-up — see [issue/doc]."

---

### 3. [Low] Background colors are hardcoded but not extracted from Claude Code

**Section:** Step 2 (CSS Variable table, line 167-168)

The fallback mapping table hardcodes `--term-bg` as `rgb(14,14,14)` for dark and `rgb(245,245,245)` for light. These values are marked as "hardcoded" rather than extracted from Claude Code's source. Claude Code's actual terminal background depends on the user's Terminal.app profile — Claude Code doesn't set the background itself. This means the plan's `--term-bg` values are a design choice, not a parity extraction.

This is fine as long as it's understood as a deliberate choice. The contrast implications are mitigated by the fact that all text colors were extracted from Claude Code against similar dark/light backgrounds.

**Suggested fix:** No action required — just noting that `--term-bg` is a Stems design decision, not a Claude Code extraction. If anyone questions why it doesn't exactly match their Claude Code setup, this is why.

---

### 4. [Low] `context-summary.ts` serialization approach may lose message type information

**Section:** Step 1 (line 90)

The plan says `server/context-summary.ts` should serialize `TerminalMessage[]` back to plain text via `messages.map(m => m.text).join('\n')`. This strips message types, which is correct for the summarization prompt (the LLM doesn't need type annotations). However, the current `context-summary.ts` (line 17) calls `getTerminalLines(parentNodeId, 100)` which returns `string[]` — after the migration this will return `TerminalMessage[]`, and the serialization in the prompt construction (line 27: `lines.join('\n')`) will produce `[object Object]\n[object Object]` unless the serialization step is actually implemented.

The plan correctly lists `context-summary.ts` as a modified file with the right approach. This is just a confirmation that the serialization must happen at the `getTerminalMessages()` call site in `context-summary.ts`, not somewhere else.

**Suggested fix:** None needed — the plan has this right. Flagging to ensure the implementer doesn't miss that `getTerminalLines()` → `getTerminalMessages()` changes the return type and the `join('\n')` on line 27 of context-summary.ts will break without the `.map(m => m.text)` step.

---

### 5. [Low] `dangerouslySetInnerHTML` retained for tool_result ANSI rendering

**Section:** Step 4 (line 232)

This was R1 Finding 9. The plan still says to "keep `ansi-to-html` dep for tool_result only," which means `dangerouslySetInnerHTML` stays for one message type while all others use safe React rendering. In an orchestration context where tool results can contain arbitrary file contents or command output from untrusted repos, this is a surface worth noting.

Since the plan's scope is theming (not security hardening), this is appropriately a Low. But it should be tracked as a known issue for a security pass.

**Suggested fix:** Add an impl-note or comment in the plan: "tool_result rendering via ansi-to-html + dangerouslySetInnerHTML is a known XSS surface. Consider replacing with ansi-to-react or adding DOMPurify sanitization in a follow-up."

---

### 6. [Impl-note] Theme switching post-first-boot still needs a UI entry point

R1 Finding 13 (Impl-note). The plan says ThemePicker is "reusable later as a settings panel" but doesn't define where the user re-accesses it. The revision didn't add this. This is fine for a v1 — users can clear `stems-theme` from localStorage to re-trigger the picker — but it means there's no discoverable way to switch themes after first boot. Worth tracking as a fast follow-up.

---

### 7. [Impl-note] Window chrome amber accents still present

R1 Finding 10 (Low). The plan still says "Keep title bar, traffic lights, resize handle styles." The resize handles in `flow.css` use amber accents (`rgba(255, 176, 0, *)`) and the floating window box-shadow has an amber tint. These will look out of place with non-amber themes. Not blocking, but undermines "visually identical to Claude Code" for anyone looking closely at the window chrome.

---

## Multi-Agent Orchestration UX Considerations

The plan is well-positioned for the Agent SDK migration:

1. **Event mapping alignment:** Step 1's event mappings now target SDK `MessageEvent` types (`content_block_delta`, `assistant.content[]`, etc.) rather than CLI stream-json types. This means the theming plan's server-side logic will work with `message-processor.ts` directly.

2. **Permission UX in multi-agent:** The `permission` message type with its visually distinct background/border treatment is the right call for orchestration UX. When users scan multiple terminals, the permission block will be the loudest visual signal. The missing piece is chrome-level signaling (Finding 2) — the permission block is great when you can see the terminal content, but useless if the terminal is scrolled up or minimized. The DAG node already shows `needs-human` state; the terminal chrome should echo it.

3. **Theme persistence across sessions:** localStorage-based persistence is correct for a single-user localhost tool. If Stems ever becomes multi-user or remote, this would need to move to a user preferences store, but that's far out of scope.

---

## Verdict

Revision 2 is solid and ready for implementation. The critical and must-fix issues from Round 1 are resolved. The remaining Medium findings (scope boundary documentation, state-aware chrome) are real gaps but can be tracked as follow-ups without blocking this plan. The plan's architecture — structured messages, CSS custom properties, fallback chains, non-blocking theme picker — is sound and extensible.

**Recommendation:** Approve with the suggestion to add a one-line scope boundary note (Finding 1) and track state-aware terminal chrome (Finding 2) as a follow-up issue.
