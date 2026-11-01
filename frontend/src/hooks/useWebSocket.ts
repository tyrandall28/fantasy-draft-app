import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

interface UseWebSocketOptions {
  /** Base URL without the token param — token is appended dynamically */
  url: string;
  /** Called with each parsed JSON message; validating its shape is the caller's job. */
  onMessage: (data: unknown) => void;
  /** Async function that returns a valid access token (refreshing if needed) */
  getToken: () => Promise<string | null>;
  enabled?: boolean;
}

export function useWebSocket({ url, onMessage, getToken, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  // Always the latest handler, without reconnecting when its identity changes.
  const handleMessage = useEffectEvent((data: unknown) => onMessage(data));

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let reconnectTimeout: number | undefined;
    let reconnectDelay = 1000;

    const connect = async () => {
      // Get a fresh token before each connection attempt
      const token = await getToken();
      if (!token || !active) return;

      const ws = new WebSocket(`${url}?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay = 1000;
      };

      ws.onmessage = (event) => {
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          console.warn("Ignoring a draft socket message that isn't JSON:", event.data);
          return;
        }
        handleMessage(data);
      };

      ws.onclose = () => {
        setConnected(false);
        if (!active) return;
        // Exponential backoff reconnect
        reconnectTimeout = window.setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          connect();
        }, reconnectDelay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();
    return () => {
      active = false;
      window.clearTimeout(reconnectTimeout);
      wsRef.current?.close();
    };
  }, [url, enabled, getToken]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, send };
}
