# jjappattu-frontend

Electron + React client that deletes random files in the selected workspace when server sends a losing result.

## Run

```bash
npm install
npm run dev
```

## Environment

- `VITE_SERVER_URL` (optional): Socket.io server URL (default `http://localhost:3000`)

## Security notes

- File operations are executed only in Electron main process.
- Renderer sends only relative paths for deletion.
- Main process blocks absolute paths and `../` escape.
- Server does not provide any file name/path.
