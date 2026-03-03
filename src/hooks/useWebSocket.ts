import { useRef, useState, useEffect, useCallback } from 'react';
import type { ClientMessage, ServerMessage } from '../../shared/types.ts';
import { useTerminal } from './useTerminal.ts';
import { useGraph } from './useGraph.ts';

interface UseWebSocketReturn {
  send: (msg: ClientMessage) => void;
  isConnected: boolean;
}

export function useWebSocket(onMessage?: (msg: ServerMessage) => void): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const appendMessages = useTerminal((s) => s.appendMessages);
  const setMessages = useTerminal((s) => s.setMessages);
  const setQueue = useTerminal((s) => s.setQueue);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectDelayRef.current = 1000;

      // Re-subscribe to terminal for the currently selected node on reconnect
      const selectedNodeId = useGraph.getState().selectedNodeId;
      if (selectedNodeId) {
        ws.send(JSON.stringify({ type: 'subscribe_terminal', nodeId: selectedNodeId }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;

        // Route terminal messages to the terminal store (outside React Flow)
        if (msg.type === 'terminal_data') {
          appendMessages(msg.nodeId, msg.messages);
        } else if (msg.type === 'terminal_replay') {
          setMessages(msg.nodeId, msg.messages);
        } else if (msg.type === 'queue_update') {
          setQueue(msg.nodeId, msg.messages);
        }

        // Route all messages to the graph store / other handlers
        onMessageRef.current?.(msg);
      } catch {
        console.error('[ws] Failed to parse message:', event.data);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;

      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, 30000);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }, [appendMessages, setMessages, setQueue]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send, isConnected };
}
