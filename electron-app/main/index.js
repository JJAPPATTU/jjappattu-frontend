const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');

const {
  getSettings,
  saveSettings,
} = require('../store/settingsStore');
const {
  listWorkspaceFiles,
  deleteWorkspaceFiles,
  isInsideWorkspace,
} = require('../services/workspaceService');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer-dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('settings:get', () => getSettings(app));

  ipcMain.handle('settings:save', (_event, nextSettings) => saveSettings(app, nextSettings));

  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }

    const chosenPath = path.resolve(result.filePaths[0]);
    const settings = getSettings(app);

    return {
      canceled: false,
      workspacePath: chosenPath,
      settings: saveSettings(app, { ...settings, workspacePath: chosenPath }),
    };
  });

  ipcMain.handle('files:list', (_event, { recursive = true } = {}) => {
    const { workspacePath } = getSettings(app);
    return listWorkspaceFiles(workspacePath, recursive);
  });

  ipcMain.handle('files:delete', (_event, relativePaths) => {
    const { workspacePath } = getSettings(app);
    return deleteWorkspaceFiles(workspacePath, relativePaths);
  });

  ipcMain.handle('workspace:validatePath', (_event, targetPath) => {
    const { workspacePath } = getSettings(app);
    return isInsideWorkspace(workspacePath, targetPath);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
