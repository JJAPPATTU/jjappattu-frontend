import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

let socket;

export function createGameSocket({ onConnect, onDisconnect, onLose, onError }) {
  socket = io(SERVER_URL, { transports: ['websocket'] });

  socket.on('connect', () => onConnect?.());
  socket.on('disconnect', () => onDisconnect?.());
  socket.on('connect_error', (err) => onError?.(err));
  socket.on('game_result', (data) => {
    if (data?.result === 'LOSE') {
      onLose?.(data);
    }
  });

  return socket;
}

export function closeGameSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
