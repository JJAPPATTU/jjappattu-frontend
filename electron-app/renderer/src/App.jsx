import { useEffect, useMemo, useState } from 'react';
import { fileService } from './services.file';
import { createGameSocket, closeGameSocket } from './services.socket';

const DEFAULT_SETTINGS = {
  workspacePath: '',
  autoApprove: false,
};

const PUNISHMENT_COUNT = 3;

function pickRandom(files, count) {
  return [...files].sort(() => Math.random() - 0.5).slice(0, count);
}

function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [files, setFiles] = useState([]);
  const [screen, setScreen] = useState('setup');
  const [connected, setConnected] = useState(false);
  const [pendingDelete, setPendingDelete] = useState([]);
  const [result, setResult] = useState({ deleted: [], skipped: [] });
  const [error, setError] = useState('');
  const [workspaceSelectedThisSession, setWorkspaceSelectedThisSession] = useState(false);

  const canStart = useMemo(() => Boolean(settings.workspacePath), [settings.workspacePath]);
  const isLandingOnly = screen === 'setup' && !workspaceSelectedThisSession;

  useEffect(() => {
    window.electronAPI.getSettings().then((saved) => {
      setSettings(saved);
      if (saved.workspacePath) {
        refreshFiles();
      }
    });

    return () => closeGameSocket();
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
      setError(err.message || '파일 목록 조회 실패');
    }
  }

  async function onSelectWorkspace() {
    const selected = await window.electronAPI.selectWorkspace();
    if (!selected.canceled) {
      setSettings(selected.settings);
      setError('');
      await refreshFiles();
      setWorkspaceSelectedThisSession(true);
    }
  }

  async function onToggleAutoApprove(value) {
    await persistSettings({ ...settings, autoApprove: value });
  }

  async function runPunishment(count) {
    const currentFiles = await fileService.listFiles(true);
    setFiles(currentFiles);

    if (currentFiles.length === 0) {
      setResult({ deleted: [], skipped: [{ file: '-', reason: '파일이 없습니다.' }] });
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

  async function confirmDelete() {
    const deletedResult = await fileService.deleteFiles(pendingDelete);
    setResult(deletedResult);
    setPendingDelete([]);
    setScreen('result');
    await refreshFiles();
  }

  function startGame() {
    setError('');
    setScreen('game');

    createGameSocket({
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
      onLose: () => runPunishment(PUNISHMENT_COUNT),
      onError: (err) => setError(err.message || '소켓 연결 실패'),
    });
  }

  function renderSetup() {
    if (!workspaceSelectedThisSession) {
      return (
        <div className="flex flex-col items-center justify-center">
          <h1 className="mb-8 text-3xl font-extrabold tracking-[0.24em] text-zinc-100 md:text-5xl">JJAPPATTU</h1>
          <button
            onClick={onSelectWorkspace}
            className="rounded-xl border border-cyan-500/60 bg-cyan-500/10 px-7 py-3 text-sm font-bold tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20"
          >
            폴더 선택
          </button>
        </div>
      );
    }

    return (
      <section className="hud-panel rounded-3xl p-5 md:p-7">
        <div className="mb-7 flex items-center justify-between gap-3">
          <h1 className="text-xl font-extrabold tracking-[0.2em] text-zinc-100 md:text-2xl">JJAPPATTU // LOBBY</h1>
          <span className="inline-flex items-center rounded-full border border-emerald-400/60 bg-emerald-400/10 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-300">
            READY
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-zinc-700/80 bg-zinc-950/50 p-4">
            <p className="mb-2 text-xs font-semibold tracking-[0.12em] text-zinc-400">WORKSPACE</p>
            <button
              onClick={onSelectWorkspace}
              className="inline-flex items-center rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-2 text-sm font-semibold tracking-wide text-zinc-100 transition hover:border-cyan-400 hover:text-cyan-200"
            >
              폴더 선택
            </button>
            <p className="mt-3 break-all rounded-lg border border-zinc-800 bg-black/40 p-3 text-sm text-zinc-300">
              {settings.workspacePath || '선택된 폴더 없음'}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-700/80 bg-zinc-950/50 p-4">
            <p className="mb-2 text-xs font-semibold tracking-[0.12em] text-zinc-400">SYSTEM</p>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={settings.autoApprove}
                onChange={(e) => onToggleAutoApprove(e.target.checked)}
                className="mt-1 h-4 w-4 accent-red-600"
              />
              <span>
                <span className="block font-medium">AUTO APPROVE</span>
                <span className="mt-1 block text-xs text-zinc-400">확인 없이 즉시 삭제</span>
              </span>
            </label>

            <div className="mt-4 rounded-lg border border-zinc-800 bg-black/40 p-3 text-sm text-zinc-300">
              파일 수 <span className="font-bold text-zinc-100">{files.length}</span>
            </div>
          </div>
        </div>

        <div className="mt-7">
          <button
            disabled={!canStart}
            onClick={startGame}
            className="w-full rounded-xl border border-red-600/60 bg-red-700/80 px-5 py-3 text-sm font-bold tracking-[0.18em] text-zinc-50 transition hover:bg-red-600 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            START MATCH
          </button>
        </div>
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
          서버에서 <span className="font-semibold text-red-300">game_result: LOSE</span> 이벤트 수신 시 벌칙이 실행됩니다.
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <button
            onClick={() => runPunishment(PUNISHMENT_COUNT)}
            className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm font-semibold tracking-[0.08em] text-amber-200 transition hover:bg-amber-500/20"
          >
            패배 테스트 (수동)
          </button>
          <button
            onClick={() => {
              closeGameSocket();
              setConnected(false);
              setScreen('setup');
            }}
            className="rounded-xl border border-zinc-600 bg-zinc-900 px-4 py-3 text-sm font-semibold tracking-[0.08em] text-zinc-200 transition hover:border-zinc-400"
          >
            로비로 나가기
          </button>
        </div>
      </section>
    );
  }

  function renderResult() {
    return (
      <section className="hud-panel rounded-3xl border-red-900/80 p-5 md:p-7">
        <h2 className="text-xl font-extrabold tracking-[0.2em] text-red-300 md:text-2xl">MISSION FAILED</h2>

        <div className="mt-5 rounded-2xl border border-zinc-700/80 bg-zinc-950/50 p-4">
          <h3 className="text-sm font-bold tracking-[0.1em] text-zinc-200">삭제된 파일</h3>
          <ul className="mt-3 space-y-1 text-sm text-zinc-300">
            {result.deleted.map((f) => (
              <li key={f} className="truncate">• {f}</li>
            ))}
            {result.deleted.length === 0 && <li>• 없음</li>}
          </ul>
        </div>

        {result.skipped.length > 0 && (
          <div className="mt-4 rounded-2xl border border-zinc-700/80 bg-zinc-950/50 p-4">
            <h3 className="text-sm font-bold tracking-[0.1em] text-zinc-200">스킵된 항목</h3>
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
        isLandingOnly ? 'flex items-center justify-center p-4' : 'p-4 md:p-8'
      }`}
    >
      <div className={`w-full ${isLandingOnly ? '' : 'mx-auto max-w-4xl'}`}>
        {!isLandingOnly && (
          <header className="mb-4 rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 backdrop-blur-sm md:mb-6 md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold tracking-[0.16em] text-zinc-400">
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
              <p className="mt-2 text-sm text-zinc-300">아래 파일을 삭제합니다. 계속하시겠습니까?</p>

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
                  취소
                </button>
                <button
                  onClick={confirmDelete}
                  className="rounded-lg border border-red-600/70 bg-red-700/90 px-3 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-red-600"
                >
                  삭제 실행
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-red-900 bg-red-900/30 px-3 py-2 text-sm text-red-200">오류: {error}</p>
        )}
      </div>
    </main>
  );
}

export default App;
