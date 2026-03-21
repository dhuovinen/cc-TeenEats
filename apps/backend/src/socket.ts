import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// driverId → socketId mapping (in-memory, alpha only)
export const driverSockets = new Map<string, string>();
// socketId → driverId (reverse lookup for disconnect cleanup)
const socketToDriver = new Map<string, string>();

let io: Server;

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.DISPATCHER_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    console.log('[socket] connected:', socket.id);

    // Driver authentication handshake
    socket.on('driver_auth', (data: { token: string }) => {
      try {
        const payload = jwt.verify(
          data.token,
          process.env.JWT_SECRET as string
        ) as { sub: string; name: string };
        const driverId = payload.sub;
        driverSockets.set(driverId, socket.id);
        socketToDriver.set(socket.id, driverId);
        socket.join(`driver:${driverId}`);
        socket.emit('driver_auth_ok', { driverId, name: payload.name });
        console.log(`[socket] driver ${driverId} authenticated`);
      } catch {
        socket.emit('driver_auth_error', { message: 'Invalid token' });
      }
    });

    // Dispatcher authentication handshake
    socket.on('dispatcher_auth', (data: { apiKey: string }) => {
      if (data.apiKey === process.env.DISPATCHER_API_KEY) {
        socket.join('dispatcher');
        socket.emit('dispatcher_auth_ok');
        console.log('[socket] dispatcher authenticated');
      } else {
        socket.emit('dispatcher_auth_error', { message: 'Invalid API key' });
      }
    });

    socket.on('disconnect', () => {
      const driverId = socketToDriver.get(socket.id);
      if (driverId) {
        driverSockets.delete(driverId);
        socketToDriver.delete(socket.id);
        console.log(`[socket] driver ${driverId} disconnected`);
      }
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

/**
 * Emit a delivery_request event to all online (non-busy) drivers by ID list.
 * Each driver gets the event in their personal room so the server controls targeting.
 */
export function broadcastDeliveryRequest(
  driverIds: string[],
  payload: unknown
): void {
  const ioInstance = getIO();
  for (const driverId of driverIds) {
    ioInstance.to(`driver:${driverId}`).emit('delivery_request', payload);
  }
}

/**
 * Notify all currently-connected drivers that a request has expired
 * (either accepted by someone else, timed out, or cancelled).
 */
export function broadcastRequestExpired(deliveryId: string): void {
  const ioInstance = getIO();
  ioInstance.emit('request_expired', { deliveryId });
}
