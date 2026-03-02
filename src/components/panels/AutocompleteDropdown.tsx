import { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { AutocompleteItem } from '../../../shared/types.ts';

export interface AutocompleteDropdownProps {
  items: AutocompleteItem[];
  selectedIndex: number;
  triggerType: '@' | '/' | null;
  isOpen: boolean;
  onItemClick: (index: number) => void;
  onItemHover: (index: number) => void;
  activeDescendantId: string | null;
  listboxId: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

interface DropdownPosition {
  left: number;
  bottom: number;
  width: number;
}

function useTextareaPosition(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  isOpen: boolean,
): DropdownPosition | null {
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  const recalculate = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setPosition(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setPosition({
      left: rect.left,
      bottom: window.innerHeight - rect.top,
      width: rect.width,
    });
  }, [textareaRef]);

  // Recalculate on every render when open (handles textarea auto-resize)
  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return;
    }
    recalculate();
  }, [isOpen, recalculate]);

  // ResizeObserver to catch textarea height changes from auto-resize
  useEffect(() => {
    if (!isOpen) return;
    const el = textareaRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      recalculate();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, textareaRef, recalculate]);

  // Recalculate on window resize/scroll
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('resize', recalculate);
    window.addEventListener('scroll', recalculate, true);
    return () => {
      window.removeEventListener('resize', recalculate);
      window.removeEventListener('scroll', recalculate, true);
    };
  }, [isOpen, recalculate]);

  return position;
}

export function AutocompleteDropdown({
  items,
  selectedIndex,
  triggerType,
  isOpen,
  onItemClick,
  onItemHover,
  listboxId,
  textareaRef,
}: AutocompleteDropdownProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const position = useTextareaPosition(textareaRef, isOpen);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen || items.length === 0 || !position) return null;

  const dropdown = (
    <div
      className="autocomplete-dropdown"
      style={{
        position: 'fixed',
        left: position.left,
        bottom: position.bottom + 4, // 4px gap above the textarea
        width: position.width,
        zIndex: 9999,
        backgroundColor: 'var(--term-bg)',
        border: '1px solid var(--term-input-border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <ul
        ref={listRef}
        role="listbox"
        id={listboxId}
        style={{
          margin: 0,
          padding: '4px 0',
          listStyle: 'none',
          maxHeight: 240,
          overflowY: 'auto',
        }}
      >
        {items.map((item, index) => (
          <li
            key={`${item.insertText}-${index}`}
            id={`${listboxId}-option-${index}`}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => onItemClick(index)}
            onPointerEnter={() => onItemHover(index)}
            className="autocomplete-item"
            style={{
              padding: '4px 10px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: '20px',
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              backgroundColor: index === selectedIndex ? 'var(--term-user-bg)' : undefined,
            }}
          >
            {triggerType === '@' ? (
              <FileItem item={item} />
            ) : (
              <CommandItem item={item} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );

  return createPortal(dropdown, document.body);
}

function FileItem({ item }: { item: AutocompleteItem }) {
  return (
    <>
      <span style={{ color: 'var(--term-tool-success)', flexShrink: 0 }}>+</span>
      <span style={{ color: 'var(--term-text)' }}>{item.label}</span>
    </>
  );
}

function CommandItem({ item }: { item: AutocompleteItem }) {
  return (
    <>
      <span style={{ color: 'var(--term-text)', flexShrink: 0 }}>/{item.label}</span>
      {item.detail && (
        <span
          style={{
            color: 'var(--term-text-dim)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.detail}
        </span>
      )}
    </>
  );
}
