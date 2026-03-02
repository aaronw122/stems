# Architect Review — Terminal Input Autocomplete Plan (Round 1)

## Critical Issues

None.

## Must-Fix Issues

### M1. Input element is a `<textarea>`, not `<input type="text">` — cursor API differs
**Section:** Context, Step 4, Step 6

The plan's Context section says "The mini terminal input is a plain `<input type="text">`." In reality, `TerminalPeek.tsx` uses a `<textarea>` (line 304). This matters because:

1. **`selectionStart` behavior in `<textarea>` with multi-line content:** The plan's trigger detection (Step 4) scans backward from `cursorPosition` for `@` or `/`. In a `<textarea>`, `selectionStart` is an offset into the full multi-line string value (including newlines), not a position within the current visual line. The `/` trigger requires "position 0" but the user could be on line 2 of the textarea where their cursor offset is 40, not 0. The plan needs to define `/` trigger as "position 0 of the current line" (scan backward from cursor to find the preceding newline or start-of-string) rather than "position 0" of the full value.

2. **The `onInputChange` signature assumes single-line semantics.** `onInputChange(value, cursorPosition)` is fine for a single-line input but the caller in Step 6 item 2 says `e.target.selectionStart` — this works for `<textarea>` too, so the wiring is correct, but the trigger detection logic must account for multi-line content.

**Suggested fix:** In Step 4 "Trigger detection," change the `/` rule from "position 0 only" to "first character on the current line (scan backward from cursor for `\n` or start-of-string)." Add a note in Step 6 that the input element is a `<textarea>`, not `<input>`.

### M2. `queryInstance` lifecycle conflict — storing it on Session while `consumeTurn` is iterating it
**Section:** Step 2

The plan says: "Store `queryInstance` reference on Session so `supportedCommands()` can be called (currently it's a local variable in `runTurn`)."

`queryInstance` is an `AsyncGenerator<SDKMessage, void>` that `consumeTurn` is actively iterating with `for await...of`. Storing it on the Session and then calling `supportedCommands()` concurrently is only safe if the SDK guarantees that `supportedCommands()` is a separate control-plane call that does not interfere with the active stream iteration. The SDK type definition on `Query` does list `supportedCommands()` as a control request alongside `interrupt()`, `setPermissionMode()`, etc., and the JSDoc says "control requests are only supported when streaming input/output is used" — so this is likely safe, but the plan should explicitly acknowledge this is a concurrent call on an actively-streaming generator and note the SDK documentation that makes it safe.

Additionally, the plan says to call `supportedCommands()` inside `consumeTurn` "after the init message is received." But if the REST endpoint `GET /api/commands/:nodeId` is called by the client before init fires, the session's `slashCommands` will be `null`. The plan does mention a hardcoded fallback for this case. However, the plan doesn't specify *when* to stop using the fallback and re-fetch from the session. If commands are fetched once and cached for session lifetime (Step 4), the client would permanently have the hardcoded fallback if the first fetch happens before init. The endpoint should return a `ready: boolean` flag or the client should retry if it gets the fallback.

**Suggested fix:** (1) Add a note that `supportedCommands()` is a concurrent control-plane call that's safe per SDK docs. (2) Add either a `source: 'session' | 'fallback'` field to the endpoint response so the client knows to refresh later, or specify that the client should invalidate the cache after the session init message arrives (which the client can detect from the WebSocket terminal stream).

### M3. Tab key event handling order — Tab trap fires before autocomplete gets the event
**Section:** Step 6

The `handleTabTrap` handler is on the root `<div>` container's `onKeyDown` (line 226 of TerminalPeek.tsx). The plan's Step 6 item 3 says to update `handleKeyDown` (which is on the `<textarea>`) to check `autocomplete.isOpen` and handle Tab. But Step 6 item 4 says "Update tab trap (`handleTabTrap`): skip when autocomplete is open."

The issue: `handleTabTrap` is on the *parent* `<div>`, and React synthetic events bubble from child to parent. So the `<textarea>`'s `onKeyDown` fires first, then the root's `onKeyDown`. This means if the `<textarea>`'s handler calls `e.preventDefault()` on Tab (for autocomplete accept), the root handler would still fire (preventDefault does not stop propagation). The plan needs to specify that the `<textarea>` handler must call `e.stopPropagation()` when consuming Tab for autocomplete, OR the `handleTabTrap` must check `autocomplete.isOpen` to bail early. Step 6 item 4 covers the latter, but only if `autocomplete.isOpen` is accessible in `handleTabTrap`'s closure — which requires either passing it as a dependency or restructuring the callback.

**Suggested fix:** Clarify that `handleTabTrap` should read `autocomplete.isOpen` (via ref or direct state) and return early when true. Since `handleTabTrap` is currently a `useCallback` with no dependencies, adding `autocomplete.isOpen` as a dependency is the clean approach. Alternatively, the `<textarea>` handler can call `e.stopPropagation()` when it consumes Tab, which prevents bubbling to the parent entirely.

## Medium Issues

### Med1. No abort/cleanup for in-flight file fetches on rapid input changes
**Section:** Step 4

