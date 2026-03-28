export {};

declare global {
  interface Window {
    electronAPI: {
      getSettings: () => Promise<{ workspacePath: string; autoApprove: boolean }>;
      saveSettings: (settings: { workspacePath: string; autoApprove: boolean }) => Promise<{ workspacePath: string; autoApprove: boolean }>;
      selectWorkspace: () => Promise<{ canceled: boolean; workspacePath?: string; settings?: { workspacePath: string; autoApprove: boolean } }>;
      listFiles: (opts?: { recursive?: boolean }) => Promise<string[]>;
      deleteFiles: (relativePaths: string[]) => Promise<{ deleted: string[]; skipped: { file: string; reason: string }[] }>;
      validatePath: (targetPath: string) => Promise<boolean>;
    };
  }
}
