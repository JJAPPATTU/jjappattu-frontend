# JJAPPATTU Deployment Playbook

## 1) Backend: Render Free

1. Push this repository to GitHub.
2. In Render, create service using Blueprint from `render.yaml`.
3. Wait until deploy completes.
4. Check health endpoint:
   - `https://<render-domain>/health` -> `{ "ok": true }`

## 2) Desktop release pipeline (download for users)

1. In GitHub repo settings, add variable:
   - `RENDER_BACKEND_URL=https://<render-domain>`
2. Push a version tag:
   - `git tag v0.1.0`
   - `git push origin v0.1.0`
3. GitHub Actions workflow `.github/workflows/desktop-release.yml` runs:
   - Linux/Windows/macOS installers are built
   - Artifacts are attached to GitHub Release
4. Share the Release URL to users for download.

## 3) Manual one-off build (optional)

```bash
cd jjappattu-frontend
cp .env.example .env
# set VITE_SERVER_URL=https://<render-domain>
npm install
npm run dist
```

Artifacts: `jjappattu-frontend/dist/`
