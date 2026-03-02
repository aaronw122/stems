import { useState, useRef, useCallback, useId } from 'react';

// ── Types ────────────────────────────────────────────────────────────

export interface AutocompleteItem {
  label: string;
  detail?: string;
  insertText: string;
}

interface TriggerState {
  type: '@' | '/';
  /** Index of the trigger character in the input string */
  triggerIndex: number;
  /** Query text between trigger and cursor */
  query: string;
}

interface FileCacheEntry {
  items: AutocompleteItem[];
  repoPath: string;
  timestamp: number;
}

export interface UseAutocompleteReturn {
  items: AutocompleteItem[];
  selectedIndex: number;
  triggerType: '@' | '/' | null;
  isOpen: boolean;
  ghostText: string | null;
  onInputChange: (value: string, cursorPosition: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => boolean;
  accept: () => { newValue: string; newCursorPosition: number } | null;
  dismiss: () => void;
  onItemClick: (index: number) => void;
  onItemHover: (index: number) => void;
  activeDescendantId: string | null;
  listboxId: string;
}

// ── Constants ────────────────────────────────────────────────────────

const FILE_CACHE_TTL = 30_000; // 30 seconds
const DEBOUNCE_MS = 150;

// ── Module-level caches (shared across hook instances) ───────────────

/** File results cached per repoPath with TTL */
const fileCacheByRepo = new Map<string, FileCacheEntry>();

/** Slash commands cached per nodeId for session lifetime */
const commandCacheByNode = new Map<string, AutocompleteItem[]>();

// ── Trigger detection ────────────────────────────────────────────────

function detectTrigger(value: string, cursorPos: number): TriggerState | null {
  if (cursorPos <= 0 || value.length === 0) return null;

  // Find the start of the current line: scan backward from cursor to
  // the nearest \n or start-of-string
  let lineStart = 0;
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (value[i] === '\n') {
      lineStart = i + 1;
      break;
    }
  }

  // Check for `/` trigger: must be first char on current line
  if (value[lineStart] === '/') {
    const query = value.slice(lineStart + 1, cursorPos);
    // Dismiss if query contains a space
    if (query.includes(' ')) return null;
    return { type: '/', triggerIndex: lineStart, query };
  }

  // Check for `@` trigger: scan backward from cursor toward lineStart
  for (let i = cursorPos - 1; i >= lineStart; i--) {
    if (value[i] === '@') {
      const query = value.slice(i + 1, cursorPos);
      // Dismiss if query contains a space
      if (query.includes(' ')) return null;
      return { type: '@', triggerIndex: i, query };
    }
  }

  return null;
}

// ── Acceptance logic (shared by accept, onItemClick, onKeyDown) ──────