The hook debounces file fetches at 150ms, but there's no mention of aborting the previous `fetch()` when the user types another character. If the user types `@src/comp` then quickly changes to `@src/hook`, two fetches fire and the first response could arrive after the second and overwrite results. Standard practice is to use `AbortController` per fetch or compare a request generation counter on response arrival.

### Med2. File listing endpoint doesn't handle missing or non-git repos
**Section:** Step 1

The plan uses `git ls-files --cached --others --exclude-standard`. If the `repoPath` is valid but not a git repository (e.g., the user added a non-git folder), this command will fail. The plan doesn't specify error handling for this case — it should fall back gracefully (return empty array or use `find` as a fallback) rather than returning a 500.

### Med3. Dropdown positioned "above the input" may clip at the top of the terminal window
**Section:** Step 5, Step 6

The plan says "dropdown appears above the input area" and Step 6 says "render `<AutocompleteDropdown>` above the input." With a max height of 240px, the dropdown could extend above the terminal window's top edge, especially if the terminal is small or positioned near the top of the viewport. The plan should mention either clamping the dropdown height to available space or flipping to below the input when space is insufficient.

### Med4. `AutocompleteItem` type defined in shared types but only used client-side
**Section:** Step 3

The `AutocompleteItem` type is proposed for `shared/types.ts`, but neither REST endpoint returns `AutocompleteItem[]` — the file endpoint returns `{ files: string[], repoPath: string }` and the commands endpoint returns `SlashCommand[]`. The transformation to `AutocompleteItem` happens in the client hook. This type should live in the client-side hook file or a client-side types file, not in the shared types. Putting it in shared types implies the server returns it, which creates a misleading contract.

## Low Issues

### L1. `git ls-files --max-count` flag doesn't exist
**Section:** Risks, item 1

The Risks section mentions "Could add `--max-count` flag if needed" for large repos. `git ls-files` does not support `--max-count`. The mitigation for large repos would need to pipe through `head -n 100` or similar, or handle truncation in the application layer (which the plan already does with the 100-result cap after filtering).

### L2. Verification step 10 tests for behavior not specified in the plan
**Section:** Verification

"Verify dropdown doesn't appear for `@` in middle of word without space before it" — the plan's trigger detection in Step 4 says "`@` anywhere in input" triggers the dropdown. There's no mention of requiring a space before `@`. This verification step implies a behavior the plan doesn't define. Either add the "preceded by space or start-of-string" rule to Step 4, or remove this verification step.

### L3. Implementation order diagram shows Step 5 can parallel with Step 4, but Step 5 renders items from Step 4's hook
**Section:** Implementation Order

The diagram says Step 5 (AutocompleteDropdown) "Can parallel with Step 4." In practice, the dropdown component's props are the hook's return values (`items`, `selectedIndex`, `triggerType`). You can write both in parallel if you agree on the interface first, but the diagram doesn't call this out — it implies true independence. Minor, but could confuse an implementer.

## Impl-Notes

- **Debounce tuning (150ms):** May need adjustment based on perceived responsiveness. Start with 150ms and tune if it feels sluggish.
- **Cache TTL (30s for file results):** Reasonable starting point. If repos have frequent file churn during active sessions, may need a manual invalidation trigger.
- **`scrollIntoView({ block: 'nearest' })` behavior:** Works well in most cases but can cause jitter if the dropdown container has complex overflow. Test with both short and long file lists.
- **Cursor position after React re-render:** The plan correctly identifies this risk (Risk 4) and proposes `requestAnimationFrame`. May also need `useEffect` with a ref to set cursor position after the controlled input re-renders. This is a well-known React controlled input issue.
- **Race condition between `supportedCommands()` call and session teardown:** If the session is killed while `supportedCommands()` is in-flight, the promise may reject. Handle with try/catch in `consumeTurn`.
- **`git ls-files --cached --others --exclude-standard` may return duplicates:** Files that are both cached (tracked) and modified could appear. Use `--deduplicate` flag if available in the target git version, or deduplicate in application code.
- **Keyboard navigation wrapping:** The plan says "wrapping at boundaries" for ArrowUp/Down. Standard behavior — just ensure the wrap is circular (index -1 wraps to last, last+1 wraps to 0).
- **Escape key bubbling:** When the autocomplete is open and the user presses Escape, the handler calls `e.preventDefault()` but should also consider whether Escape should bubble to close the terminal window. Currently there's no Escape-to-close behavior on the terminal, so this is fine for now.

## Summary

The plan is well-structured with clear separation of concerns (server endpoints, shared types, client hook, presentation component, wiring). The core architecture is sound: REST endpoints for file/command data, a stateful hook for trigger detection and keyboard navigation, and a pure presentation dropdown. The three must-fix issues are: (1) the input is a `<textarea>` not an `<input>`, which affects `/` trigger detection for multi-line content; (2) the `queryInstance` storage and cache invalidation strategy for slash commands needs clarification; and (3) the Tab key event propagation between the textarea handler and the parent tab-trap handler needs explicit ordering. All three are fixable with clarifications to the plan text rather than architectural redesign.
