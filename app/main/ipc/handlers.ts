import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'
import type { StudioService } from './studioService'

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(160),
  rootDir: z.string().min(1),
  tileSizePx: z.number().int().min(8).max(256).optional(),
  pixelsPerUnit: z.number().int().min(1).max(512).optional(),
  defaultPerspective: z.enum(['top-down', '3/4', 'side-view']).optional()
})

const PathArgSchema = z.object({
  path: z.string().min(1)
})

const ApiKeySchema = z.object({
  providerId: z.enum(['openai', 'mock']),
  apiKey: z.string().min(1)
})

export function registerIpcHandlers(
  service: StudioService,
  getWindow: () => BrowserWindow | null
): void {
  const handle = <T>(channel: string, fn: (args: any) => Promise<T> | T) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        const data = await fn(payload)
        return { ok: true, data }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    })
  }

  // Forward job updates to renderer
  service.executor.subscribe((ev) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('pixelStudio:jobUpdated', ev.job)
    }
  })

  handle('pixelStudio:bootstrap', () => service.getAppBootstrap())
  handle('pixelStudio:createProject', (p) => service.createProject(CreateProjectSchema.parse(p)))
  handle('pixelStudio:openProject', (p) => service.openProject(PathArgSchema.parse(p).path))
  handle('pixelStudio:openSampleWorkshop', (p) =>
    service.openSampleWorkshop(PathArgSchema.parse(p).path)
  )
  handle('pixelStudio:closeProject', () => {
    service.closeProject()
    return service.getAppBootstrap()
  })
  handle('pixelStudio:backupProject', (p) => service.backupProject(PathArgSchema.parse(p).path))
  handle('pixelStudio:restoreProject', (p) =>
    service.restoreProject(z.string().min(1).parse(p.zipPath), z.string().min(1).parse(p.targetDir))
  )
  handle('pixelStudio:updateProjectConfig', (p) => service.updateProjectConfig(p))
  handle('pixelStudio:saveWorkspaceUiState', (p) => service.saveWorkspaceUiState(p))
  handle('pixelStudio:upsertPalette', (p) => service.upsertPalette(p.palette, Boolean(p.setActive)))
  handle('pixelStudio:upsertPreset', (p) => service.upsertPreset(p.preset, Boolean(p.setActive)))
  handle('pixelStudio:addReferenceImage', (p) => service.addReferenceImage(p))

  // Provider & Settings
  handle('pixelStudio:updateAppSettings', (p) => service.updateAppSettings(p))
  handle('pixelStudio:setApiKey', (p) => {
    const parsed = ApiKeySchema.parse(p)
    return service.setApiKey(parsed.providerId, parsed.apiKey)
  })
  handle('pixelStudio:deleteApiKey', (p) =>
    service.deleteApiKey(z.enum(['openai', 'mock']).parse(p.providerId))
  )
  handle('pixelStudio:testConnection', (p) =>
    service.testProviderConnection(z.enum(['openai', 'mock']).parse(p.providerId))
  )
  handle('pixelStudio:generateDiagnostics', () => service.generateDiagnosticReport())

  // Prompt & Workflow
  handle('pixelStudio:previewPlan', (p) => service.resolveAndPreviewPlan(p))
  handle('pixelStudio:runWorkflow', (p) => service.runPromptWorkflow(p))
  handle('pixelStudio:savePromptTemplate', (p) => service.savePromptTemplate(p))
  handle('pixelStudio:deletePromptTemplate', (p) =>
    service.deletePromptTemplate(z.string().min(1).parse(p.templateId))
  )

  // Pixel & Sprite
  handle('pixelStudio:readBlobBase64', (p) =>
    service.readBlobBase64(z.string().regex(/^[0-9a-f]{64}$/i).parse(p.sha256))
  )
  handle('pixelStudio:importPngAsSprite', (p) => service.importPngAsSprite(p))
  handle('pixelStudio:savePixelEdit', (p) => service.savePixelEdit(p))
  handle('pixelStudio:transformSprite', (p) => service.transformSpriteDeterministic(p))

  // Animation
  handle('pixelStudio:saveClip', (p) => service.saveClip(p.clip, p.label))
  handle('pixelStudio:duplicateOrReverseClip', (p) =>
    service.duplicateOrReverseClip(p.clipId, Boolean(p.reverse), p.newActionName)
  )
  handle('pixelStudio:importSpriteSheet', (p) => service.importSpriteSheetAsClip(p))

  // Direct entity CRUD (tileset, scene, UI, VFX, cutscene, dialogue, quest, state_flag, data_table, folder, asset)
  handle('pixelStudio:upsertEntity', (p) => service.upsertEntityDirect(p.type, p.id, p.data))

  // Library & Revisions & Undo/Redo
  handle('pixelStudio:approveRevision', (p) => service.approveRevision(p.assetId, p.revisionId))
  handle('pixelStudio:restoreRevision', (p) => service.restoreRevision(p.assetId, p.revisionId))
  handle('pixelStudio:bulkEditAssets', (p) => service.bulkEditAssets(p))
  handle('pixelStudio:duplicateAsset', (p) => service.duplicateAsset(p.assetId, p.newName))
  handle('pixelStudio:trashAsset', (p) => service.trashAsset(p.assetId))
  handle('pixelStudio:restoreTrashedAsset', (p) => service.restoreTrashedAsset(p.assetId))
  handle('pixelStudio:undo', () => service.undo())
  handle('pixelStudio:redo', () => service.redo())

  // Queue
  handle('pixelStudio:cancelJob', (p) => service.cancelJob(p.jobId))
  handle('pixelStudio:retryJob', (p) => service.retryJob(p.jobId))
  handle('pixelStudio:resumeJobs', () => service.resumeInterruptedJobs())

  // Export & Security check
  handle('pixelStudio:preflightExport', (p) => service.preflightExport(p.scopeKind, p.rootIds))
  handle('pixelStudio:exportToUnity', (p) => service.exportToUnity(p))
  handle('pixelStudio:verifyExportPackage', (p) =>
    service.verifyExportPackage(PathArgSchema.parse(p).path)
  )
  handle('pixelStudio:readProjectFile', (p) =>
    service.readProjectRelativeFile(z.string().min(1).parse(p.relPath))
  )

  // Native Dialogs
  handle('pixelStudio:pickDirectory', async (p) => {
    const res = await dialog.showOpenDialog({
      title: p?.title || 'Chọn thư mục',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })
  handle('pixelStudio:pickFile', async (p) => {
    const res = await dialog.showOpenDialog({
      title: p?.title || 'Chọn tệp',
      filters: p?.filters ?? [{ name: 'PNG', extensions: ['png'] }],
      properties: ['openFile']
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })
  handle('pixelStudio:pickSaveFile', async (p) => {
    const res = await dialog.showSaveDialog({
      title: p?.title || 'Lưu tệp',
      defaultPath: p?.defaultPath,
      filters: p?.filters ?? [{ name: 'ZIP', extensions: ['zip'] }]
    })
    return res.canceled ? null : res.filePath ?? null
  })
  handle('pixelStudio:openPathInExplorer', async (p) => {
    await shell.openPath(PathArgSchema.parse(p).path)
    return true
  })
}
