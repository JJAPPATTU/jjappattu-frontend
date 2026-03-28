# jjappattu-frontend

Electron + React client that deletes random files in the selected workspace when server sends a losing result.

## Local data model

- This client treats one computer as one user.
- It creates and stores a device-local `playerId` in browser local storage.
- Friends and match history are also stored locally on that machine only.
- Server remains authoritative for real-time match outcomes.

## Run

```bash
npm install
npm run dev
```

## Build desktop app (installer)

Copy env and set backend URL first:

```bash
cp .env.example .env
# edit .env -> VITE_SERVER_URL=https://<your-render-domain>
```

Build per platform:

```bash
# current platform default
npm run dist

# specific targets
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Build artifacts are generated in `dist/`.

## GitHub Actions release pipeline

- Workflow file: [desktop-release.yml](/home/hefxpzwk/dev/jjappattu/jjappattu-frontend/.github/workflows/desktop-release.yml)
- Trigger:
  - `workflow_dispatch`: run manually with `backend_url` input
  - `git tag vX.Y.Z && git push origin vX.Y.Z`: builds Linux/Windows/macOS and publishes GitHub Release assets
- For tag builds, set repository variable:
  - `RENDER_BACKEND_URL=https://<your-render-domain>`

## Environment

- `VITE_SERVER_URL` (optional): Socket.io server URL (default `http://localhost:3000`)
- `VITE_SOCKET_PATH` (optional): Socket.io path (default `/socket.io`)
- `VITE_SOCKET_TIMEOUT_MS` (optional): Socket handshake timeout in ms (default `5000`)

## Timeout troubleshooting

- `Error: timeout` usually means `VITE_SERVER_URL` is reachable but is not a Socket.IO server.
- Verify the endpoint: `<VITE_SERVER_URL><VITE_SOCKET_PATH>` must be served by your Socket.IO backend.
- Make sure port `3000` is not occupied by another app (for example a Next.js dev server).
- If your backend runs on another port, set `VITE_SERVER_URL` explicitly before `npm run dev`.

## Security notes

- File operations are executed only in Electron main process.
- Renderer sends only relative paths for deletion.
- Main process blocks absolute paths and `../` escape.
- Server does not provide any file name/path.
