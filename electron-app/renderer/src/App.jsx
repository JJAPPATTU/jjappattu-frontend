import { useEffect, useMemo, useRef, useState } from 'react';
import { fileService } from './services.file';
import { localStateService } from './services.local-state';
import {
  createGameSocket,
  closeGameSocket,
  getSocketConfig,
  sendFriendRequest,
  respondToFriendRequest,
  sendDuelInvite,
  respondToDuelInvite,
  sendGameUpdate,
  sendGameResult,
} from './services.socket';

const DEFAULT_SETTINGS = {
  workspacePath: '',
  autoApprove: false,
};

const PUNISHMENT_COUNT = 3;
const PRACTICE_TUG_DURATION_SECONDS = 8;
const PRACTICE_TUG_STEP = 6;
const PRACTICE_TUG_WIN_LINE = 42;
const PRACTICE_PLAYER_SIDE = 'left';
const PRACTICE_AI_SIDE = PRACTICE_PLAYER_SIDE === 'left' ? 'right' : 'left';
const PRACTICE_AI_CLICK_INTERVAL_MS = 320;
const PRACTICE_AI_CLICK_CHANCE = 0.82;
const ONLINE_TUG_DURATION_SECONDS = 20;
const ONLINE_TUG_STEP = 6;
const ONLINE_TUG_WIN_LINE = 42;
const GAME_TYPES = [
  {
    id: 'tug-of-war',
    name: 'TUG OF WAR',
    description: 'Fast rope-control battle mode.',
  },
];

function pickRandom(files, count) {
  return [...files].sort(() => Math.random() - 0.5).slice(0, count);
}

