import { Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | null = null;

export function setIoInstance(io: SocketIOServer): void {
  ioInstance = io;
}

/**
 * Tells any connected clients in a match's room that the match was cancelled,
 * so the mini app can show a message instead of hanging on "waiting" forever.
 * No-op if Socket.IO hasn't been initialized yet or nobody is connected.
 */
export function notifyMatchCancelled(matchId: string): void {
  if (!ioInstance) return;
  ioInstance.to(`match:${matchId}`).emit('match:cancelled');
}
