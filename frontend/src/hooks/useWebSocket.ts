import { useEffect, useRef, useState, useCallback } from 'react';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (data: unknown) => void;
}

// Shared WebSocket instances keyed by URL.
// This survives React StrictMode's mount→cleanup→remount cycle.
const sharedSockets = new Map<string, { ws: WebSocket; refCount: number }>();

export function useWebSocket({ url, onMessage }: UseWebSocketOptions) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const mountedRef = useRef(true);

  // Keep onMessage in a ref so reconnection always uses the latest callback.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Store url in a ref so connect/reconnect always use the latest value.
  const urlRef = useRef(url);
  urlRef.current = url;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const currentUrl = urlRef.current;

    // Check if there's already a shared socket for this URL
    const existing = sharedSockets.get(currentUrl);
    if (existing && existing.ws.readyState <= WebSocket.OPEN) {
      // Reuse the existing socket
      existing.refCount++;
      wsRef.current = existing.ws;
      if (existing.ws.readyState === WebSocket.OPEN) {
        setConnected(true);
      }
      // Re-attach event handlers
      existing.ws.onopen = () => {
        reconnectDelayRef.current = 1000;
        if (mountedRef.current) setConnected(true);
      };
      existing.ws.onclose = () => {
        if (mountedRef.current) setConnected(false);
        wsRef.current = null;
        sharedSockets.delete(currentUrl);
        scheduleReconnect();
      };
      existing.ws.onerror = () => {};
      existing.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current?.(data);
        } catch {
          // ignore non-JSON messages
        }
      };
      return;
    }

    const ws = new WebSocket(currentUrl);
    wsRef.current = ws;
    sharedSockets.set(currentUrl, { ws, refCount: 1 });

    ws.onopen = () => {
      reconnectDelayRef.current = 1000;
      if (mountedRef.current) setConnected(true);
    };

    ws.onclose = () => {
      if (mountedRef.current) setConnected(false);
      wsRef.current = null;
      sharedSockets.delete(currentUrl);
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onerror is always followed by onclose, which handles reconnection.
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current?.(data);
      } catch {
        // ignore non-JSON messages
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 1.5, 10_000);
    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      // Only close the socket if this is the last consumer
      const currentUrl = urlRef.current;
      const entry = sharedSockets.get(currentUrl);
      if (entry) {
        entry.refCount--;
        if (entry.refCount <= 0) {
          // True unmount — no one else is using this socket
          entry.ws.onclose = null;
          entry.ws.close();
          sharedSockets.delete(currentUrl);
        }
      }

      wsRef.current = null;
      setConnected(false);
    };
  }, [url, connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, send };
}