function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [localProfile, setLocalProfile] = useState(() => localStateService.getProfile());
  const [friendDraft, setFriendDraft] = useState('');
  const [friendNotice, setFriendNotice] = useState('');
  const [friendNoticeType, setFriendNoticeType] = useState('info');
  const [incomingFriendRequests, setIncomingFriendRequests] = useState([]);
  const [incomingDuelInvites, setIncomingDuelInvites] = useState([]);
  const [selectedFriendId, setSelectedFriendId] = useState('');
  const [files, setFiles] = useState([]);
  const [screen, setScreen] = useState('setup');
  const [connected, setConnected] = useState(false);
  const [isNetworkOnline, setIsNetworkOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [socketStatus, setSocketStatus] = useState('');
  const [pendingDelete, setPendingDelete] = useState([]);
  const [result, setResult] = useState({ deleted: [], skipped: [] });
  const [error, setError] = useState('');
  const [workspaceSelectedThisSession, setWorkspaceSelectedThisSession] = useState(false);
  const [showPermissionConsent, setShowPermissionConsent] = useState(false);
  const [permissionConsentChecked, setPermissionConsentChecked] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [selectedMatchMode, setSelectedMatchMode] = useState('');
  const [selectedGameType, setSelectedGameType] = useState('');
  const [practiceRopePosition, setPracticeRopePosition] = useState(0);
  const [practiceTimeLeft, setPracticeTimeLeft] = useState(PRACTICE_TUG_DURATION_SECONDS);
  const [practiceWinner, setPracticeWinner] = useState(null);
  const [practiceResultText, setPracticeResultText] = useState('');
  const [isPracticeRunning, setIsPracticeRunning] = useState(false);
  const [onlineRoomId, setOnlineRoomId] = useState('');
  const [onlineOpponentId, setOnlineOpponentId] = useState('');
  const [onlinePlayerSide, setOnlinePlayerSide] = useState('left');
  const [onlineRopePosition, setOnlineRopePosition] = useState(0);
  const [onlineTimeLeft, setOnlineTimeLeft] = useState(ONLINE_TUG_DURATION_SECONDS);
  const [onlineLastPullSide, setOnlineLastPullSide] = useState(null);
  const [onlinePhase, setOnlinePhase] = useState('idle');
  const [onlineResultText, setOnlineResultText] = useState('');
  const [onlineResultSent, setOnlineResultSent] = useState(false);
  const onlineResultSentRef = useRef(false);

  const canStart = useMemo(() => Boolean(settings.workspacePath), [settings.workspacePath]);
  const isLandingOnly = screen === 'setup' && !workspaceSelectedThisSession;
  const isCommandLobby = screen === 'setup' && workspaceSelectedThisSession;
  const isGameScreen = screen === 'game' || screen === 'practice';
  const workspaceName = useMemo(() => {
    if (!settings.workspacePath) return 'NO FOLDER';
    const segments = settings.workspacePath.replace(/\\/g, '/').split('/').filter(Boolean);
    return segments[segments.length - 1] || settings.workspacePath;
  }, [settings.workspacePath]);
  const folderCount = useMemo(() => {
    const folders = new Set();
    files.forEach((filePath) => {
      const parts = filePath.replace(/\\/g, '/').split('/');
      parts.pop();
      let current = '';
      parts.forEach((part) => {
        current = current ? `${current}/${part}` : part;
        folders.add(current);
      });
    });
    return folders.size;
  }, [files]);
  const normalizedPath = useMemo(() => settings.workspacePath.replace(/\\/g, '/'), [settings.workspacePath]);
  const socketConfig = useMemo(() => getSocketConfig(), []);

  useEffect(() => {
    window.electronAPI.getSettings().then((saved) => {
      setSettings(saved);
      if (saved.workspacePath) {
        refreshFiles();
      }
    });

    return () => closeGameSocket();
  }, []);

  useEffect(() => {
    function handleOnline() {
      setIsNetworkOnline(true);
    }

    function handleOffline() {
      setIsNetworkOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function persistSettings(next) {
    const saved = await window.electronAPI.saveSettings(next);
    setSettings(saved);
  }

  async function refreshFiles() {
    try {
      const allFiles = await fileService.listFiles(true);
      setFiles(allFiles);
    } catch (err) {
      setError(err.message || 'Failed to load file list');
    }
  }

  async function onSelectWorkspace() {
    const selected = await window.electronAPI.selectWorkspace();
    if (!selected.canceled) {
      setSettings(selected.settings);
      setError('');
      setShowPermissionConsent(false);
      setPermissionConsentChecked(false);
      await refreshFiles();
      setWorkspaceSelectedThisSession(true);
    }
  }

  async function runPunishment(count) {
    const currentFiles = await fileService.listFiles(true);
    setFiles(currentFiles);

    if (currentFiles.length === 0) {
      setResult({ deleted: [], skipped: [{ file: '-', reason: 'No files found.' }] });
      setScreen('result');
      return;
    }

    const targets = pickRandom(currentFiles, count);
    if (settings.autoApprove) {
      const deletedResult = await fileService.deleteFiles(targets);
      setResult(deletedResult);
      setPendingDelete([]);
      setScreen('result');
      await refreshFiles();
      return;
    }

    setPendingDelete(targets);
  }

  function startPracticeRound() {
    setPracticeRopePosition(0);
    setPracticeTimeLeft(PRACTICE_TUG_DURATION_SECONDS);
    setPracticeWinner(null);
    setPracticeResultText('');
    setIsPracticeRunning(true);
  }

  function onStartPracticeGame() {
    startPracticeRound();
    setScreen('practice');
  }

  function onSelectGameType(gameTypeId) {
    setSelectedGameType(gameTypeId);
    setScreen('game-mode');
  }

  function finishPracticeRound(nextPosition) {
    setIsPracticeRunning(false);

    if (nextPosition > 0) {
      setPracticeWinner('RIGHT');
      setPracticeResultText('Time over: RIGHT side pulled farther.');
      return;
    }

    if (nextPosition < 0) {
      setPracticeWinner('LEFT');
      setPracticeResultText('Time over: LEFT side pulled farther.');
      return;
    }

    setPracticeWinner('DRAW');
    setPracticeResultText('Time over: draw.');
  }

  function onPracticeClick(direction) {
    if (screen !== 'practice' || !isPracticeRunning || practiceWinner) return;

    setPracticeRopePosition((prev) => {
      const step = direction === 'left' ? -PRACTICE_TUG_STEP : PRACTICE_TUG_STEP;
      const next = Math.max(-50, Math.min(50, prev + step));

      if (next <= -PRACTICE_TUG_WIN_LINE) {
        setPracticeWinner('LEFT');
        setPracticeResultText('LEFT side crossed the win line.');
        setIsPracticeRunning(false);
      } else if (next >= PRACTICE_TUG_WIN_LINE) {
        setPracticeWinner('RIGHT');
        setPracticeResultText('RIGHT side crossed the win line.');
        setIsPracticeRunning(false);
      }

      return next;
    });
  }

  function onPlayerPull() {
    onPracticeClick(PRACTICE_PLAYER_SIDE);
  }

  function onOnlinePull() {
    if (onlinePhase !== 'playing' || onlineResultSentRef.current || !onlineRoomId) {
      return;
    }

    const direction = onlinePlayerSide;
    applyOnlinePull(direction);
    const sent = sendGameUpdate(onlineRoomId, {
      action: 'PULL',
      direction,
    });

    if (!sent) {
      setError('Failed to send game update. Check your connection.');
    }
  }

  async function confirmDelete() {
    const deletedResult = await fileService.deleteFiles(pendingDelete);
    setResult(deletedResult);
    setPendingDelete([]);
    setScreen('result');
    await refreshFiles();
  }

  function resetOnlineMatchState() {
    setOnlineRoomId('');
    setOnlineOpponentId('');
    setOnlinePlayerSide('left');
    setOnlineRopePosition(0);
    setOnlineTimeLeft(ONLINE_TUG_DURATION_SECONDS);
    setOnlineLastPullSide(null);
    setOnlinePhase('idle');
    setOnlineResultText('');
    setOnlineResultSent(false);
    onlineResultSentRef.current = false;
  }

  function resolveWinnerSideFromPosition(position, fallbackSide = 'left') {
    if (position <= -ONLINE_TUG_WIN_LINE) {
      return 'left';
    }

    if (position >= ONLINE_TUG_WIN_LINE) {
      return 'right';
    }

    if (position < 0) {
      return 'left';
    }

    if (position > 0) {
      return 'right';
    }

    return fallbackSide;
  }

  function getPlayerIdBySide(side) {
    if (side === onlinePlayerSide) {
      return localProfile.devicePlayerId;
    }
    return onlineOpponentId;
  }

  function finishOnlineRound(nextPosition, fallbackSide = 'left') {
    const winnerSide = resolveWinnerSideFromPosition(nextPosition, fallbackSide);
    const winnerPlayerId = getPlayerIdBySide(winnerSide);
    if (!winnerPlayerId) {
      return;
    }

    if (!onlineResultSentRef.current) {
      const sent = sendGameResult(onlineRoomId, winnerPlayerId);
      if (!sent) {
        setError('Failed to submit game result to server.');
      } else {
        setOnlineResultSent(true);
        onlineResultSentRef.current = true;
      }
    }

    setOnlinePhase('finished');
    setOnlineResultText(`Round finished. Winner side: ${winnerSide.toUpperCase()}`);
  }

  function applyOnlinePull(direction) {
    setOnlineLastPullSide(direction);

    setOnlineRopePosition((prev) => {
      const step = direction === 'left' ? -ONLINE_TUG_STEP : ONLINE_TUG_STEP;
      const next = Math.max(-50, Math.min(50, prev + step));
      const reachedWinLine = Math.abs(next) >= ONLINE_TUG_WIN_LINE;

      if (reachedWinLine && onlinePhase === 'playing') {
        finishOnlineRound(next, direction);
      }

      return next;
    });
  }

  function onFriendAdded(payload) {
    const friendId = payload?.friendPlayerId;
    const ownerPlayerId = payload?.playerId;
    if (!friendId || ownerPlayerId !== localProfile.devicePlayerId) {
      return;
    }

    const next = localStateService.addFriend(friendId);
    setLocalProfile(next);
  }

  function onFriendRequestResult(payload) {
    const withPlayerId = payload?.withPlayerId;
    const status = payload?.status;
    if (!withPlayerId || !status) {
      return;
    }

    setIncomingFriendRequests((prev) => prev.filter((playerId) => playerId !== withPlayerId));
    setFriendNoticeType(status === 'ACCEPTED' ? 'success' : status === 'DECLINED' ? 'info' : 'error');
    setFriendNotice(`Friend request ${status.toLowerCase()}: ${withPlayerId}`);
  }

  function onFriendRequestReceived(payload) {
    const fromPlayerId = payload?.fromPlayerId;
    if (!fromPlayerId) {
      return;
    }

    setIncomingFriendRequests((prev) => (prev.includes(fromPlayerId) ? prev : [...prev, fromPlayerId]));
    setFriendNoticeType('info');
    setFriendNotice(`New friend request: ${fromPlayerId}`);
  }

  function onDuelInviteReceived(payload) {
    const fromPlayerId = payload?.fromPlayerId;
    if (!fromPlayerId) {
      return;
    }

    setIncomingDuelInvites((prev) => (prev.includes(fromPlayerId) ? prev : [...prev, fromPlayerId]));
    setFriendNoticeType('info');
    setFriendNotice(`Match request received: ${fromPlayerId}`);
  }

  function onDuelInviteResult(payload) {
    const withPlayerId = payload?.withPlayerId;
    const status = payload?.status;
    if (!withPlayerId || !status) {
      return;
    }

    setIncomingDuelInvites((prev) => prev.filter((playerId) => playerId !== withPlayerId));
    setFriendNoticeType(status === 'ACCEPTED' ? 'success' : status === 'DECLINED' ? 'info' : 'error');
    setFriendNotice(`Match request ${status.toLowerCase()}: ${withPlayerId}`);
  }

  function onSendFriendRequest() {
    const friendId = friendDraft.trim();
    if (!friendId) {
      setFriendNoticeType('error');
      setFriendNotice('Enter a friend/player ID first.');
      return;
    }

    if (friendId === localProfile.devicePlayerId) {
      setFriendNoticeType('error');
      setFriendNotice('You cannot add your own device ID.');
      return;
    }

    if (localProfile.friends.includes(friendId)) {
      setFriendNoticeType('error');
      setFriendNotice('This friend is already in your list.');
      return;
    }

    const sent = sendFriendRequest(friendId);
    if (!sent) {
      setFriendNoticeType('error');
      setFriendNotice('Connect to server first.');
      return;
    }

    setFriendDraft('');
    setFriendNoticeType('info');
    setFriendNotice(`Friend request sent: ${friendId}`);
  }

  function onRespondFriendRequest(fromPlayerId, accept) {
    const sent = respondToFriendRequest(fromPlayerId, accept);
    if (!sent) {
      setFriendNoticeType('error');
      setFriendNotice('Connect to server first.');
      return;
    }

    setIncomingFriendRequests((prev) => prev.filter((playerId) => playerId !== fromPlayerId));
    setFriendNoticeType('info');
    setFriendNotice(`${accept ? 'Accepted' : 'Declined'} request: ${fromPlayerId}`);
  }

  function onSendDuelInvite(friendId) {
    if (!friendId) return;

    const sent = sendDuelInvite(friendId);
    if (!sent) {
      setFriendNoticeType('error');
      setFriendNotice('Connect to server first.');
      return;
    }

    setFriendNoticeType('info');
    setFriendNotice(`Match request sent: ${friendId}`);
  }

  function onRespondDuelInvite(fromPlayerId, accept) {
    const sent = respondToDuelInvite(fromPlayerId, accept);
    if (!sent) {
      setFriendNoticeType('error');
      setFriendNotice('Connect to server first.');
      return;
    }

    setIncomingDuelInvites((prev) => prev.filter((playerId) => playerId !== fromPlayerId));
    setFriendNoticeType('info');
    setFriendNotice(`${accept ? 'Accepted' : 'Declined'} match request: ${fromPlayerId}`);
  }

  function onMatchFound(payload) {
    const matchType = payload?.matchType;
    if (matchType === 'DUEL') {
      setSelectedMatchMode('friend');
    } else if (matchType === 'QUEUE') {
      setSelectedMatchMode('online');
    }

    setOnlineRoomId(payload?.roomId || '');
    setOnlineOpponentId(payload?.opponentPlayerId || '');
    setOnlineRopePosition(0);
    setOnlineTimeLeft(ONLINE_TUG_DURATION_SECONDS);
    setOnlineLastPullSide(null);
    setOnlineResultText('');
    setOnlineResultSent(false);
    onlineResultSentRef.current = false;
    setOnlinePhase('matched');
    setScreen('game');
  }

  function onStartGame(payload) {
    const roomId = payload?.roomId;
    const players = Array.isArray(payload?.players) ? payload.players : [];
    const myPlayerId = localProfile.devicePlayerId;
    const myIndex = players.findIndex((playerId) => playerId === myPlayerId);

    if (!roomId || myIndex < 0) {
      setError('Invalid start_game payload from server.');
      return;
    }

    const side = myIndex === 0 ? 'left' : 'right';
    const opponentId = players[myIndex === 0 ? 1 : 0] || onlineOpponentId;

    setOnlineRoomId(roomId);
    setOnlineOpponentId(opponentId);
    setOnlinePlayerSide(side);
    setOnlineRopePosition(0);
    setOnlineTimeLeft(ONLINE_TUG_DURATION_SECONDS);
    setOnlineLastPullSide(null);
    setOnlineResultText('');
    setOnlineResultSent(false);
    onlineResultSentRef.current = false;
    setOnlinePhase('playing');
    setError('');
  }

  function onGameUpdate(payload) {
    if (!payload || payload.roomId !== onlineRoomId || onlinePhase !== 'playing') {
      return;
    }

    if (payload?.data?.action !== 'PULL') {
      return;
    }

    const direction = payload?.data?.direction;
    if (direction !== 'left' && direction !== 'right') {
      return;
    }

    applyOnlinePull(direction);
  }

  function connectLobbySocket() {
    if (!isNetworkOnline) {
      setError('Network is offline. Please reconnect and try again.');
      return;
    }

    closeGameSocket();
    resetOnlineMatchState();
    setConnected(false);
    setSocketStatus('connecting...');
    setError('');

    createGameSocket({
      playerId: localProfile.devicePlayerId,
      joinQueueOnConnect: false,
      onConnect: () => {
        setConnected(true);
        setError('');
      },
      onDisconnect: () => {
        setConnected(false);
        if (onlinePhase !== 'finished') {
          setOnlinePhase('idle');
        }
      },
      onMatchFound,
      onStartGame,
      onGameUpdate,
      onMatchResult,
      onLose: () => runPunishment(PUNISHMENT_COUNT),
      onError: (message) => setError(message || 'Socket connection failed'),
      onStatus: ({ type, detail }) => setSocketStatus(`${type}${detail ? `: ${detail}` : ''}`),
      onFriendRequestReceived,
      onFriendRequestResult,
      onFriendAdded,
      onDuelInviteReceived,
      onDuelInviteResult,
    });
  }

  function onMatchResult(payload) {
    const next = localStateService.recordMatch(payload);
    setLocalProfile(next);
    setOnlinePhase('finished');
    setOnlineResultSent(true);
    onlineResultSentRef.current = true;
    setOnlineResultText(
      payload?.result === 'WIN'
        ? `You won${payload?.reason ? ` (${payload.reason})` : ''}.`
        : `You lost${payload?.reason ? ` (${payload.reason})` : ''}.`
    );
  }

  function startGame(mode) {
    if (!isNetworkOnline) {
      setError('Network is offline. Please reconnect and try again.');
      return;
    }

    setError('');
    setSelectedMatchMode(mode);
    setConnected(false);
    setSocketStatus('connecting...');
    setScreen('game');
    closeGameSocket();
    resetOnlineMatchState();
    setOnlinePhase(mode === 'online' ? 'waiting_match' : 'idle');

    createGameSocket({
      playerId: localProfile.devicePlayerId,
      onConnect: () => {
        setConnected(true);
        setError('');
      },
      onDisconnect: () => {
        setConnected(false);
        if (onlinePhase !== 'finished') {
          setOnlinePhase('idle');
        }
      },
      onMatchFound,
      onStartGame,
      onGameUpdate,
      onMatchResult,
      onLose: () => runPunishment(PUNISHMENT_COUNT),
      onError: (message) => setError(message || 'Socket connection failed'),
      onStatus: ({ type, detail }) => setSocketStatus(`${type}${detail ? `: ${detail}` : ''}`),
      onFriendRequestReceived,
      onFriendRequestResult,
      onFriendAdded,
      onDuelInviteReceived,
      onDuelInviteResult,
    });
  }

  function onOpenPermissionConsent() {
    setShowPermissionConsent(true);
  }

  function onConfirmPermissionConsent() {
    if (!permissionConsentChecked) return;
    setShowPermissionConsent(false);
    setPermissionConsentChecked(false);
    setScreen('mode');
    connectLobbySocket();
  }

  useEffect(() => {
    if (screen !== 'practice' || !isPracticeRunning || practiceWinner) return undefined;

    const timer = window.setInterval(() => {
      setPracticeTimeLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          finishPracticeRound(practiceRopePosition);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [screen, isPracticeRunning, practiceWinner, practiceRopePosition]);

  useEffect(() => {
    if (screen !== 'practice' || !isPracticeRunning || practiceWinner) return undefined;

    const aiTimer = window.setInterval(() => {
      if (Math.random() <= PRACTICE_AI_CLICK_CHANCE) {
        onPracticeClick(PRACTICE_AI_SIDE);
      }
    }, PRACTICE_AI_CLICK_INTERVAL_MS);

    return () => window.clearInterval(aiTimer);
  }, [screen, isPracticeRunning, practiceWinner]);

  useEffect(() => {
    if (screen !== 'game' || onlinePhase !== 'playing' || onlineResultSent) return undefined;

    const timer = window.setInterval(() => {
      setOnlineTimeLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          finishOnlineRound(onlineRopePosition, onlineLastPullSide || 'left');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [screen, onlinePhase, onlineResultSent, onlineRopePosition, onlineLastPullSide]);

  useEffect(() => {
    if (selectedFriendId && !localProfile.friends.includes(selectedFriendId)) {
      setSelectedFriendId('');
    }
  }, [localProfile.friends, selectedFriendId]);

  async function onCopyPath() {
    if (!settings.workspacePath) return;
    try {
      await navigator.clipboard.writeText(settings.workspacePath);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1200);
    } catch (_err) {
      setPathCopied(false);
    }
  }

  function renderSelectedFolderPathHud() {
    return (
      <div className="path-hud">
        <p className="arcade-text text-[10px] tracking-[0.16em] text-zinc-400">SELECTED FOLDER PATH</p>
        <div className="mt-2 flex items-center gap-2">
          <div className="path-terminal flex-1" title={settings.workspacePath || 'NO FOLDER SELECTED'}>
            <span className={`path-string ${normalizedPath ? '' : 'path-segment-dim'}`}>
              {normalizedPath || 'NO FOLDER SELECTED'}
            </span>
          </div>
          <button
            onClick={onCopyPath}
            disabled={!settings.workspacePath}
            className="arcade-text rounded-md border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-[10px] tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-500"
          >
            {pathCopied ? 'COPIED' : 'COPY'}
          </button>
        </div>
      </div>
    );
  }

  function renderModeHub() {
    return (
      <section className="mx-auto max-w-3xl px-2 py-3 md:px-3">
        <div className="text-center">
          <p className="arcade-text text-sm tracking-[0.16em] text-cyan-100 md:text-base">PROFILE</p>
          <p className="mt-3 text-2xl font-extrabold tracking-[0.05em] text-zinc-100 md:text-3xl">{localProfile.devicePlayerId}</p>
          <p className="mt-3 text-base font-semibold text-zinc-200 md:text-lg">
            Wins: {localProfile.totalWins} | Losses: {localProfile.totalLosses}
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <button
              onClick={() => setScreen('game-list')}
              className="rounded-xl border border-cyan-500/80 bg-cyan-500/20 px-5 py-4 text-base font-extrabold tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-500/30 md:text-lg"
            >
              PLAY GAME
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-600/90 bg-zinc-950/70 p-4 text-left md:p-5">
            <p className="text-xs font-bold tracking-[0.12em] text-zinc-100">FRIENDS</p>
            <p className="mt-1 text-[11px] text-zinc-300">Server friend requests (requires socket connection)</p>

            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold tracking-[0.08em]">
              <span className={connected ? 'text-emerald-300' : 'text-zinc-400'}>{connected ? 'CONNECTED TO LOBBY' : 'NOT CONNECTED'}</span>
              <button
                onClick={connectLobbySocket}
                className="rounded border border-zinc-500 px-2 py-1 font-bold tracking-[0.08em] text-zinc-100 hover:border-cyan-400 hover:text-cyan-200"
              >
                CONNECT
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={friendDraft}
                onChange={(event) => {
                  setFriendDraft(event.target.value);
                  setFriendNotice('');
                }}
                placeholder="Enter target player ID"
                className="flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 outline-none focus:border-cyan-500"
              />
              <button
                onClick={onSendFriendRequest}
                className="rounded-lg border border-cyan-500/70 bg-cyan-500/15 px-3 py-2 text-xs font-bold tracking-[0.08em] text-cyan-100 transition hover:bg-cyan-500/25"
              >
                REQUEST
              </button>
            </div>

            {friendNotice && (
              <p className={`mt-2 text-xs font-semibold ${friendNoticeType === 'error' ? 'text-red-300' : 'text-cyan-200'}`}>{friendNotice}</p>
            )}

            <p className="mt-4 text-[11px] font-bold tracking-[0.08em] text-zinc-300">PENDING INCOMING REQUESTS</p>
            <ul className="mt-1 max-h-24 overflow-auto border-t border-zinc-700/90 pt-2 text-sm text-zinc-100">
              {incomingFriendRequests.map((friendId) => (
                <li key={friendId} className="mb-1 flex items-center justify-between gap-2 border-b border-zinc-800/90 px-1 py-1">
                  <span className="truncate font-medium">{friendId}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onRespondFriendRequest(friendId, true)}
                      className="rounded border border-emerald-600 px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] text-emerald-300 hover:border-emerald-400 hover:text-emerald-100"
                    >
                      ACCEPT
                    </button>
                    <button
                      onClick={() => onRespondFriendRequest(friendId, false)}
                      className="rounded border border-zinc-600 px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] text-zinc-300 hover:border-red-400 hover:text-red-200"
                    >
                      DECLINE
                    </button>
                  </div>
                </li>
              ))}
              {incomingFriendRequests.length === 0 && <li className="text-zinc-400">No incoming requests.</li>}
            </ul>

            <p className="mt-4 text-[11px] font-bold tracking-[0.08em] text-zinc-300">FRIEND LIST</p>
            <ul className="mt-1 max-h-32 overflow-auto border-t border-zinc-700/90 pt-2 text-sm text-zinc-100">
              {localProfile.friends.map((friendId) => (
                <li
                  key={friendId}
                  onClick={() => setSelectedFriendId(friendId)}
                  className={`mb-1 border-b border-zinc-800/90 px-1 py-1 ${
                    selectedFriendId === friendId ? 'bg-cyan-500/10' : 'hover:bg-zinc-900/60'
                  } cursor-pointer`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{friendId}</span>
                    {incomingDuelInvites.includes(friendId) && <span className="text-[10px] font-bold text-amber-200">REQUESTED YOU</span>}
                  </div>
                  {selectedFriendId === friendId && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onSendDuelInvite(friendId);
                        }}
                        className="rounded border border-cyan-500/70 px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] text-cyan-200 hover:border-cyan-300 hover:text-cyan-100"
                      >
                        경기하기
                      </button>
                      {incomingDuelInvites.includes(friendId) && (
                        <>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              onRespondDuelInvite(friendId, true);
                            }}
                            className="rounded border border-emerald-600 px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] text-emerald-300 hover:border-emerald-400 hover:text-emerald-100"
                          >
                            ACCEPT
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              onRespondDuelInvite(friendId, false);
                            }}
                            className="rounded border border-zinc-600 px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] text-zinc-300 hover:border-red-400 hover:text-red-200"
                          >
                            DECLINE
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {localProfile.friends.length === 0 && <li className="text-zinc-400">No accepted friends yet.</li>}
            </ul>
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-700/90 bg-zinc-950/60 p-4 text-left md:p-5">
            <p className="text-xs font-bold tracking-[0.12em] text-zinc-200">RECENT RECORDS</p>
            <ul className="mt-2 max-h-36 overflow-auto border-t border-zinc-800/90 pt-2 text-xs text-zinc-200">
              {[...localProfile.matchHistory].slice(-8).reverse().map((item, index) => (
                <li key={`${item.roomId}-${item.at}-${index}`} className="mb-1 border-b border-zinc-800/80 px-1 py-1">
                  [{item.result}] room: {item.roomId || '-'} | reason: {item.reason} | {new Date(item.at).toLocaleString()}
                </li>
              ))}
              {localProfile.matchHistory.length === 0 && <li className="text-zinc-500">No local match history yet.</li>}
            </ul>
          </div>
        </div>
      </section>
    );
  }

  function renderGameList() {
    return (
      <section className="mx-auto max-w-3xl px-2 py-2 md:px-3">
        <div className="hud-panel rounded-3xl p-6 text-center md:p-8">
          <h2 className="arcade-text text-sm tracking-[0.18em] text-cyan-100 md:text-base">SELECT GAME</h2>
          <div className="mt-7 grid gap-3">
            {GAME_TYPES.map((gameType) => (
              <button
                key={gameType.id}
                onClick={() => onSelectGameType(gameType.id)}
                className="rounded-xl border border-cyan-500/70 bg-cyan-500/15 px-5 py-4 text-left text-sm font-bold tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-500/25"
              >
                <p>{gameType.name}</p>
                <p className="mt-1 text-xs font-medium tracking-[0.06em] text-zinc-300">{gameType.description}</p>
              </button>
            ))}
          </div>
          <button
            onClick={() => setScreen('mode')}
            className="mt-5 rounded-xl border border-zinc-600 bg-zinc-900 px-5 py-3 text-xs font-semibold tracking-[0.1em] text-zinc-200 transition hover:border-zinc-400"
          >
            BACK
          </button>
        </div>
      </section>
    );
  }

  function renderGameModeSelect() {
    const selectedGame = GAME_TYPES.find((gameType) => gameType.id === selectedGameType);
    return (
      <section className="mx-auto max-w-3xl px-2 py-2 md:px-3">
        <div className="hud-panel rounded-3xl p-6 text-center md:p-8">
          <h2 className="arcade-text text-sm tracking-[0.18em] text-cyan-100 md:text-base">SELECT PLAY MODE</h2>
          <p className="mt-2 text-xs font-semibold tracking-[0.1em] text-zinc-300">
            GAME: {selectedGame?.name || 'UNKNOWN'}
          </p>
          <div className="mt-7 grid gap-3 md:grid-cols-2">
            <button
              onClick={onStartPracticeGame}
              className="rounded-xl border border-cyan-500/70 bg-cyan-500/15 px-5 py-4 text-sm font-bold tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-500/25"
            >
              PRACTICE MODE
            </button>
            <button
              onClick={() => startGame('online')}
              className="rounded-xl border border-emerald-500/70 bg-emerald-500/15 px-5 py-4 text-sm font-bold tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-500/25"
            >
              ONLINE PLAY
            </button>
          </div>
          <button
            onClick={() => setScreen('game-list')}
            className="mt-5 rounded-xl border border-zinc-600 bg-zinc-900 px-5 py-3 text-xs font-semibold tracking-[0.1em] text-zinc-200 transition hover:border-zinc-400"
          >
            BACK
          </button>
        </div>
      </section>
    );
  }

  function renderSetup() {
    if (!workspaceSelectedThisSession) {
      return (
        <div className="flex w-full flex-col items-center justify-center text-center">
          <h1 className="landing-title mb-8 text-3xl font-black tracking-[0.24em] text-zinc-100 md:text-5xl">JJAPPATTU</h1>
          <button
            onClick={onSelectWorkspace}
            className="landing-button rounded-xl border border-cyan-500/60 bg-cyan-500/10 px-7 py-3 text-sm font-extrabold tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20"
          >
            SELECT FOLDER
          </button>
        </div>
      );
    }

    return (
      <section
        className="setup-animated relative flex min-h-[calc(100vh-12rem)] w-full flex-col items-center justify-center px-2 transition-all duration-500 md:min-h-[calc(100vh-14rem)] md:px-3"
      >
        {!showPermissionConsent && (
          <div className="mx-auto w-full max-w-5xl text-center">
            <div className="entry-anim mb-12 flex w-full items-center justify-between gap-4" style={{ '--entry-delay': '0.08s' }}>
              <h1 className="arcade-text lobby-glitch text-2xl tracking-[0.2em] text-cyan-100 md:text-4xl">STAGING ROOM</h1>
              <span
                className={`arcade-text inline-flex items-center rounded-full border px-5 py-2 text-xs tracking-[0.16em] ${
                  isNetworkOnline
                    ? 'border-emerald-300/60 bg-emerald-400/10 text-emerald-200'
                    : 'border-red-300/60 bg-red-500/10 text-red-200'
                } status-boot`}
              >
                {isNetworkOnline ? 'SYSTEM ONLINE' : 'SYSTEM OFFLINE'}
              </span>
            </div>

            <div className="mb-12 grid gap-6 md:grid-cols-3">
              <div className="stat-block entry-anim p-2" style={{ '--entry-delay': '0.2s' }}>
                <p className="arcade-text text-xs tracking-[0.16em] text-zinc-300">CURRENT FOLDER</p>
                <p className="stat-number mt-4 truncate text-2xl font-bold text-cyan-200 md:text-3xl">{workspaceName}</p>
                <p className="mt-2 truncate text-sm text-zinc-400">{settings.workspacePath || 'NO FOLDER SELECTED'}</p>
              </div>
              <div className="stat-block entry-anim p-2" style={{ '--entry-delay': '0.34s' }}>
                <p className="arcade-text text-xs tracking-[0.16em] text-zinc-300">TOTAL FILES</p>
                <p className="stat-number mt-4 text-4xl font-bold text-amber-200 md:text-5xl">{files.length}</p>
              </div>
              <div className="stat-block entry-anim p-2" style={{ '--entry-delay': '0.48s' }}>
                <p className="arcade-text text-xs tracking-[0.16em] text-zinc-300">SCANNED FOLDERS</p>
                <p className="stat-number mt-4 text-4xl font-bold text-indigo-200 md:text-5xl">{folderCount}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={onSelectWorkspace}
                style={{ '--entry-delay': '0.62s' }}
                className="arcade-text action-boot inline-flex h-12 w-64 whitespace-nowrap items-center justify-center rounded-xl border border-cyan-400/60 bg-cyan-500/10 px-6 text-xs tracking-[0.14em] text-cyan-100 transition hover:bg-cyan-500/20"
              >
                CHANGE FOLDER
              </button>
              <button
                disabled={!canStart}
                onClick={onOpenPermissionConsent}
                style={{ '--entry-delay': '0.74s' }}
                className="arcade-text action-boot inline-flex h-12 w-64 whitespace-nowrap items-center justify-center rounded-xl border border-red-500/70 bg-red-600/80 px-6 text-xs tracking-[0.14em] text-zinc-50 transition hover:bg-red-500 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                NEXT STEP
              </button>
            </div>
          </div>
        )}

        {showPermissionConsent && (
          <div className="flex flex-1 items-center justify-center">
            <div className="entry-anim w-full max-w-3xl pt-2 text-center" style={{ '--entry-delay': '0.06s' }}>
              <p className="arcade-text text-xs tracking-[0.16em] text-cyan-100">FOLDER ACCESS CONSENT</p>
              <p className="mt-3 text-sm text-zinc-300">
                This app can read and delete files inside the selected folder during penalty actions.
              </p>
              <label className="mt-4 flex cursor-pointer items-start justify-center gap-3 text-left text-sm text-zinc-200">
                <input
                  type="checkbox"
                  checked={permissionConsentChecked}
                  onChange={(e) => setPermissionConsentChecked(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-cyan-500"
                />
                <span>I agree to allow folder access for this session.</span>
              </label>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => {
                    setShowPermissionConsent(false);
                    setPermissionConsentChecked(false);
                  }}
                  className="arcade-text rounded-xl border border-zinc-600 bg-zinc-900/70 px-5 py-4 text-xs tracking-[0.14em] text-zinc-100 transition hover:border-zinc-400"
                >
                  CANCEL
                </button>
                <button
                  disabled={!permissionConsentChecked}
                  onClick={onConfirmPermissionConsent}
                  className="arcade-text rounded-xl border border-cyan-400/70 bg-cyan-500/20 px-5 py-4 text-xs tracking-[0.14em] text-cyan-50 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  CONFIRM AND CONTINUE
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  function renderGame() {
    const phaseLabelMap = {
      idle: 'IDLE',
      waiting_match: 'WAITING FOR MATCH',
      matched: 'MATCHED - WAITING READY',
      playing: 'PLAYING',
      finished: 'FINISHED',
    };

    return (
      <section className="p-2 md:p-3">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold tracking-[0.2em] text-zinc-100 md:text-2xl">MATCH CONTROL</h2>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.16em] ${
              connected
                ? 'border-emerald-400/70 bg-emerald-400/10 text-emerald-300'
                : 'border-zinc-600 bg-zinc-900 text-zinc-400'
            }`}
          >
            {connected ? 'CONNECTED' : 'WAITING'}
          </span>
        </div>

        <p className="mb-3 text-xs tracking-[0.1em] text-zinc-400">
          GAME: {GAME_TYPES.find((gameType) => gameType.id === selectedGameType)?.name || 'UNKNOWN'} |{' '}
          MODE: {selectedMatchMode === 'friend' ? 'PLAY WITH FRIEND' : 'ONLINE PLAY'}
        </p>

        <div className="rounded-2xl border border-zinc-700/80 bg-zinc-900/60 p-4">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-300">LIVE MATCH</p>
          <p className="mt-2 text-sm text-zinc-200">PHASE: {phaseLabelMap[onlinePhase] || 'UNKNOWN'}</p>
          <p className="mt-1 text-sm text-zinc-300">ROOM: {onlineRoomId || '-'}</p>
          <p className="mt-1 text-sm text-zinc-300">OPPONENT: {onlineOpponentId || '-'}</p>
          <p className="mt-1 text-sm text-zinc-300">YOUR SIDE: {onlinePlayerSide.toUpperCase()}</p>
          <p className="mt-1 text-sm text-zinc-300">TIME LEFT: {onlineTimeLeft}s</p>
          {onlineResultText && <p className="mt-2 text-sm font-semibold text-cyan-200">{onlineResultText}</p>}
        </div>

        <div className="relative mt-4 h-16 rounded-xl border border-zinc-700 bg-zinc-900/80 px-3">
          <div className="absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-700" />
          <div className="absolute left-[8%] top-2 bottom-2 w-[2px] bg-red-500/80" />
          <div className="absolute right-[8%] top-2 bottom-2 w-[2px] bg-emerald-400/80" />
          <div className="absolute left-1/2 top-2 bottom-2 w-[2px] -translate-x-1/2 bg-zinc-300/60" />
          <div
            className="absolute top-1/2 h-7 w-7 -translate-y-1/2 rounded-full border border-cyan-300/70 bg-cyan-500/30"
            style={{ left: `calc(50% + ${onlineRopePosition}%)`, transform: 'translate(-50%, -50%)' }}
          />
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <button
            onClick={onOnlinePull}
            disabled={!connected || onlinePhase !== 'playing'}
            className="rounded-lg border border-cyan-500/70 bg-cyan-500/15 px-3 py-3 text-sm font-semibold tracking-[0.08em] text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            PULL {onlinePlayerSide.toUpperCase()} (YOU)
          </button>
        </div>

        <div className="mt-3 border-l-2 border-cyan-500/50 pl-4 text-xs text-cyan-100">
          <p className="font-semibold tracking-[0.08em]">SOCKET DEBUG</p>
          <p className="mt-2 break-all">URL: {socketConfig.serverUrl}</p>
          <p className="break-all">PATH: {socketConfig.path}</p>
          <p>TIMEOUT: {socketConfig.timeoutMs}ms</p>
          <p className="break-all">PLAYER ID: {localProfile.devicePlayerId}</p>
          <p className="mt-1 text-cyan-200">STATUS: {socketStatus || 'idle'}</p>
        </div>

        <div className="mt-6 border-t border-zinc-700/70 pt-4">
          <p className="text-xs font-semibold tracking-[0.08em] text-zinc-300">LOCAL PROFILE (THIS DEVICE ONLY)</p>
          <p className="mt-2 text-sm text-zinc-300">Wins: {localProfile.totalWins} | Losses: {localProfile.totalLosses}</p>

          <p className="mt-4 text-xs font-semibold tracking-[0.08em] text-zinc-300">RECENT LOCAL MATCHES</p>
          <ul className="mt-2 max-h-32 overflow-auto border-t border-zinc-800/80 pt-2 text-xs text-zinc-200">
            {localProfile.matchHistory.map((item, index) => (
              <li key={`${item.roomId}-${item.at}-${index}`} className="mb-1 border-b border-zinc-800/80 px-1 py-1">
                [{item.result}] room: {item.roomId || '-'} | reason: {item.reason} | {new Date(item.at).toLocaleString()}
              </li>
            ))}
            {localProfile.matchHistory.length === 0 && <li className="text-zinc-500">No local match history yet.</li>}
          </ul>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <button
            onClick={() => runPunishment(PUNISHMENT_COUNT)}
            className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm font-semibold tracking-[0.08em] text-amber-200 transition hover:bg-amber-500/20"
          >
            TEST LOSS (MANUAL)
          </button>
          <button
            onClick={() => {
              closeGameSocket();
              setConnected(false);
              resetOnlineMatchState();
              setScreen('game-mode');
              connectLobbySocket();
            }}
            className="rounded-xl border border-zinc-600 bg-zinc-900 px-4 py-3 text-sm font-semibold tracking-[0.08em] text-zinc-200 transition hover:border-zinc-400 md:col-span-2"
          >
            BACK TO PLAY MODE
          </button>
        </div>
      </section>
    );
  }

  function renderPractice() {
    return (
      <section className="p-2 md:p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold tracking-[0.12em] text-cyan-100">TUG OF WAR PRACTICE</p>
          <p className="text-sm text-zinc-300">
            YOU: {PRACTICE_PLAYER_SIDE.toUpperCase()} | AI: {PRACTICE_AI_SIDE.toUpperCase()} | TIME LEFT: {practiceTimeLeft}s
          </p>
        </div>

        <div className="relative mt-2 h-16 rounded-xl border border-zinc-700 bg-zinc-900/80 px-3">
          <div className="absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-700" />
          <div className="absolute left-[8%] top-2 bottom-2 w-[2px] bg-red-500/80" />
          <div className="absolute right-[8%] top-2 bottom-2 w-[2px] bg-emerald-400/80" />
          <div className="absolute left-1/2 top-2 bottom-2 w-[2px] -translate-x-1/2 bg-zinc-300/60" />
          <div
            className="absolute top-1/2 h-7 w-7 -translate-y-1/2 rounded-full border border-cyan-300/70 bg-cyan-500/30"
            style={{ left: `calc(50% + ${practiceRopePosition}%)`, transform: 'translate(-50%, -50%)' }}
          />
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <button
            onClick={onPlayerPull}
            disabled={!isPracticeRunning}
            className="rounded-lg border border-red-500/70 bg-red-500/20 px-3 py-3 text-sm font-semibold tracking-[0.08em] text-red-100 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            PULL {PRACTICE_PLAYER_SIDE.toUpperCase()} (YOU)
          </button>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <button
            onClick={startPracticeRound}
            className="rounded-lg border border-cyan-400/70 bg-cyan-500/15 px-3 py-2 text-sm font-semibold tracking-[0.08em] text-cyan-100 transition hover:bg-cyan-500/25"
          >
            START / RESTART ROUND
          </button>
          <button
            onClick={() => {
              setIsPracticeRunning(false);
              setScreen('game-mode');
            }}
            className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm font-semibold tracking-[0.08em] text-zinc-200 transition hover:border-zinc-400"
          >
            BACK TO PLAY MODE
          </button>
        </div>

        <p className="mt-3 text-sm text-zinc-300">
          {practiceWinner
            ? `RESULT: ${practiceWinner}${practiceResultText ? ` | ${practiceResultText}` : ''}`
            : 'You can only pull your own side. AI automatically pulls the opposite side. Crossing the colored line wins instantly, otherwise winner is decided when time ends.'}
        </p>
      </section>
    );
  }

  function renderResult() {
    return (
      <section className="hud-panel rounded-3xl border-red-900/80 p-5 md:p-7">
        <h2 className="text-xl font-extrabold tracking-[0.2em] text-red-300 md:text-2xl">MISSION FAILED</h2>

        <div className="mt-5 rounded-2xl border border-zinc-700/80 bg-zinc-950/50 p-4">
          <h3 className="text-sm font-bold tracking-[0.1em] text-zinc-200">Deleted files</h3>
          <ul className="mt-3 space-y-1 text-sm text-zinc-300">
            {result.deleted.map((f) => (
              <li key={f} className="truncate">• {f}</li>
            ))}
            {result.deleted.length === 0 && <li>• None</li>}
          </ul>
        </div>

        {result.skipped.length > 0 && (
          <div className="mt-4 rounded-2xl border border-zinc-700/80 bg-zinc-950/50 p-4">
            <h3 className="text-sm font-bold tracking-[0.1em] text-zinc-200">Skipped items</h3>
            <ul className="mt-3 space-y-1 text-sm text-zinc-400">
              {result.skipped.map((s, i) => (
                <li key={`${s.file}-${i}`}>
                  • {s.file} ({s.reason})
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={() => setScreen('game')}
          className="mt-6 w-full rounded-xl border border-cyan-500/60 bg-cyan-500/10 px-4 py-3 text-sm font-bold tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20"
        >
          CONTINUE
        </button>
      </section>
    );
  }

  return (
    <main
      className={`game-shell min-h-screen text-zinc-100 ${
        isLandingOnly ? 'landing-stage flex items-center justify-center p-4' : 'p-4 md:p-8'
      } ${
        isCommandLobby ? 'command-stage' : ''
      } ${
        isGameScreen ? 'arena-stage' : ''
      }`}
    >
      {isLandingOnly && <div className="landing-event-bg" aria-hidden="true" />}
      {isLandingOnly && <div className="landing-static" aria-hidden="true" />}
      {isLandingOnly && <div className="landing-scanlines" aria-hidden="true" />}
      {isCommandLobby && <div className="command-nebula" aria-hidden="true" />}
      {isCommandLobby && <div className="command-gridflow" aria-hidden="true" />}
      {isGameScreen && <div className="arena-aurora" aria-hidden="true" />}
      {isGameScreen && <div className="arena-sweep" aria-hidden="true" />}
      {isGameScreen && <div className="arena-flow" aria-hidden="true" />}
      <div className={`relative z-10 w-full ${isLandingOnly ? '' : `mx-auto ${isCommandLobby ? 'max-w-6xl' : 'max-w-4xl'}`}`}>
        {!isLandingOnly && settings.workspacePath && <div className="mb-6">{renderSelectedFolderPathHud()}</div>}

        {screen === 'setup' && renderSetup()}
        {screen === 'mode' && renderModeHub()}
        {screen === 'game-list' && renderGameList()}
        {screen === 'game-mode' && renderGameModeSelect()}
        {screen === 'game' && renderGame()}
        {screen === 'practice' && renderPractice()}
        {screen === 'result' && renderResult()}

        {pendingDelete.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-red-600/60 bg-zinc-950 p-5 shadow-[0_0_40px_rgba(220,38,38,0.22)]">
              <h3 className="text-lg font-bold tracking-[0.12em] text-red-300">DANGER ZONE</h3>
              <p className="mt-2 text-sm text-zinc-300">The files below will be deleted. Do you want to continue?</p>

              <ul className="mt-3 max-h-56 space-y-1 overflow-auto rounded-lg border border-zinc-800 bg-black/40 p-3 text-sm text-zinc-300">
                {pendingDelete.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPendingDelete([])}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500"
                >
                  CANCEL
                </button>
                <button
                  onClick={confirmDelete}
                  className="rounded-lg border border-red-600/70 bg-red-700/90 px-3 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-red-600"
                >
                  DELETE NOW
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-red-900 bg-red-900/30 px-3 py-2 text-sm text-red-200">Error: {error}</p>
        )}
      </div>
    </main>
  );
}

export default App;
