import { io } from 'socket.io-client';

const DEFAULT_SERVER_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:3000'
  : 'https://jjappattu-backend.onrender.com';
const SERVER_URL = import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER_URL;
const SOCKET_PATH = import.meta.env.VITE_SOCKET_PATH || '/socket.io';
const SOCKET_TIMEOUT_MS = Number(import.meta.env.VITE_SOCKET_TIMEOUT_MS || 5000);

let socket;
let currentRoomId = null;

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
    return `WebSocket failed. Verify backend is running at ${SERVER_URL}.`;
  }

  return message;
}

export function createGameSocket({
  playerId,
  joinQueueOnConnect = true,
  onConnect,
  onDisconnect,
  onLose,
  onMatchFound,
  onStartGame,
  onGameUpdate,
  onMatchResult,
  onError,
  onStatus,
  onFriendRequestSent,
  onFriendRequestReceived,
  onFriendRequestResult,
  onFriendAdded,
  onDuelInviteSent,
  onDuelInviteReceived,
  onDuelInviteResult,
}) {
  socket = io(SERVER_URL, {
    path: SOCKET_PATH,
    timeout: SOCKET_TIMEOUT_MS,
    transports: ['websocket', 'polling'],
    auth: {
      playerId,
    },
    reconnection: true,
    reconnectionDelay: 1200,
    reconnectionDelayMax: 6000,
    randomizationFactor: 0.4,
  });

  socket.on('connect', () => {
    currentRoomId = null;
    onStatus?.({ type: 'connect', detail: `Connected (${socket.id})` });
    if (joinQueueOnConnect) {
      socket.emit('join_queue', { playerId });
      onStatus?.({ type: 'join_queue', detail: 'Queue join requested' });
    }
    onConnect?.();
  });

  socket.on('disconnect', (reason) => {
    currentRoomId = null;
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

  socket.on('queue_joined', (data) => {
    const queueSize = typeof data?.queueSize === 'number' ? data.queueSize : '?';
    onStatus?.({ type: 'queue_joined', detail: `queueSize=${queueSize}` });
  });

  socket.on('match_found', (data) => {
    const roomId = typeof data?.roomId === 'string' ? data.roomId : '';
    if (!roomId) {
      onStatus?.({ type: 'match_found', detail: 'missing roomId' });
      return;
    }

    currentRoomId = roomId;
    onStatus?.({ type: 'match_found', detail: `roomId=${roomId}` });
    onMatchFound?.(data);
    socket.emit('player_ready', { roomId });
    onStatus?.({ type: 'player_ready', detail: `roomId=${roomId}` });
  });

  socket.on('start_game', (data) => {
    const roomId = typeof data?.roomId === 'string' ? data.roomId : currentRoomId || 'unknown';
    onStatus?.({ type: 'start_game', detail: `roomId=${roomId}` });
    onStartGame?.(data);
  });

  socket.on('game_update', (data) => {
    onGameUpdate?.(data);
  });

  socket.on('match_result', (data) => {
    currentRoomId = null;
    onMatchResult?.(data);
    if (data?.result === 'LOSE') {
      onLose?.(data);
    }
  });

  socket.on('friend_request_sent', (payload) => {
    onFriendRequestSent?.(payload);
  });

  socket.on('friend_request_received', (payload) => {
    onFriendRequestReceived?.(payload);
  });

  socket.on('friend_request_result', (payload) => {
    onFriendRequestResult?.(payload);
  });

  socket.on('friend_added', (payload) => {
    onFriendAdded?.(payload);
  });

  socket.on('duel_invite_sent', (payload) => {
    onDuelInviteSent?.(payload);
  });

  socket.on('duel_invite_received', (payload) => {
    onDuelInviteReceived?.(payload);
  });

  socket.on('duel_invite_result', (payload) => {
    onDuelInviteResult?.(payload);
  });

  socket.on('error_message', (payload) => {
    const code = payload?.code || 'UNKNOWN';
    const message = payload?.message || 'Server returned an error.';
    onStatus?.({ type: 'server_error', detail: `${code}: ${message}` });
    onError?.(message);
  });

  return socket;
}

export function closeGameSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function sendFriendRequest(targetPlayerId) {
  if (!socket || !socket.connected) {
    return false;
  }

  socket.emit('friend_request', { targetPlayerId });
  return true;
}

export function respondToFriendRequest(fromPlayerId, accept) {
  if (!socket || !socket.connected) {
    return false;
  }

  socket.emit('friend_request_response', { fromPlayerId, accept: Boolean(accept) });
  return true;
}

export function sendDuelInvite(targetPlayerId) {
  if (!socket || !socket.connected) {
    return false;
  }

  socket.emit('duel_invite', { targetPlayerId });
  return true;
}

export function respondToDuelInvite(fromPlayerId, accept) {
  if (!socket || !socket.connected) {
    return false;
  }

  socket.emit('duel_invite_response', { fromPlayerId, accept: Boolean(accept) });
  return true;
}

export function sendGameUpdate(roomId, data) {
  if (!socket || !socket.connected) {
    return false;
  }

  if (!roomId || typeof roomId !== 'string') {
    return false;
  }

  socket.emit('game_update', { roomId, data: data && typeof data === 'object' ? data : {} });
  return true;
}

export function sendGameResult(roomId, winnerPlayerId) {
  if (!socket || !socket.connected) {
    return false;
  }

  if (!roomId || typeof roomId !== 'string' || !winnerPlayerId || typeof winnerPlayerId !== 'string') {
    return false;
  }

  socket.emit('game_result', { roomId, winnerPlayerId });
  return true;
}
