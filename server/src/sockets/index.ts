import type { Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | null = null;

export function setIO(io: SocketIOServer): void {
  ioInstance = io;
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function emitToDispatch(event: string, data: unknown): void {
  ioInstance?.to('dispatch').emit(event, data);
}

export function emitToUser(userId: string, event: string, data: unknown): void {
  ioInstance?.to(`user:${userId}`).emit(event, data);
}

export function emitToIncident(incidentId: string, event: string, data: unknown): void {
  ioInstance?.to(`incident:${incidentId}`).emit(event, data);
}
