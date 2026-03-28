# jjappattu-frontend

Electron + React client that deletes random files in the selected workspace when server sends a losing result.

## Run

```bash
npm install
npm run dev
```

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
