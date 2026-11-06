import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/authStore';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');

export function useSocket(onEvent?: (event: string, data: unknown) => void) {
  const { accessToken } = useAuthStore();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken || !SOCKET_URL) return;

    const socket = io(SOCKET_URL, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    if (onEvent) {
      const events = [
        'sos:new',
        'incident:created',
        'incident:updated',
        'incident:verified',
        'incident:assigned',
        'incident:status',
        'assignment:new',
        'assignment:accepted',
        'responder:location',
        'notification:new',
        'chat:message',
        'timeline:update',
      ];
      events.forEach((e) => socket.on(e, (data) => onEvent(e, data)));
    }

    return () => {
      socket.disconnect();
    };
  }, [accessToken, onEvent]);

  return socketRef;
}

export function joinIncidentRoom(socket: Socket | null, incidentId: string) {
  socket?.emit('incident:join', incidentId);
}
