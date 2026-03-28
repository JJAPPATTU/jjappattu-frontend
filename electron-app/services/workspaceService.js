const fs = require('node:fs');
const path = require('node:path');

const PROTECTED_FILES = ['important.txt'];

function getRealWorkspacePath(workspacePath) {
  if (!workspacePath) {
    throw new Error('Workspace is not set.');
  }

  const resolvedWorkspace = path.resolve(workspacePath);
  if (!fs.existsSync(resolvedWorkspace)) {
    throw new Error('Workspace does not exist.');
  }

  return fs.realpathSync(resolvedWorkspace);
}

function isInsideWorkspace(workspacePath, targetPath) {
  try {
    const realWorkspace = getRealWorkspacePath(workspacePath);
    const resolvedTarget = path.resolve(targetPath);
    const realTarget = fs.existsSync(resolvedTarget)
      ? fs.realpathSync(resolvedTarget)
      : resolvedTarget;

    return realTarget === realWorkspace || realTarget.startsWith(realWorkspace + path.sep);
  } catch {
    return false;
  }
}

function listWorkspaceFiles(workspacePath, recursive = true) {
  const realWorkspace = getRealWorkspacePath(workspacePath);
  const files = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const rel = path.relative(realWorkspace, fullPath);
      files.push(rel);
    }
  }

  walk(realWorkspace);
  return files;
}

function resolveWorkspaceRelative(workspacePath, relativePath) {
  const realWorkspace = getRealWorkspacePath(workspacePath);

  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('Invalid path value.');
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error('Absolute path is not allowed.');
  }

  const normalizedRelative = path.normalize(relativePath);
  const resolved = path.resolve(realWorkspace, normalizedRelative);

  if (!(resolved === realWorkspace || resolved.startsWith(realWorkspace + path.sep))) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return {
    fullPath: resolved,
    relativePath: path.relative(realWorkspace, resolved),
  };
}

function deleteWorkspaceFiles(workspacePath, relativePaths = []) {
  const deleted = [];
  const skipped = [];

  for (const target of relativePaths) {
    try {
      const { fullPath, relativePath } = resolveWorkspaceRelative(workspacePath, target);

      const basename = path.basename(relativePath);
      if (PROTECTED_FILES.includes(basename)) {
        skipped.push({ file: relativePath, reason: 'protected' });
        continue;
      }

      if (!fs.existsSync(fullPath)) {
        skipped.push({ file: relativePath, reason: 'not_found' });
        continue;
      }

      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) {
        skipped.push({ file: relativePath, reason: 'not_file' });
        continue;
      }

      fs.unlinkSync(fullPath);
      deleted.push(relativePath);
    } catch (err) {
      skipped.push({ file: target, reason: err.message || 'failed' });
    }
  }

  return {
    deleted,
    skipped,
  };
}

module.exports = {
  isInsideWorkspace,
  listWorkspaceFiles,
  deleteWorkspaceFiles,
};
