# React/Frontend Review — Terminal Input Autocomplete Plan (Round 1)

## Critical Issues

1. **Input element mismatch: plan assumes `<input type="text">` but code uses `<textarea>`**
   - **Section:** Context ("The mini terminal input is a plain `<input type="text">`"), Step 4 (`onInputChange(value, cursorPosition)`), Step 6 (wiring)
   - The actual TerminalPeek input (line 304 of `TerminalPeek.tsx`) is a `<textarea>` with auto-resize behavior (lines 307-313). This affects the entire trigger detection and cursor management design:
     - `selectionStart` on a `<textarea>` behaves differently with multi-line content — a `@` trigger followed by arrow-key navigation could conflict with textarea's native cursor movement between lines.
     - The plan's "scan backward from cursor position for `@`" needs to handle newlines. If the user types `@` on line 2, the backward scan must stop at the newline boundary (or clarify expected multi-line behavior).
     - The plan's cursor position restoration (`requestAnimationFrame` to set cursor after React paints, Risk #4) is correct for both inputs and textareas, but the complexity is higher with textareas because `selectionStart`/`selectionEnd` operate on the flat string index, not row/col.
   - **Suggested fix:** Update the plan's Context section to say `<textarea>`. In Step 4, specify that trigger detection scans backward from cursor but stops at newline boundaries (treating each line independently). This prevents `@` on a previous line from creating phantom triggers. Also verify that the `onChange` handler in Step 6 passes `e.target.selectionStart` correctly — with the auto-resize `onChange` handler already doing `el.style.height` mutations, the `selectionStart` read needs to happen before DOM mutations or it may return stale values.

2. **`supportedCommands()` is a method on the `Query` instance, not available after the init message — plan conflates two approaches**
   - **Section:** Step 2 ("In `consumeTurn`, after the `init` message is received, call `queryInstance.supportedCommands()` and store result on the session")
   - The plan says to both (a) store `queryInstance` reference on Session and (b) call `supportedCommands()` after init. However, in the current architecture, `queryInstance` is a local variable in `runTurn` (line 100 of `session.ts`), and `consumeTurn` receives it as a parameter. The plan correctly identifies this but proposes storing `queryInstance` on Session. The problem: `queryInstance` is an `AsyncGenerator` — it is consumed during the `for await` loop in `consumeTurn`. Calling `supportedCommands()` mid-iteration is a control request that may work if the SDK supports it, but the plan doesn't verify this. More importantly, between turns `queryInstance` from a previous turn is exhausted. The `SDKControlInitializeResponse` (from `initializationResult()`) already contains a `commands` field — this is likely the simpler, more reliable approach.
   - **Suggested fix:** Use `queryInstance.initializationResult()` (available on the Query interface per SDK types, line 1297 of `sdk.d.ts`) which returns `SDKControlInitializeResponse` containing `commands: SlashCommand[]`. Call this once after session init rather than `supportedCommands()`. This avoids the question of whether control requests work mid-stream. Update the plan to store the result of `initializationResult()` rather than persisting the `queryInstance` reference.

## Must-Fix Issues

1. **Tab key conflict between autocomplete acceptance and textarea's default behavior needs explicit specification**
   - **Section:** Step 6 point 4, Risk #3
   - The plan mentions updating `handleTabTrap` to skip when autocomplete is open, and Risk #3 acknowledges the conflict. But there are actually three Tab behaviors that need to coexist: (a) autocomplete accept, (b) focus trap cycling, and (c) textarea's native tab insertion (currently not happening because there's no explicit tab-insert handler, but it's worth noting). The plan should specify the priority chain explicitly: autocomplete open? -> accept. Otherwise -> focus trap. This is mentioned in pieces across Step 6 and Risks but should be consolidated into a single, clear precedence specification in Step 6.
   - **Suggested fix:** Add a clear precedence list in Step 6: "Tab priority: (1) if `autocomplete.isOpen` -> accept selection, (2) otherwise -> focus trap cycle. `e.preventDefault()` at each level."

