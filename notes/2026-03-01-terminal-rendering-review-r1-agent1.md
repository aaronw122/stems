# Terminal Rendering Review — R1 Agent 1 (Frontend Rendering Specialist)

**Scope:** Plan `plans/claude-terminal-theming.md` (rev 3), focused on frontend rendering correctness.
**Files reviewed:** `TerminalMessageRenderer.tsx`, `TerminalPeek.tsx`, `useTerminal.ts`, `shared/types.ts`, `server/message-processor.ts`, `src/themes/themes.ts`, `src/themes/types.ts`, `src/styles/flow.css`, `notes/claude-code-terminal-rendering-reference.md`

---

## Findings

### [Must-fix] tool_use renders as static green bullet regardless of execution state

**Location:** Step 3 (Terminal Message Renderer), plan table row for `tool_use`; current `TerminalMessageRenderer.tsx` lines 82-98

**Issue:** The plan specifies `tool_use` always renders a green `●` bullet. But the reference document clearly describes a three-state lifecycle: **spinner (running) -> green bullet (success) / red bullet (error)**. Currently tool_use always gets a green `●`, and tool_result gets its own separate bullet. This produces incorrect visual output compared to Claude Code, where the same tool line transitions from spinner to colored bullet. The result is that a tool invocation always looks "completed successfully" the instant it appears, even before the result is known.

This is architectural: the `TerminalMessageType` system emits `tool_use` and `tool_result` as separate sequential messages, which means there is no way to show a spinner on the `tool_use` line and then replace it with a success/error bullet when the result arrives. Claude Code's model is a single tool-call widget with state transitions; Stems' model is an append-only message stream. Fixing this later would require either:
1. A stateful renderer that correlates `tool_use` and `tool_result` by `toolName`/index and updates the bullet, or
2. Adding an `isComplete` / `status` field to `tool_use` messages and mutating them in the store when results arrive.

Neither is trivial, and the decision affects the store shape and the renderer architecture.

**Suggested fix:** Add a `status?: 'running' | 'success' | 'error'` field to `TerminalMessage` for `tool_use` type messages. When the message processor emits a `tool_use`, set `status: 'running'`. When the corresponding `tool_result` arrives, update the existing `tool_use` message's status in the Zustand store rather than only appending a new `tool_result` message. Render a CSS-animated spinner when `status === 'running'`, green `●` for `success`, red `●` for `error`. This matches the reference and avoids the visual incorrectness of always showing green.

---

### [Must-fix] tool_use text field contains tool name instead of input summary — mismatches reference format

**Location:** Step 1 mapping `assistant (tool_use) -> { type: 'tool_use', text: name, toolName: name }`; `message-processor.ts` line 190

**Issue:** The plan maps `tool_use` as `{ type: 'tool_use', text: name, toolName: name }` — the `text` field is the tool name itself. But the reference document shows the format as `ToolName(key input summary)`:

```
● Read(server/message-processor.ts)
● Bash(gh pr create --base main ...)
● Grep(createMessageProcessor)
```

The current renderer shows `toolName` then `text` side by side (lines 87-95 of the renderer), which would display `Read Read` since both are set to `name`. The `text` field should contain the parenthesized input summary (file path, command, search pattern, etc.), not the tool name again.

This is structural because it affects the message processor's extraction logic — it needs to extract a meaningful input summary from each tool's `input` object, which varies per tool type (Bash has `command`, Read has `file_path`, Grep has `pattern`, etc.).

**Suggested fix:** Update the message processor mapping to:
```typescript
{ type: 'tool_use', text: extractInputSummary(name, input), toolName: name }
```
Where `extractInputSummary` formats input per tool type (e.g., for Bash: the command string, for Read: the file path, for Grep: the pattern). The renderer then correctly shows `● ToolName(summary text)` as the reference describes. The plan needs to specify this extraction logic since it changes the data contract.

---

### [Medium] tool_result connector character missing — should use `└` not a separate bulleted line

**Location:** Step 3 renderer table, `tool_result` row; current `TerminalMessageRenderer.tsx` lines 100-111

**Issue:** The reference document shows tool results indented with a `└` tree connector:
```
● Read(file.ts)
  └ 385 lines
```

The current renderer shows tool_result as a separate indented line with its own colored bullet (`●`). This doubles up the bullet visual (one for tool_use, one for tool_result) and misses the `└` connector that creates the visual tree hierarchy. The result looks like two independent items rather than a parent-child tool call/result relationship.

**Suggested fix:** Change the tool_result renderer to use the `└` connector character instead of a bullet:
```tsx
<div className="my-0.5 flex items-start gap-1.5 pl-4">
  <span style={{ color: 'var(--term-text-dim)' }}>└</span>
  <span style={{ color: 'var(--term-text-dim)' }}>{message.text}</span>
</div>
```
This is implementation-level but affects the visual correctness enough to note as medium since it changes the perceived hierarchy of the output.

---

### [Impl-note] Markdown regex processing order causes incorrect rendering for bold-within-inline-code

**Location:** Current `TerminalMessageRenderer.tsx` `markdownToHtml()` lines 8-44

