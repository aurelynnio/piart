import { contextBridge, ipcRenderer } from 'electron'

async function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, payload)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
  if (!res.ok) {
    throw new Error(res.error || 'Lỗi IPC không xác định.')
  }
  return res.data
}

const pixelStudioApi = {
  bootstrap: () => invoke('pixelStudio:bootstrap'),
  createProject: (p: unknown) => invoke('pixelStudio:createProject', p),
  openProject: (dirPath: string) => invoke('pixelStudio:openProject', { path: dirPath }),
  openSampleWorkshop: (targetDir: string) =>
    invoke('pixelStudio:openSampleWorkshop', { path: targetDir }),
  closeProject: () => invoke('pixelStudio:closeProject'),
  backupProject: (zipPath: string) => invoke('pixelStudio:backupProject', { path: zipPath }),
  restoreProject: (zipPath: string, targetDir: string) =>
    invoke('pixelStudio:restoreProject', { zipPath, targetDir }),
  updateProjectConfig: (patch: unknown) => invoke('pixelStudio:updateProjectConfig', patch),
  saveWorkspaceUiState: (uiState: unknown) => invoke('pixelStudio:saveWorkspaceUiState', uiState),
  upsertPalette: (palette: unknown, setActive = false) =>
    invoke('pixelStudio:upsertPalette', { palette, setActive }),
  upsertPreset: (preset: unknown, setActive = false) =>
    invoke('pixelStudio:upsertPreset', { preset, setActive }),
  addReferenceImage: (p: unknown) => invoke('pixelStudio:addReferenceImage', p),

  updateAppSettings: (patch: unknown) => invoke('pixelStudio:updateAppSettings', patch),
  setApiKey: (providerId: 'openai' | 'mock', apiKey: string) =>
    invoke('pixelStudio:setApiKey', { providerId, apiKey }),
  deleteApiKey: (providerId: 'openai' | 'mock') =>
    invoke('pixelStudio:deleteApiKey', { providerId }),
  testConnection: (providerId: 'openai' | 'mock') =>
    invoke('pixelStudio:testConnection', { providerId }),
  generateDiagnostics: () => invoke('pixelStudio:generateDiagnostics'),

  previewPlan: (p: unknown) => invoke('pixelStudio:previewPlan', p),
  runWorkflow: (p: unknown) => invoke('pixelStudio:runWorkflow', p),
  savePromptTemplate: (tpl: unknown) => invoke('pixelStudio:savePromptTemplate', tpl),
  deletePromptTemplate: (templateId: string) =>
    invoke('pixelStudio:deletePromptTemplate', { templateId }),

  readBlobBase64: (sha256: string) => invoke<string>('pixelStudio:readBlobBase64', { sha256 }),
  importPngAsSprite: (p: unknown) => invoke('pixelStudio:importPngAsSprite', p),
  savePixelEdit: (p: unknown) => invoke('pixelStudio:savePixelEdit', p),
  transformSprite: (p: unknown) => invoke('pixelStudio:transformSprite', p),

  saveClip: (clip: unknown, label?: string) => invoke('pixelStudio:saveClip', { clip, label }),
  duplicateOrReverseClip: (clipId: string, reverse: boolean, newActionName?: string) =>
    invoke('pixelStudio:duplicateOrReverseClip', { clipId, reverse, newActionName }),
  importSpriteSheet: (p: unknown) => invoke('pixelStudio:importSpriteSheet', p),

  upsertEntity: (type: string, id: string, data: unknown) =>
    invoke('pixelStudio:upsertEntity', { type, id, data }),

  approveRevision: (assetId: string, revisionId: string) =>
    invoke('pixelStudio:approveRevision', { assetId, revisionId }),
  restoreRevision: (assetId: string, revisionId: string) =>
    invoke('pixelStudio:restoreRevision', { assetId, revisionId }),
  bulkEditAssets: (p: unknown) => invoke('pixelStudio:bulkEditAssets', p),
  duplicateAsset: (assetId: string, newName?: string) =>
    invoke('pixelStudio:duplicateAsset', { assetId, newName }),
  trashAsset: (assetId: string) => invoke('pixelStudio:trashAsset', { assetId }),
  restoreTrashedAsset: (assetId: string) => invoke('pixelStudio:restoreTrashedAsset', { assetId }),
  undo: () => invoke('pixelStudio:undo'),
  redo: () => invoke('pixelStudio:redo'),

  cancelJob: (jobId: string) => invoke('pixelStudio:cancelJob', { jobId }),
  retryJob: (jobId: string) => invoke('pixelStudio:retryJob', { jobId }),
  resumeJobs: () => invoke('pixelStudio:resumeJobs'),

  preflightExport: (scopeKind: string, rootIds: string[]) =>
    invoke('pixelStudio:preflightExport', { scopeKind, rootIds }),
  exportToUnity: (req: unknown) => invoke('pixelStudio:exportToUnity', req),
  verifyExportPackage: (dirPath: string) =>
    invoke('pixelStudio:verifyExportPackage', { path: dirPath }),
  readProjectFile: (relPath: string) => invoke<string>('pixelStudio:readProjectFile', { relPath }),

  pickDirectory: (title?: string) => invoke<string | null>('pixelStudio:pickDirectory', { title }),
  pickFile: (title?: string, filters?: Array<{ name: string; extensions: string[] }>) =>
    invoke<string | null>('pixelStudio:pickFile', { title, filters }),
  pickSaveFile: (title?: string, defaultPath?: string) =>
    invoke<string | null>('pixelStudio:pickSaveFile', { title, defaultPath }),
  openPathInExplorer: (p: string) => invoke<boolean>('pixelStudio:openPathInExplorer', { path: p }),

  onJobUpdated: (cb: (job: unknown) => void) => {
    const handler = (_e: unknown, job: unknown) => cb(job)
    ipcRenderer.on('pixelStudio:jobUpdated', handler)
    return () => {
      ipcRenderer.removeListener('pixelStudio:jobUpdated', handler)
    }
  }
}

contextBridge.exposeInMainWorld('pixelStudio', pixelStudioApi)

export type PixelStudioApi = typeof pixelStudioApi
