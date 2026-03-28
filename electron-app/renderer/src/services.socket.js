import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
const SOCKET_PATH = import.meta.env.VITE_SOCKET_PATH || '/socket.io';
const SOCKET_TIMEOUT_MS = Number(import.meta.env.VITE_SOCKET_TIMEOUT_MS || 5000);

let socket;

export function getSocketConfig() {
  return {
    serverUrl: SERVER_URL,
    path: SOCKET_PATH,
    timeoutMs: SOCKET_TIMEOUT_MS,
  };
}

function buildConnectionError(err) {
  const message = err?.message || 'Socket connection failed';

  if (message === 'timeout') {
    return `Socket handshake timed out. Check if ${SERVER_URL}${SOCKET_PATH} is a real Socket.IO endpoint.`;
  }

  if (message === 'websocket error') {
    return `WebSocket failed. Verify server is running and CORS allows origin from this app (${SERVER_URL}).`;
  }

  return message;
}

export function createGameSocket({ onConnect, onDisconnect, onLose, onError, onStatus }) {
  socket = io(SERVER_URL, {
    path: SOCKET_PATH,
    timeout: SOCKET_TIMEOUT_MS,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1200,
    reconnectionDelayMax: 6000,
    randomizationFactor: 0.4,
  });

  socket.on('connect', () => {
    onStatus?.({ type: 'connect', detail: `Connected (${socket.id})` });
    onConnect?.();
  });

  socket.on('disconnect', (reason) => {
    onStatus?.({ type: 'disconnect', detail: reason || 'disconnected' });
    onDisconnect?.();
  });

  socket.on('connect_error', (err) => {
    onStatus?.({ type: 'connect_error', detail: err?.message || 'unknown_error' });
    onError?.(buildConnectionError(err));
  });

  socket.io.on('reconnect_attempt', (attempt) => {
    onStatus?.({ type: 'reconnect_attempt', detail: `attempt ${attempt}` });
  });

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