**Issue:** The regex processing order is: HTML escape -> fenced code blocks -> inline code -> bold -> italic -> headings -> lists. The problem is that bold markers inside inline code will be incorrectly processed. For example:

Input: `` `**not bold**` ``

After step 3 (inline code): `<code ...>**not bold**</code>`
After step 4 (bold): `<code ...><strong>not bold</strong></code>`

The bold regex matches content inside `<code>` tags. Similarly, italic processing can corrupt content inside code or bold spans.

**Suggested fix:** After converting code blocks and inline code, replace their contents with placeholders, run the remaining transforms, then restore. Or use a single-pass parser that tracks context. Standard approach for minimal markdown renderers.

---

### [Impl-note] Fenced code blocks rendered as inline `<code>` — no block-level styling

**Location:** `TerminalMessageRenderer.tsx` line 18-20; reference document "Code Blocks" section

**Issue:** The regex for fenced code blocks (```` ```lang\n...\n``` ````) wraps the result in the same `<code>` element with the same inline styles as inline code. This produces visually identical output for single-word inline code and multi-line code blocks. The reference document specifies code blocks should have box-drawing borders and language tags. The plan's Step 3 table doesn't mention code block rendering at all.

The reference document's "Stems equivalent" for code blocks suggests: `border: 1px solid var(--term-text-dim); background: rgba(255,255,255,0.05); border-radius: 4px; padding: 8px`.

**Suggested fix:** Use a `<pre><code>` block with distinct styling for fenced code blocks — border, padding, background, and display as a block element. Strip and display the language tag in a small header. This is an implementation detail but noting it since the current output is visually wrong for multi-line code.

---

### [Impl-note] Empty message text produces empty DOM elements

**Location:** All message type cases in `TerminalMessageRenderer.tsx`

**Issue:** If `message.text` is an empty string (which can happen with streaming deltas or malformed SDK events), the renderer produces empty `<div>` elements that take up space due to margins/padding. The `tool_use` case is worst — it renders an orphaned green bullet with no text. The `user_message` and `human_needed` cases render an empty colored box.

**Suggested fix:** Add an early return for empty text in relevant cases:
```tsx
if (!message.text && message.type !== 'tool_use') return null;
```
For `tool_use`, show the toolName even if text is empty (since toolName is the primary content).

---

### [Impl-note] Markdown inline code background hardcoded to light theme value

**Location:** `TerminalMessageRenderer.tsx` lines 19 and 24

**Issue:** Inline code and fenced code blocks use `background:rgba(255,255,255,0.08)` — a hardcoded white-based transparency. On light themes (white background), this is invisible. The plan states "All colors via CSS custom properties — no hardcoded values" (Step 3), but the markdown renderer violates this.

**Suggested fix:** Use a CSS custom property for code background, e.g., `var(--term-input-bg)` which already adapts per theme (dark: `rgba(255,255,255,0.05)`, light: `rgba(0,0,0,0.05)`). Or add a dedicated `--term-code-bg` token.

---

### [Impl-note] `dangerouslySetInnerHTML` used for assistant_text without sanitization

**Location:** `TerminalMessageRenderer.tsx` lines 77-79

**Issue:** The `markdownToHtml` function does escape `<`, `>`, and `&` at the start, which prevents basic XSS from Claude's text output. However, the function then reintroduces HTML tags (strong, em, code) by string concatenation. If Claude's text contains something like `**<img src=x onerror=alert(1)>**`, the HTML entities for `<` and `>` get escaped first, so the bold wrapping is safe. The current escaping order is actually correct for basic safety, but the approach is fragile — any future regex change that processes content before escaping could introduce vulnerabilities.

**Suggested fix:** This is acceptable for a localhost-only tool where all input comes from Claude, but worth a code comment noting the escaping-first invariant.

---

### [Impl-note] CSS classes defined in flow.css but not used by the renderer

**Location:** `flow.css` lines 117-159 (`.term-msg-user`, `.term-msg-tool`, etc.); `TerminalMessageRenderer.tsx`

**Issue:** The CSS file defines message-type classes (`.term-msg-user`, `.term-msg-tool`, `.term-msg-human-needed`, `.term-msg-system`, `.term-msg-error`) but the renderer uses inline `style` props with CSS variables instead of these classes. The CSS classes are dead code. This isn't a bug, but it creates confusion about which styling approach is canonical.

**Suggested fix:** Either migrate the renderer to use the CSS classes (cleaner separation of concerns) or remove the dead CSS classes. If keeping inline styles, delete the unused classes from `flow.css`.

---

### [Impl-note] Messages inside `<pre>` can break layout when renderer uses `<div>` children

**Location:** `TerminalPeek.tsx` lines 215-224

**Issue:** The `<pre>` tag wrapping all messages has `whitespace-pre-wrap` and `break-words`. Inside it, each `TerminalMessageRenderer` returns `<div>` elements. Placing `<div>` elements inside `<pre>` is technically valid HTML5, but `<pre>` applies `white-space: pre` by default (overridden here to `pre-wrap`). The `<div>` elements create block-level breaks while the `<pre>` is preserving whitespace, which means:
- Extra whitespace in message text is preserved (intended for terminal output)
- But `<div>` margins from Tailwind classes (e.g., `my-1`, `my-0.5`) interact with the pre's whitespace preservation in potentially unexpected ways

