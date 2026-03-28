export const fileService = {
  async listFiles(recursive = true) {
    return window.electronAPI.listFiles({ recursive });
  },
  async deleteFiles(relativePaths) {
    return window.electronAPI.deleteFiles(relativePaths);
  },
};