2. **`onKeyDown` handler event consumption model has an ambiguity**
   - **Section:** Step 4 ("Keyboard navigation: `onKeyDown(e)` returns `true` if event was consumed (ArrowUp, ArrowDown)"), Step 6 point 3
   - The plan says `onKeyDown(e)` returns a boolean, but Step 6 says "If autocomplete is open -> pass to `autocomplete.onKeyDown(e)` for ArrowUp/Down." The hook's `onKeyDown` receives the full `React.KeyboardEvent` — if it returns `true`, the caller should `e.preventDefault()`. But the plan doesn't specify who calls `preventDefault()`: the hook or the caller? If the hook does it, there's no need for the boolean return. If the caller does it, the boolean is needed. The current `handleKeyDown` in TerminalPeek (lines 131-139) calls `e.preventDefault()` in the caller for Enter. The plan should be consistent.
   - **Suggested fix:** Specify that the hook calls `e.preventDefault()` internally for consumed keys (ArrowUp, ArrowDown, Tab, Escape) and returns the boolean only so the outer handler knows to skip its own logic (e.g., don't process Enter if autocomplete consumed it). This matches React patterns where the closest handler prevents default.

3. **Escape key conflict between autocomplete dismiss and floating window gesture cancel**
   - **Section:** Step 6 point 3
   - The `useFloatingWindow` hook registers a *window-level* keydown listener (capture phase, line 293 of `useFloatingWindow.ts`) that intercepts Escape to cancel drag/resize gestures. If the user presses Escape while autocomplete is open, both handlers will fire. The window listener fires first (capture phase) and calls `e.stopPropagation()` (line 282), which would prevent the React event from reaching the textarea's `onKeyDown`. However, the window listener only acts when `gestureRef.current` is non-null, so in practice both won't fire simultaneously (you can't be mid-drag and typing). Still, the plan should note that autocomplete's Escape handler must also `e.stopPropagation()` to prevent the event from bubbling to the root `onKeyDown={handleTabTrap}` on the terminal window.
   - **Suggested fix:** Add a note in Step 6 that the autocomplete Escape handler should `e.stopPropagation()` to prevent unintended side effects.

4. **Dropdown position: "above the input" requires measuring input position relative to viewport/window bounds**
   - **Section:** Step 5, Step 6 point 5
   - The plan says "dropdown appears above the input area" and Step 6 says "Wrap input area in `position: relative` container and render `<AutocompleteDropdown>` above the input." But TerminalPeek is a floating window that can be positioned anywhere on screen — if the terminal window is near the top of the viewport, the dropdown would overflow above the visible area. The plan doesn't mention any flip logic (show below if not enough room above).
   - **Suggested fix:** Add a note that the dropdown should default to above but flip to below if there's insufficient vertical space above the input within the terminal window's scroll area. Given the terminal window already has `overflow: hidden` at the root level, the dropdown may get clipped. Consider rendering the dropdown with a max height and letting it overflow the terminal window bounds via a portal or by ensuring the parent container allows overflow in that direction.

## Medium Issues

1. **The `useAutocomplete` hook needs `nodeId` but the plan doesn't show how the hook gets it** — Step 4 defines the interface but doesn't include `nodeId` in the hook's parameters. Step 6 says `useAutocomplete(nodeId)` which clarifies intent, but the hook's function signature should be shown in Step 4 (e.g., `function useAutocomplete(nodeId: string): UseAutocompleteReturn`).

2. **File caching strategy (30s TTL per repoPath) may cause stale results after file creation/deletion** — The plan caches file lists for 30s. In an active development session where Claude is creating files, the autocomplete will show stale results. Consider noting that this is acceptable for v1 or suggesting a cache-bust mechanism (e.g., invalidate on terminal messages containing file operations).

3. **The `AutocompleteItem` type in `shared/types.ts` is used only by the frontend** — Shared types are for client-server contracts. Since the server returns raw file lists (`{ files: string[], repoPath: string }`) and the hook transforms them into `AutocompleteItem` objects, this type belongs in the hook file or a local types file, not in `shared/types.ts`.

4. **The plan's Files Summary says `shared/types.ts` is a "New file" but it already exists** — The table says "New files (3)" and lists `shared/types.ts` as one of them. It should be listed under "Modified files" since it already exists and contains all the terminal/node types.

## Low Issues

1. **Verification step 10 ("Verify dropdown doesn't appear for `@` in middle of word without space before it") is not reflected in the trigger detection spec** — Step 4's trigger detection says "`@` anywhere in input" but the verification expects word-boundary awareness. Either update the trigger detection spec to require a space/start-of-input before `@`, or update the verification step.

2. **No loading state specified for the file list fetch** — When typing `@` for the first time in a large repo, there will be a network delay before results appear. The plan doesn't specify whether to show a loading indicator, an empty dropdown, or nothing until results arrive.

3. **CSS additions in Step 7 use raw class names rather than the existing CSS variable pattern** — The existing codebase uses CSS custom properties (`var(--term-*)`) extensively. The `.autocomplete-item:hover` rule uses `var(--term-user-bg)` which is consistent, but adding a box-shadow with hardcoded `rgba(0,0,0,0.3)` breaks the pattern. Consider using `var(--term-shadow)` which already exists in flow.css (line 69).

## Impl-Notes

**Cursor position management:**
- Risk #4's `requestAnimationFrame` approach for cursor restoration is correct but needs careful implementation — the `onChange` handler in TerminalPeek already mutates `el.style.height` which triggers reflow. The cursor position read (`e.target.selectionStart`) should be captured before any DOM mutations in the onChange handler.
- After Tab-accept inserts text, the new cursor position must account for the length difference between the trigger+query and the inserted text.

**Debounce implementation:**
- The 150ms debounce for `@` triggers should use a cleanup-capable pattern (return cleanup from useEffect or use a ref-based timeout). Avoid creating a new debounce function on every render.

**Keyboard event handling edge cases:**
- ArrowUp/ArrowDown in a `<textarea>` move the cursor between lines. When autocomplete is open, these must be fully consumed (`e.preventDefault()`) to prevent the textarea cursor from moving.
- If the user holds ArrowDown and the autocomplete closes (wraps past last item or items filter to empty), the textarea will suddenly start receiving arrow events mid-keypress.

**Cache key design:**
- The plan says "File results cached per `repoPath` with 30s TTL." If a user has multiple nodes in the same repo, they'll share the cache, which is efficient. But if the query parameter changes, the cache needs to be keyed by `repoPath + query`, not just `repoPath`. Alternatively, fetch the full list once and filter client-side (but this conflicts with the 100-result server cap for large repos).

**`supportedCommands()` vs `initializationResult()` timing:**
- Whether using `supportedCommands()` or `initializationResult()`, the call is async and the session may receive user input before the commands are available. The fallback hardcoded list handles this, but the transition from fallback to real commands should be seamless (no flash of different results).

**Accessibility:**
- The dropdown should have `role="listbox"` and items should have `role="option"` with `aria-selected` for screen readers.
- The input should have `aria-expanded`, `aria-activedescendant`, and `aria-controls` attributes when the dropdown is open.

**Textarea auto-resize interaction:**
- Inserting a long file path via Tab-accept may change the textarea height. The auto-resize logic in the current `onChange` handler needs to fire after the programmatic value update from autocomplete accept (not just from user-typed onChange events).

## Summary

The plan is well-structured and covers the key architectural decisions — the server/client split, the hook-based state machine, and the integration points are all sound. The two critical issues require plan-level fixes: the textarea vs input mismatch affects trigger detection and cursor management design, and the `supportedCommands()` approach needs to be reconciled with how the SDK Query interface actually works (prefer `initializationResult()` which is simpler and already returns commands). The must-fix items around key event precedence and dropdown positioning are important to specify now to avoid rework during implementation. Overall, this is a solid plan that needs targeted corrections before implementation begins.