function computeAcceptance(
  trigger: TriggerState,
  item: AutocompleteItem,
  inputValue: string,
): { newValue: string; newCursorPosition: number } {
  if (trigger.type === '/') {
    // Replace entire input with the command's insertText
    return {
      newValue: item.insertText,
      newCursorPosition: item.insertText.length,
    };
  }

  // `@` trigger: replace @query with the file path at trigger position
  const before = inputValue.slice(0, trigger.triggerIndex);
  const after = inputValue.slice(trigger.triggerIndex + 1 + trigger.query.length);
  const newValue = before + item.insertText + after;
  return {
    newValue,
    newCursorPosition: before.length + item.insertText.length,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useAutocomplete(nodeId: string): UseAutocompleteReturn {
  const [items, setItems] = useState<AutocompleteItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [triggerType, setTriggerType] = useState<'@' | '/' | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Refs for stable access in callbacks without waiting for re-renders.
  // selectedIndexRef mirrors the selectedIndex state so that accept()
  // can read the current value synchronously (React batches state updates).
  const triggerRef = useRef<TriggerState | null>(null);
  const selectedIndexRef = useRef(-1);
  const itemsRef = useRef<AutocompleteItem[]>([]);
  const isOpenRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const valueRef = useRef('');

  // Keep refs in sync with state
  const updateSelectedIndex = useCallback((index: number) => {
    selectedIndexRef.current = index;
    setSelectedIndex(index);
  }, []);

  const updateItems = useCallback((newItems: AutocompleteItem[]) => {
    itemsRef.current = newItems;
    setItems(newItems);
  }, []);

  const updateIsOpen = useCallback((open: boolean) => {
    isOpenRef.current = open;
    setIsOpen(open);
  }, []);

  // Stable listbox ID for ARIA
  const reactId = useId();
  const listboxId = `autocomplete-listbox${reactId}`;

  // ── Helpers ──────────────────────────────────────────────────────

  const resetState = useCallback(() => {
    triggerRef.current = null;
    updateItems([]);
    updateSelectedIndex(-1);
    setTriggerType(null);
    updateIsOpen(false);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
      fetchControllerRef.current = null;
    }
  }, [updateItems, updateSelectedIndex, updateIsOpen]);

  // ── File fetching (debounced, cached) ─────────────────────────

  const fetchFiles = useCallback(
    (query: string) => {
      // Cancel any in-flight request
      if (fetchControllerRef.current) {
        fetchControllerRef.current.abort();
      }

      const controller = new AbortController();
      fetchControllerRef.current = controller;

      fetch(`/api/files/${nodeId}?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ files: string[]; repoPath: string }>;
        })
        .then(({ files, repoPath }) => {
          // Cache the raw results keyed by repoPath
          fileCacheByRepo.set(repoPath, {
            items: files.map((f) => ({
              label: f.split('/').pop() || f,
              detail: f,
              insertText: f,
            })),
            repoPath,
            timestamp: Date.now(),
          });

          // Only update if the @ trigger is still active
          if (triggerRef.current?.type !== '@') return;

          const currentQuery = triggerRef.current.query.toLowerCase();
          const filtered = files
            .filter((f) => f.toLowerCase().includes(currentQuery))
            .map((f) => ({
              label: f.split('/').pop() || f,
              detail: f,
              insertText: f,
            }));

          updateItems(filtered);
          updateSelectedIndex(-1);
          updateIsOpen(filtered.length > 0);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          console.error('[useAutocomplete] file fetch error:', err);
        });
    },
    [nodeId, updateItems, updateSelectedIndex, updateIsOpen],
  );

  const debouncedFetchFiles = useCallback(
    (query: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        fetchFiles(query);
      }, DEBOUNCE_MS);
    },
    [fetchFiles],
  );

  // Try to filter from cache first; returns true if a fresh cache entry exists
  const filterFilesFromCache = useCallback(
    (query: string): boolean => {
      const lowerQuery = query.toLowerCase();

      for (const entry of fileCacheByRepo.values()) {
        if (Date.now() - entry.timestamp > FILE_CACHE_TTL) continue;

        const filtered = entry.items
          .filter((item) => item.insertText.toLowerCase().includes(lowerQuery))
          .slice(0, 100);

        updateItems(filtered);
        updateSelectedIndex(-1);
        updateIsOpen(filtered.length > 0);
        return true;
      }

      return false;
    },
    [updateItems, updateSelectedIndex, updateIsOpen],
  );

  // ── Command fetching (cached for session lifetime) ────────────

  const fetchCommands = useCallback(
    (query: string) => {
      const cached = commandCacheByNode.get(nodeId);
      if (cached) {
        const lowerQuery = query.toLowerCase();
        const filtered = cached.filter((item) =>
          item.label.toLowerCase().startsWith(lowerQuery),
        );
        updateItems(filtered);
        updateSelectedIndex(-1);
        updateIsOpen(filtered.length > 0);
        return;
      }

      fetch(`/api/commands/${nodeId}`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{
            commands: Array<{ name: string; description: string }>;
            source: 'session' | 'fallback';
          }>;
        })
        .then(({ commands, source }) => {
          const allItems: AutocompleteItem[] = commands.map((cmd) => ({
            label: cmd.name,
            detail: cmd.description,
            insertText: `/${cmd.name} `,
          }));

          // Only cache session commands (re-fetch fallback after session init)
          if (source === 'session') {
            commandCacheByNode.set(nodeId, allItems);
          }

          // Only update if the / trigger is still active
          if (triggerRef.current?.type !== '/') return;

          const lowerQuery = triggerRef.current.query.toLowerCase();
          const filtered = allItems.filter((item) =>
            item.label.toLowerCase().startsWith(lowerQuery),
          );

          updateItems(filtered);
          updateSelectedIndex(-1);
          updateIsOpen(filtered.length > 0);
        })
        .catch((err) => {
          console.error('[useAutocomplete] command fetch error:', err);
        });
    },
    [nodeId, updateItems, updateSelectedIndex, updateIsOpen],
  );

  // ── Input change handler ──────────────────────────────────────

  const onInputChange = useCallback(
    (value: string, cursorPosition: number) => {
      valueRef.current = value;

      const trigger = detectTrigger(value, cursorPosition);

      if (!trigger) {
        if (triggerRef.current) resetState();
        return;
      }

      triggerRef.current = trigger;
      setTriggerType(trigger.type);

      if (trigger.type === '@') {
        // Show cached results immediately, but always debounce a fresh fetch
        filterFilesFromCache(trigger.query);
        debouncedFetchFiles(trigger.query);
      } else {
        fetchCommands(trigger.query);
      }
    },
    [resetState, filterFilesFromCache, debouncedFetchFiles, fetchCommands],
  );

  // ── Accept selection ──────────────────────────────────────────

  const accept = useCallback((): { newValue: string; newCursorPosition: number } | null => {
    const trigger = triggerRef.current;
    const currentItems = itemsRef.current;
    if (!trigger || currentItems.length === 0) return null;

    // If selectedIndex is -1, accept the first item
    const idx = selectedIndexRef.current >= 0 ? selectedIndexRef.current : 0;
    const item = currentItems[idx];
    if (!item) return null;

    const result = computeAcceptance(trigger, item, valueRef.current);
    resetState();
    return result;
  }, [resetState]);

  // ── Dismiss ───────────────────────────────────────────────────

  const dismiss = useCallback(() => {
    resetState();
  }, [resetState]);

  // ── Item click (sets index in ref so accept() can read it) ─────

  const onItemClick = useCallback(
    (index: number): void => {
      // Update selectedIndex ref synchronously so that a subsequent
      // accept() call (in the same synchronous tick) picks up the
      // correct item. The TerminalPeek integration calls:
      //   autocomplete.onItemClick(index);
      //   const result = autocomplete.accept();
      updateSelectedIndex(index);
    },
    [updateSelectedIndex],
  );

  // ── Item hover ────────────────────────────────────────────────

  const onItemHover = useCallback(
    (index: number) => {
      updateSelectedIndex(index);
    },
    [updateSelectedIndex],
  );

  // ── Keyboard handler ──────────────────────────────────────────

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpenRef.current) return false;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          e.stopPropagation();
          const len = itemsRef.current.length;
          if (len === 0) return true;
          const next = selectedIndexRef.current < len - 1
            ? selectedIndexRef.current + 1
            : 0;
          updateSelectedIndex(next);
          return true;
        }

        case 'ArrowUp': {
          e.preventDefault();
          e.stopPropagation();
          const len = itemsRef.current.length;
          if (len === 0) return true;
          const next = selectedIndexRef.current <= 0
            ? len - 1
            : selectedIndexRef.current - 1;
          updateSelectedIndex(next);
          return true;
        }

        case 'Tab': {
          // Shift+Tab always passes through
          if (e.shiftKey) return false;
          // Empty list — pass through
          if (itemsRef.current.length === 0) return false;
          // Accept selection (caller reads result via accept())
          e.preventDefault();
          e.stopPropagation();
          return true;
        }

        case 'Enter': {
          if (selectedIndexRef.current >= 0) {
            // Item highlighted — accept (caller reads result via accept())
            e.preventDefault();
            e.stopPropagation();
            return true;
          }
          // Nothing highlighted — dismiss, let Enter fall through
          dismiss();
          return false;
        }

        case 'Escape': {
          e.preventDefault();
          e.stopPropagation();
          dismiss();
          return true;
        }

        default:
          return false;
      }
    },
    [updateSelectedIndex, dismiss],
  );

  // ── ARIA ──────────────────────────────────────────────────────

  const activeDescendantId =
    isOpen && selectedIndex >= 0
      ? `${listboxId}-option-${selectedIndex}`
      : null;

  // ── Ghost text (single-match inline suggestion) ────────────

  let ghostText: string | null = null;
  const singleItem = items.length === 1 ? items[0] : undefined;
  if (singleItem && isOpen && triggerRef.current) {
    const trigger = triggerRef.current;
    if (trigger.type === '/') {
      // For `/` commands: insertText is `/${commandName} `, typed so far is `/${query}`
      const typed = '/' + trigger.query;
      const remaining = singleItem.insertText.slice(typed.length);
      ghostText = remaining.length > 0 ? remaining : null;
    } else {
      // For `@` files: only show ghost text for prefix matches
      if (singleItem.insertText.toLowerCase().startsWith(trigger.query.toLowerCase())) {
        const remaining = singleItem.insertText.slice(trigger.query.length);
        ghostText = remaining.length > 0 ? remaining : null;
      }
    }
  }

  return {
    items,
    selectedIndex,
    triggerType,
    isOpen,
    ghostText,
    onInputChange,
    onKeyDown,
    accept,
    dismiss,
    onItemClick,
    onItemHover,
    activeDescendantId,
    listboxId,
  };
}
