import { useCallback, useRef, useEffect } from 'react';
import { useGraph } from './useGraph.ts';
import type { TerminalRect } from './useGraph.ts';

// ── Constants ───────────────────────────────────────────────────────

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const TITLE_BAR_HEIGHT = 36;
const RESIZE_HANDLE_SIZE = 8;

// ── Types ───────────────────────────────────────────────────────────

type ResizeEdge =
  | 'n' | 's' | 'e' | 'w'
  | 'nw' | 'ne' | 'sw' | 'se';

interface DragState {
  type: 'drag';
  startX: number;
  startY: number;
  startRect: TerminalRect;
}

interface ResizeState {
  type: 'resize';
  edge: ResizeEdge;
  startX: number;
  startY: number;
  startRect: TerminalRect;
}

type GestureState = DragState | ResizeState | null;

// ── Helpers ─────────────────────────────────────────────────────────

function centerRect(container: HTMLElement): TerminalRect {
  const { clientWidth: cw, clientHeight: ch } = container;
  return {
    x: Math.round((cw - DEFAULT_WIDTH) / 2),
    y: Math.round((ch - DEFAULT_HEIGHT) / 2),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
}

function clampRect(rect: TerminalRect, container: HTMLElement): TerminalRect {
  const { clientWidth: cw, clientHeight: ch } = container;
  let { x, y, width, height } = rect;

  // Enforce minimum size
  width = Math.max(width, MIN_WIDTH);
  height = Math.max(height, MIN_HEIGHT);

  // Keep title bar visible: at least TITLE_BAR_HEIGHT from top edge,
  // and at least 40px of the window width visible horizontally
  const minVisibleX = 40;
  x = Math.max(x, -(width - minVisibleX));
  x = Math.min(x, cw - minVisibleX);
  y = Math.max(y, 0);
  y = Math.min(y, ch - TITLE_BAR_HEIGHT);

  return { x, y, width, height };
}

function computeResizedRect(
  edge: ResizeEdge,
  dx: number,
  dy: number,
  startRect: TerminalRect,
): TerminalRect {
  let { x, y, width, height } = startRect;

  // North edges: move top, shrink height
  if (edge.includes('n')) {
    const newHeight = height - dy;
    if (newHeight >= MIN_HEIGHT) {
      y = y + dy;
      height = newHeight;
    } else {
      y = y + (height - MIN_HEIGHT);
      height = MIN_HEIGHT;
    }
  }

  // South edges: grow height
  if (edge.includes('s')) {
    height = Math.max(height + dy, MIN_HEIGHT);
  }

  // West edges: move left, shrink width
  if (edge.includes('w')) {
    const newWidth = width - dx;
    if (newWidth >= MIN_WIDTH) {
      x = x + dx;
      width = newWidth;
    } else {
      x = x + (width - MIN_WIDTH);
      width = MIN_WIDTH;
    }
  }

  // East edges: grow width
  if (edge.includes('e')) {
    width = Math.max(width + dx, MIN_WIDTH);
  }

  return { x, y, width, height };
}

// ── Hook ────────────────────────────────────────────────────────────

export function useFloatingWindow(containerRef: React.RefObject<HTMLElement | null>) {
  const gestureRef = useRef<GestureState>(null);
  const rectBeforeGesture = useRef<TerminalRect | null>(null);

  const terminalRect = useGraph((s) => s.terminalRect);
  const setTerminalRect = useGraph((s) => s.setTerminalRect);

  // Initialize rect on first open (when terminalRect is null)
  const getRect = useCallback((): TerminalRect => {
    if (terminalRect) return terminalRect;
    const container = containerRef.current;
    if (!container) return { x: 100, y: 100, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    const rect = centerRect(container);
    setTerminalRect(rect);
    return rect;
  }, [terminalRect, containerRef, setTerminalRect]);

  // Whether a gesture is currently active
  const isGestureActive = useCallback(() => gestureRef.current !== null, []);

  // ── Drag by title bar ───────────────────────────────────────────

  const onTitleBarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only primary button
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = getRect();
      rectBeforeGesture.current = { ...rect };
      gestureRef.current = {
        type: 'drag',
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...rect },
      };

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getRect],
  );

  const onTitleBarPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.type !== 'drag') return;
      e.preventDefault();
      e.stopPropagation();

      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      const container = containerRef.current;
      if (!container) return;

      const newRect: TerminalRect = {
        ...gesture.startRect,
        x: gesture.startRect.x + dx,
        y: gesture.startRect.y + dy,
      };

      setTerminalRect(clampRect(newRect, container));
    },
    [containerRef, setTerminalRect],
  );

  const onTitleBarPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!gestureRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      gestureRef.current = null;
      rectBeforeGesture.current = null;
    },
    [],
  );

  // ── Resize by edge/corner ───────────────────────────────────────

  const onResizePointerDown = useCallback(
    (edge: ResizeEdge, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = getRect();
      rectBeforeGesture.current = { ...rect };
      gestureRef.current = {
        type: 'resize',
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...rect },
      };

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getRect],
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.type !== 'resize') return;
      e.preventDefault();
      e.stopPropagation();

      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      const container = containerRef.current;
      if (!container) return;

      const newRect = computeResizedRect(gesture.edge, dx, dy, gesture.startRect);
      setTerminalRect(clampRect(newRect, container));
    },
    [containerRef, setTerminalRect],
  );

  const onResizePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!gestureRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      gestureRef.current = null;
      rectBeforeGesture.current = null;
    },
    [],
  );

  // ── Escape to cancel gesture ────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && gestureRef.current) {
        e.preventDefault();
        e.stopPropagation();
        // Restore position before gesture
        if (rectBeforeGesture.current) {
          setTerminalRect(rectBeforeGesture.current);
        }
        gestureRef.current = null;
        rectBeforeGesture.current = null;
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [setTerminalRect]);

  return {
    rect: getRect(),
    isGestureActive,
    onTitleBarPointerDown,
    onTitleBarPointerMove,
    onTitleBarPointerUp,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerUp,
    RESIZE_HANDLE_SIZE,
  };
}
