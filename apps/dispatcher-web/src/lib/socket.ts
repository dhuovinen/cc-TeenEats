'use client';

import { io, Socket } from 'socket.io-client';

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';
const DISPATCHER_KEY = process.env.NEXT_PUBLIC_DISPATCHER_API_KEY ?? '';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(BASE, { autoConnect: false });
  }
  return socket;
}

export function connectDispatcher(): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
    s.once('connect', () => {
      s.emit('dispatcher_auth', { apiKey: DISPATCHER_KEY });
    });
  }
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
}