The visual result may have inconsistent spacing between message types.

**Suggested fix:** Consider whether the `<pre>` wrapper is still needed now that individual messages handle their own formatting. A plain `<div>` container with `font-family: monospace` would give more predictable layout control per message type. The `whitespace-pre-wrap` can be applied per-message where needed (e.g., assistant_text, tool_result) rather than globally.

---

### [Impl-note] `useTerminal` merges only the boundary between existing and incoming assistant_text

**Location:** `useTerminal.ts` lines 26-37

**Issue:** The merge logic in `appendMessages` concatenates adjacent `assistant_text` messages only at the boundary between the existing buffer tail and the incoming batch head. If the incoming batch itself contains multiple consecutive `assistant_text` messages, they remain separate entries. This means a batch like `[{type: 'assistant_text', text: 'Hello'}, {type: 'assistant_text', text: ' world'}]` stays as two messages if the buffer was empty, but gets merged into one if the buffer already had an `assistant_text` at the end.

In practice the SDK sends one delta per `stream_event`, so batches of multiple `assistant_text` are unlikely. But if they occur, the renderer would create two separate `<div>` elements with separate `dangerouslySetInnerHTML` calls, which could split markdown across elements (e.g., `**bold` in one div and `text**` in the next — the bold regex would fail to match across them).

**Suggested fix:** After the boundary merge, also merge consecutive `assistant_text` messages within the incoming batch. Or document the assumption that batches contain at most one `assistant_text`.

---

### [Impl-note] Title bar text color hardcoded, won't adapt to light themes

**Location:** `TerminalPeek.tsx` line 202

**Issue:** The title bar text uses `text-[#4a4a4a]` (Tailwind hardcoded color), and the titlebar background is hardcoded in `flow.css` as a gray gradient. These won't change with the theme. Since the titlebar is "window chrome" and designed to look like macOS, this may be intentional — the plan says "Keep title bar, traffic lights, resize handle styles (these are window chrome, not terminal content)." However, a dark macOS-style titlebar on a light terminal theme, or vice versa, may look jarring.

**Suggested fix:** Intentional design decision — no action needed, but worth validating visually with light themes to confirm the contrast works.

---

### [Impl-note] `--term-btn-text` uses the main text color, which may produce low-contrast buttons

**Location:** `themes.ts` line 151: `'--term-btn-text': src.text`

**Issue:** The Send button uses `--term-btn-bg: claude` (an orange/brown) and `--term-btn-text: text` (white in dark, black in light). Dark theme: white text on orange-brown — adequate contrast. Light theme: black text on orange-brown — could be low contrast. The dark daltonized theme uses `claude: rgb(255,153,51)` with white text — this is a bright orange with white text, which may fail WCAG AA contrast ratios.

**Suggested fix:** Consider using a dedicated button text color (always white or always dark) rather than inheriting the general text color. This is a visual polish item.

---

### [Impl-note] Heading colors in markdown renderer don't use theme CSS variables

**Location:** Reference document "Headings" section; `TerminalMessageRenderer.tsx` line 37

**Issue:** The reference document specifies H1 and H2 headings should be `chalk.bold.blue()` / `chalk.bold.underline.blue()`. The current renderer applies `font-size` scaling but no color — headings render in the default `--term-text` color. This deviates from the reference but is a minor visual difference.

**Suggested fix:** Add a heading color. Could use `color: var(--term-tool-success)` or add a dedicated `--term-heading-color` mapped to blue. Low priority since the size differentiation already provides visual hierarchy.

---

### [Impl-note] No rendering for tool_result `isSuccess` field in context of Bash tool error output

**Location:** `shared/types.ts` line 16 (`isSuccess?: boolean`); message-processor.ts tool_result handling

**Issue:** The `isSuccess` field exists on `TerminalMessage` and the `tool_result` renderer uses it for bullet color (lines 101-103). But the message processor never sets `isSuccess` — it's always `undefined`. The SDK's `tool_result` content blocks don't have an explicit success/failure field; error information comes from the `result` message type, not from individual tool results. This means `tool_result` bullets will always be green (since `message.isSuccess === false` is never true when `isSuccess` is `undefined`).

**Suggested fix:** Either parse the tool_result content for error indicators (exit codes, error messages) and set `isSuccess: false`, or remove the field if it can't be reliably populated from the SDK data. The current behavior silently defaults to "success" for every tool result.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| Must-fix | 2 | Static green bullet (no running/error state), tool_use text duplicates toolName |
| Medium | 1 | Missing `└` connector for tool_result |
| Impl-note | 10 | Markdown regex order, code block styling, empty text, hardcoded code bg, dangerouslySetInnerHTML note, dead CSS classes, pre/div layout, merge boundary, titlebar colors, button contrast, heading colors, isSuccess never set |

The two must-fix items affect the data model (`TerminalMessage` shape and the message processor's extraction logic). Discovering these during implementation would require reworking the store mutation pattern and the server-side formatting, which touches the protocol boundary between server and client.
