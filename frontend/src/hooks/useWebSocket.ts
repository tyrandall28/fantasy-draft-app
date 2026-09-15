import { useCallback, useEffect, useRef, useState } from "react";

interface UseWebSocketOptions {
  /** Base URL without the token param — token is appended dynamically */
  url: string;
  onMessage: (data: any) => void;
  /** Async function that returns a valid access token (refreshing if needed) */
  getToken: () => Promise<string | null>;
  enabled?: boolean;
}

export function useWebSocket({ url, onMessage, getToken, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimeout = useRef<number | undefined>(undefined);
  const reconnectDelay = useRef(1000);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const mountedRef = useRef(true);

  const connect = useCallback(async () => {
    if (!enabled) return;

    // Get a fresh token before each connection attempt
    const token = await getToken();
    if (!token || !mountedRef.current) return;

    const fullUrl = `${url}?token=${token}`;
    const ws = new WebSocket(fullUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current(data);
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      if (!mountedRef.current) return;
      // Exponential backoff reconnect
      reconnectTimeout.current = window.setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url, enabled, getToken]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, send };
}
