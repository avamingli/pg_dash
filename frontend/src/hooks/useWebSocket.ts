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

  // Keep onMessage and url in refs so a reconnect always uses the latest
  // values without connect() having to depend on them — depending on
  // them would tear the socket down and re-open it on every render of
  // whichever component passed the callback.
  //
  // Updated in an effect rather than during render. Both are read only
  // from async callbacks (socket events, the reconnect timer), which
  // can't run before this commit's effects have flushed, and the effect
  // is declared ahead of the connecting one so the URL is current by the
  // time connect() runs. It also keeps the old URL visible to the
  // connect effect's *cleanup*, which needs it to decrement the refcount
  // of the socket it actually opened — a render-time write would have it
  // release the entry for the new URL instead.
  const onMessageRef = useRef(onMessage);
  const urlRef = useRef(url);
  useEffect(() => {
    onMessageRef.current = onMessage;
    urlRef.current = url;
  }, [onMessage, url]);

  // connect and scheduleReconnect call each other, so one of them has to
  // be referenced before it exists. Routing the back-edge through a ref
  // breaks the cycle: both stay stable ([] deps), and the reconnect timer
  // reads the current connect only when it actually fires — long after
  // mount, since nothing schedules a reconnect until a socket closes.
  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 1.5, 10_000);
    reconnectTimerRef.current = setTimeout(() => {
      connectRef.current();
    }, delay);
  }, []);

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
  }, [scheduleReconnect]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    // The one synchronous setState reachable from here is connect()'s
    // "the shared socket for this URL is already OPEN" branch — a socket
    // that will never fire onopen again, so its state has to be adopted
    // at subscribe time. That is the external-store case the rule's own
    // guidance carves out, and removing it properly means rewriting this
    // hook on useSyncExternalStore, not moving the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
