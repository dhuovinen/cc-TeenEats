import { io, Socket } from 'socket.io-client';
import { getToken } from './auth';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(BASE, { autoConnect: false });
  }
  return socket;
}

export function connectDriverSocket(): Socket {
  const s = getSocket();
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  if (!s.connected) {
    s.connect();
    s.once('connect', () => {
      s.emit('driver_auth', { token });
    });
  }
  return s;
}

export function disconnectDriverSocket() {
  socket?.disconnect();
  socket = null;
}
