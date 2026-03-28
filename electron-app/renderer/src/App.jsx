import { useEffect, useMemo, useState } from 'react';
import { fileService } from './services.file';
import { createGameSocket, closeGameSocket, getSocketConfig } from './services.socket';

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

function pickRandom(files, count) {
  return [...files].sort(() => Math.random() - 0.5).slice(0, count);
}

function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
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
  const [showPracticeGame, setShowPracticeGame] = useState(false);
  const [practiceRopePosition, setPracticeRopePosition] = useState(0);
  const [practiceTimeLeft, setPracticeTimeLeft] = useState(PRACTICE_TUG_DURATION_SECONDS);
  const [practiceWinner, setPracticeWinner] = useState(null);
  const [practiceResultText, setPracticeResultText] = useState('');
  const [isPracticeRunning, setIsPracticeRunning] = useState(false);

  const canStart = useMemo(() => Boolean(settings.workspacePath), [settings.workspacePath]);
  const isLandingOnly = screen === 'setup' && !workspaceSelectedThisSession;
  const isCommandLobby = screen === 'setup' && workspaceSelectedThisSession;
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
    setShowPracticeGame(true);
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
    if (!showPracticeGame || !isPracticeRunning || practiceWinner) return;

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

  async function confirmDelete() {
    const deletedResult = await fileService.deleteFiles(pendingDelete);
    setResult(deletedResult);
    setPendingDelete([]);
    setScreen('result');
    await refreshFiles();
  }

  function startGame() {
    if (!isNetworkOnline) {
      setError('Network is offline. Please reconnect and try again.');
      return;
    }

    setError('');
    setConnected(false);
    setSocketStatus('connecting...');
    setScreen('game');
    closeGameSocket();

    createGameSocket({
      onConnect: () => {
        setConnected(true);
        setError('');
      },
      onDisconnect: () => setConnected(false),
      onLose: () => runPunishment(PUNISHMENT_COUNT),
      onError: (message) => setError(message || 'Socket connection failed'),
      onStatus: ({ type, detail }) => setSocketStatus(`${type}${detail ? `: ${detail}` : ''}`),
    });
  }

  function onOpenPermissionConsent() {
    setShowPermissionConsent(true);
  }

  function onConfirmPermissionConsent() {
    if (!permissionConsentChecked) return;
    startGame();
  }

  useEffect(() => {
    if (!showPracticeGame || !isPracticeRunning || practiceWinner) return undefined;

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
  }, [showPracticeGame, isPracticeRunning, practiceWinner, practiceRopePosition]);

  useEffect(() => {
    if (!showPracticeGame || !isPracticeRunning || practiceWinner) return undefined;

    const aiTimer = window.setInterval(() => {
      if (Math.random() <= PRACTICE_AI_CLICK_CHANCE) {
        onPracticeClick(PRACTICE_AI_SIDE);
      }
    }, PRACTICE_AI_CLICK_INTERVAL_MS);

    return () => window.clearInterval(aiTimer);
  }, [showPracticeGame, isPracticeRunning, practiceWinner]);

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
        className={`setup-animated relative flex min-h-[calc(100vh-2rem)] flex-col px-2 transition-all duration-500 md:min-h-[calc(100vh-4rem)] md:px-3 ${
          showPermissionConsent ? 'justify-start pt-4 md:pt-6' : 'items-center justify-center'
        }`}
      >
        <div className="entry-anim absolute left-2 right-2 top-2 md:left-3 md:right-3 md:top-3" style={{ '--entry-delay': '0.04s' }}>
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
        </div>

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
            <div className="entry-anim w-full max-w-3xl pt-2" style={{ '--entry-delay': '0.06s' }}>
              <p className="arcade-text text-xs tracking-[0.16em] text-cyan-100">FOLDER ACCESS CONSENT</p>
              <p className="mt-3 text-sm text-zinc-300">
                This app can read and delete files inside the selected folder during penalty actions.
              </p>
              <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-zinc-200">
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
    return (
      <section className="hud-panel rounded-3xl p-5 md:p-7">
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

        <div className="rounded-2xl border border-zinc-700/80 bg-zinc-950/50 p-4 text-sm text-zinc-300">
          Penalty runs when receiving <span className="font-semibold text-red-300">game_result: LOSE</span> from the server.
        </div>

        <div className="mt-3 rounded-2xl border border-cyan-900/70 bg-cyan-950/20 p-4 text-xs text-cyan-100">
          <p className="font-semibold tracking-[0.08em]">SOCKET DEBUG</p>
          <p className="mt-2 break-all">URL: {socketConfig.serverUrl}</p>
          <p className="break-all">PATH: {socketConfig.path}</p>
          <p>TIMEOUT: {socketConfig.timeoutMs}ms</p>
          <p className="mt-1 text-cyan-200">STATUS: {socketStatus || 'idle'}</p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <button
            onClick={onStartPracticeGame}
            className="rounded-xl border border-cyan-500/60 bg-cyan-500/10 px-4 py-3 text-sm font-semibold tracking-[0.08em] text-cyan-200 transition hover:bg-cyan-500/20"
          >
            PRACTICE TUG OF WAR
          </button>
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
              setScreen('setup');
            }}
            className="rounded-xl border border-zinc-600 bg-zinc-900 px-4 py-3 text-sm font-semibold tracking-[0.08em] text-zinc-200 transition hover:border-zinc-400 md:col-span-2"
          >
            BACK TO LOBBY
          </button>
        </div>

        {showPracticeGame && (
          <div className="mt-6 rounded-2xl border border-cyan-500/35 bg-cyan-950/20 p-4">
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
                  setShowPracticeGame(false);
                  setIsPracticeRunning(false);
                }}
                className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm font-semibold tracking-[0.08em] text-zinc-200 transition hover:border-zinc-400"
              >
                CLOSE PRACTICE
              </button>
            </div>

            <p className="mt-3 text-sm text-zinc-300">
              {practiceWinner
                ? `RESULT: ${practiceWinner}${practiceResultText ? ` | ${practiceResultText}` : ''}`
                : 'You can only pull your own side. AI automatically pulls the opposite side. Crossing the colored line wins instantly, otherwise winner is decided when time ends.'}
            </p>
          </div>
        )}
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
      }`}
    >
      {isLandingOnly && <div className="landing-event-bg" aria-hidden="true" />}
      {isLandingOnly && <div className="landing-static" aria-hidden="true" />}
      {isLandingOnly && <div className="landing-scanlines" aria-hidden="true" />}
      {isCommandLobby && <div className="command-nebula" aria-hidden="true" />}
      {isCommandLobby && <div className="command-gridflow" aria-hidden="true" />}
      <div className={`relative z-10 w-full ${isLandingOnly ? '' : `mx-auto ${isCommandLobby ? 'max-w-6xl' : 'max-w-4xl'}`}`}>
        {!isLandingOnly && screen !== 'setup' && (
          <header className="mb-4 rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 backdrop-blur-sm md:mb-6 md:px-5">
            <div
              className={`flex flex-wrap items-center justify-between gap-2 text-xs font-semibold tracking-[0.16em] text-zinc-400 ${
                isCommandLobby ? 'arcade-text' : ''
              }`}
            >
              <span>JJAPPATTU FRONTEND</span>
              <span>{screen.toUpperCase()}</span>
            </div>
          </header>
        )}

        {screen === 'setup' && renderSetup()}
        {screen === 'game' && renderGame()}
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
