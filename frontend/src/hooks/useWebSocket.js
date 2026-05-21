import { useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook for managing WebSocket connections
 * Automatically connects to the server and handles reconnection
 */
export const useWebSocket = (path, onMessage, dependencies = []) => {
  const socketRef = useRef(null);
  const isConnectingRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const onMessageRef = useRef(onMessage);

  // Keep the latest callback without re-triggering the connection
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const connect = useCallback(() => {
    // Prevent double connections - accurately check WebSocket native readyState
    if (isConnectingRef.current || socketRef.current?.readyState === WebSocket.OPEN) return;

    isConnectingRef.current = true;
    manualDisconnectRef.current = false;
    const rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const apiUrl = typeof window !== 'undefined'
      ? rawApiUrl.replace('http://backend:8000', 'http://localhost:8000')
      : rawApiUrl;
    
    try {
      const wsProtocol = apiUrl.startsWith('https') ? 'wss' : 'ws';
      const wsUrl = `${wsProtocol}://${apiUrl.split('://')[1]}${path}`;
      
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log(`✅ WebSocket connected to ${path}`);
        isConnectingRef.current = false;
        socketRef.current = ws;
        
        ws.send('refresh');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (onMessageRef.current) onMessageRef.current(data);
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      ws.onerror = (error) => {
        isConnectingRef.current = false;
      };

      ws.onclose = () => {
        console.log(`❌ WebSocket disconnected from ${path}`);
        socketRef.current = null;
        isConnectingRef.current = false;
        
        // ONLY attempt reconnection if it wasn't manually closed (e.g. unmounted)
        if (!manualDisconnectRef.current) {
          setTimeout(connect, 3000);
        }
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      isConnectingRef.current = false;
    }
  }, [path]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const send = useCallback((message) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(typeof message === 'string' ? message : JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected. Cannot send message.');
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect, ...dependencies]);

  return {
    send,
    connected: socketRef.current?.readyState === WebSocket.OPEN,
    disconnect
  };
};

export default useWebSocket;