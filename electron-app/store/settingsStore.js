const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = {
  workspacePath: '',
  autoApprove: false,
};

function getSettingsFilePath(app) {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getSettings(app) {
  const filePath = getSettingsFilePath(app);

  if (!fs.existsSync(filePath)) {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(app, nextSettings) {
  const filePath = getSettingsFilePath(app);
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(nextSettings || {}),
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
};
