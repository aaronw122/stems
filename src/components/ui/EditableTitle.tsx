import { useState, useCallback, useRef, useEffect } from 'react';

interface EditableTitleProps {
  title: string;
  nodeId: string;
  onUpdateTitle: (nodeId: string, title: string) => void;
  className?: string;
}

export function EditableTitle({ title, nodeId, onUpdateTitle, className = '' }: EditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Keep editValue in sync with title when not editing
  useEffect(() => {
    if (!isEditing) {
      setEditValue(title);
    }
  }, [title, isEditing]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      onUpdateTitle(nodeId, trimmed);
    } else {
      setEditValue(title);
    }
    setIsEditing(false);
  }, [editValue, title, nodeId, onUpdateTitle]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        setEditValue(title);
        setIsEditing(false);
      }
    },
    [handleSubmit, title],
  );

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={`bg-zinc-700 border border-zinc-500 rounded px-1 py-0 outline-none focus:border-blue-500 ${className}`}
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={`truncate flex-1 cursor-default ${className}`}
      title="Double-click to edit"
    >
      {title}
    </div>
  );
}
