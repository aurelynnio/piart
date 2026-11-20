import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  type Asset,
  type AssetRevision,
  type AttachmentPoint,
  type Clip,
  type Cutscene,
  type DataTable,
  type DialogueGraph,
  type Direction,
  type ExecutionSnapshot,
  type Folder,
  type JobRecord,
  type Layer,
  type NineSliceBorders,
  type Palette,
  type PaletteColor,
  type PointPx,
  type ProjectConfig,
  type PromptTemplate,
  type Quest,
  type RectPx,
  type ReferenceImage,
  type Scene,
  type StateFlag,
  type StylePreset,
  type TileSet,
  type UIScreen,
  type VFXConfig,
  type WorkflowPlan
} from '@domain/schemas/types'
import {
  buildDeterministicWorkflowPlan,
  resolveParameters,
  type PromptFormState,
  type ResolutionResult
} from '@domain/rules/parameterResolver'
import { fpsToFrameDurationMs, slugifyAscii } from '@domain/rules/unityMath'
import { redactDeep } from '@domain/security/redactor'
import { ProjectStore, makeId, type ProjectFullState } from '../db/projectStore'
import { SecretStore, type StoredProviderKeyMeta } from '../security/secretStore'
import { assertPathInsideRoot } from '../security/pathGuard'
import { OpenAIProviderAdapter } from '../providers/openaiAdapter'
import { MockTestAdapter } from '../providers/mockAdapter'
import type { ConnectionCheckResult, ProviderAdapter } from '../providers/adapter'
import { JobQueueExecutor } from '../queue/jobExecutor'
import {
  composeLayers,
  cropAndResizeCanvas,
  decodePng,
  encodePng,
  flipImage,
  quantizeToPalette,
  removeBackgroundAlpha,
  rotate90Image,
  sliceSpriteSheet
} from '../imaging/pixelEngine'
import {
  exportUnityPackage,
  runExportPreflight,
  verifyExportDirectory,
  type ExportExecutionResult,
  type ExportPreflightReport,
  type ExportRequest
} from '../exporter/unityExporter'

export interface RecentProjectItem {
  projectId: string
  name: string
  rootDir: string
  exists: boolean
  lastOpenedAt: string
}

export interface AppSettingsState {
  activeProviderId: 'openai' | 'mock'
  offlineMode: boolean
  models: {
    planner: string
    imageGenerate: string
    imageEdit: string
  }
  recentProjects: RecentProjectItem[]
}

const DEFAULT_SETTINGS: AppSettingsState = {
  activeProviderId: 'mock',
  offlineMode: false,
  models: {
    planner: 'mock-planner-v1',
    imageGenerate: 'mock-image-v1',
    imageEdit: 'mock-image-v1'
  },
  recentProjects: []
}

export class StudioService {
  public readonly appDataDir: string
  public readonly sampleWorkshopDir: string
  public readonly secretStore: SecretStore
  public readonly openaiAdapter: OpenAIProviderAdapter
  public readonly mockAdapter: MockTestAdapter
  public readonly executor: JobQueueExecutor

  private settings: AppSettingsState
  private currentStore: ProjectStore | null = null
  private readonly settingsPath: string
  private readonly logs: Array<{ ts: string; level: string; message: string }> = []

  constructor(params: {
    appDataDir: string
    sampleWorkshopDir: string
    safeStorage?: {
      isEncryptionAvailable(): boolean
      encryptString(s: string): Buffer
      decryptString(b: Buffer): string
    } | null
  }) {
    this.appDataDir = path.resolve(params.appDataDir)
    this.sampleWorkshopDir = path.resolve(params.sampleWorkshopDir)
    fs.mkdirSync(this.appDataDir, { recursive: true })
    this.settingsPath = path.join(this.appDataDir, 'settings.json')
    this.secretStore = new SecretStore(this.appDataDir, params.safeStorage ?? null)
    this.openaiAdapter = new OpenAIProviderAdapter()
    this.mockAdapter = new MockTestAdapter()
    this.settings = this.loadSettings()

    this.executor = new JobQueueExecutor(
      (providerId) => this.getAdapter(providerId),
      (providerId) => this.secretStore.getPlainKey(providerId),
      () => this.settings.offlineMode
    )
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    const clean = redactDeep(message, this.secretStore.getAllSecretValues())
    this.logs.push({ ts: new Date().toISOString(), level, message: clean })
    if (this.logs.length > 500) this.logs.shift()
  }

  private loadSettings(): AppSettingsState {
    if (!fs.existsSync(this.settingsPath)) return structuredClone(DEFAULT_SETTINGS)
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8')) as Partial<AppSettingsState>
      return {
        ...structuredClone(DEFAULT_SETTINGS),
        ...parsed,
        models: { ...DEFAULT_SETTINGS.models, ...(parsed.models ?? {}) },
        recentProjects: Array.isArray(parsed.recentProjects) ? parsed.recentProjects : []
      }
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  private saveSettings(): void {
    const tmp = `${this.settingsPath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf-8')
    fs.renameSync(tmp, this.settingsPath)
  }

  getAdapter(providerId: string): ProviderAdapter {
    if (providerId === 'openai') return this.openaiAdapter
    return this.mockAdapter
  }

  requireStore(): ProjectStore {
    if (!this.currentStore) {
      throw new Error('Chưa có dự án nào đang mở.')
    }
    return this.currentStore
  }

  getCurrentStore(): ProjectStore | null {
    return this.currentStore
  }

  private recordRecent(store: ProjectStore): void {
    const cfg = store.getProjectConfig()
    const list = this.settings.recentProjects.filter((r) => r.rootDir !== store.rootDir)
    list.unshift({
      projectId: cfg.projectId,
      name: cfg.name,
      rootDir: store.rootDir,
      exists: true,
      lastOpenedAt: new Date().toISOString()
    })
    this.settings.recentProjects = list.slice(0, 12)
    this.saveSettings()
  }

  // ---- Project Lifecycle (F001 - F008) ----

  getAppBootstrap() {
    const recents = this.settings.recentProjects.map((r) => ({
      ...r,
      exists: fs.existsSync(path.join(r.rootDir, 'studio.sqlite'))
    }))
    return {
      settings: { ...this.settings, recentProjects: recents },
      providerKeys: {
        openai: this.secretStore.getStatus('openai'),
        mock: this.secretStore.getStatus('mock')
      },
      capabilities: {
        openai: this.openaiAdapter.listCapabilities(),
        mock: this.mockAdapter.listCapabilities()
      },
      sampleWorkshopAvailable: fs.existsSync(path.join(this.sampleWorkshopDir, 'studio.sqlite')),
      currentProject: this.currentStore ? this.currentStore.getFullState() : null
    }
  }

  async createProject(params: {
    name: string
    rootDir: string
    tileSizePx?: number
    pixelsPerUnit?: number
    defaultCanvasPx?: { w: number; h: number }
    defaultPerspective?: 'top-down' | '3/4' | 'side-view'
  }): Promise<ProjectFullState> {
    if (this.currentStore) this.currentStore.close()
    this.currentStore = await ProjectStore.create(params)
    this.recordRecent(this.currentStore)
    this.log('info', `Tạo dự án mới "${params.name}"`)
    return this.currentStore.getFullState()
  }

  async openProject(rootDir: string): Promise<ProjectFullState> {
    if (this.currentStore) this.currentStore.close()
    this.currentStore = await ProjectStore.open(rootDir)
    this.recordRecent(this.currentStore)
    this.log('info', `Mở dự án "${this.currentStore.getProjectConfig().name}"`)
    return this.currentStore.getFullState()
  }

  async openSampleWorkshop(targetDir: string): Promise<ProjectFullState> {
    if (this.currentStore) this.currentStore.close()
    this.currentStore = await ProjectStore.cloneProject(
      this.sampleWorkshopDir,
      targetDir,
      'Xưởng mộc (Bản làm việc)'
    )
    this.recordRecent(this.currentStore)
    this.log('info', 'Nhân bản và mở dự án mẫu Xưởng mộc')
    return this.currentStore.getFullState()
  }

  closeProject(): void {
    if (this.currentStore) {
      this.currentStore.close()
      this.currentStore = null
    }
  }

  backupProject(targetZipPath: string) {
    const store = this.requireStore()
    return store.backupToZip(targetZipPath, this.secretStore.getAllSecretValues())
  }

  async restoreProject(zipPath: string, targetDir: string): Promise<ProjectFullState> {
    if (this.currentStore) this.currentStore.close()
    this.currentStore = await ProjectStore.restoreFromZip(zipPath, targetDir)
    this.recordRecent(this.currentStore)
    return this.currentStore.getFullState()
  }

  updateProjectConfig(patch: Partial<ProjectConfig>): ProjectFullState {
    const store = this.requireStore()
    const cur = store.getProjectConfig()
    store.saveProjectConfig({
      ...cur,
      ...patch,
      configVersion: cur.configVersion + 1
    })
    return store.getFullState()
  }

  saveWorkspaceUiState(uiState: Record<string, unknown>): void {
    if (!this.currentStore) return
    this.currentStore.saveWorkspaceUiState(uiState)
  }

  upsertPalette(palette: Palette, setActive = false): ProjectFullState {
    const store = this.requireStore()
    store.upsertEntity('palette', palette.id, { ...palette, updatedAt: new Date().toISOString() })
    if (setActive) {
      const cfg = store.getProjectConfig()
      store.saveProjectConfig({ ...cfg, activePaletteId: palette.id })
    }
    return store.getFullState()
  }

  upsertPreset(preset: StylePreset, setActive = false): ProjectFullState {
    const store = this.requireStore()
    store.upsertEntity('preset', preset.id, {
      ...preset,
      version: preset.version + 1,
      updatedAt: new Date().toISOString()
    })
    if (setActive) {
      const cfg = store.getProjectConfig()
      store.saveProjectConfig({ ...cfg, activePresetId: preset.id })
    }
    return store.getFullState()
  }

  addReferenceImage(params: {
    name: string
    role: ReferenceImage['role']
    pngBase64: string
    presetId?: string | null
  }): ProjectFullState {
    const store = this.requireStore()
    const buf = Buffer.from(params.pngBase64, 'base64')
    const imported = store.importPngBuffer(`${params.name}.png`, buf)
    const ref: ReferenceImage = {
      id: makeId('ref'),
      name: params.name,
      role: params.role,
      blobHash: imported.sha256,
      width: imported.width,
      height: imported.height,
      createdAt: new Date().toISOString()
    }
    store.upsertEntity('reference_image', ref.id, ref)
    if (params.presetId) {
      const preset = store.getEntity<StylePreset>('preset', params.presetId)
      if (preset && !preset.referenceImageIds.includes(ref.id)) {
        store.upsertEntity('preset', preset.id, {
          ...preset,
          referenceImageIds: [...preset.referenceImageIds, ref.id],
          updatedAt: new Date().toISOString()
        })
      }
    }
    return store.getFullState()
  }

  // ---- Provider Settings & Diagnostics (F101 - F109) ----

  updateAppSettings(patch: Partial<AppSettingsState>) {
    this.settings = {
      ...this.settings,
      ...patch,
      models: { ...this.settings.models, ...(patch.models ?? {}) }
    }
    if (patch.activeProviderId === 'openai' && this.settings.models.planner.startsWith('mock-')) {
      this.settings.models = {
        planner: 'gpt-4.1-mini',
        imageGenerate: 'gpt-image-1',
        imageEdit: 'gpt-image-1'
      }
    } else if (patch.activeProviderId === 'mock' && !this.settings.models.planner.startsWith('mock-')) {
      this.settings.models = {
        planner: 'mock-planner-v1',
        imageGenerate: 'mock-image-v1',
        imageEdit: 'mock-image-v1'
      }
    }
    this.saveSettings()
    return this.getAppBootstrap()
  }

  setApiKey(providerId: string, apiKey: string): StoredProviderKeyMeta {
    const meta = this.secretStore.setKey(providerId, apiKey)
    this.log('info', `Cập nhật API key cho provider ${providerId} (${meta.maskedKey})`)
    return meta
  }

  deleteApiKey(providerId: string): StoredProviderKeyMeta {
    const meta = this.secretStore.deleteKey(providerId)
    this.log('info', `Đã xóa API key cho provider ${providerId}`)
    return meta
  }

  async testProviderConnection(providerId: string): Promise<ConnectionCheckResult> {
    const adapter = this.getAdapter(providerId)
    const key = this.secretStore.getPlainKey(providerId)
    const res = await adapter.validateCredentials(key)
    if (res.ok) this.secretStore.markVerified(providerId)
    this.log(res.ok ? 'info' : 'warn', `Kiểm tra kết nối ${providerId}: ${res.message}`)
    return res
  }

  generateDiagnosticReport(): Record<string, unknown> {
    const secrets = this.secretStore.getAllSecretValues()
    const store = this.currentStore
    const rawReport = {
      generatedAt: new Date().toISOString(),
      platform: `${os.platform()} ${os.release()} (${os.arch()})`,
      nodeVersion: process.version,
      activeProvider: this.settings.activeProviderId,
      offlineMode: this.settings.offlineMode,
      models: this.settings.models,
      providerKeyStatus: {
        openai: this.secretStore.getStatus('openai'),
        mock: this.secretStore.getStatus('mock')
      },
      projectSummary: store
        ? {
            projectId: store.getProjectConfig().projectId,
            name: store.getProjectConfig().name,
            schemaVersion: store.getProjectConfig().schemaVersion,
            sqliteBackend: store.conn.backend,
            integrity: store.verifyIntegrity(),
            assetCount: store.listEntities<Asset>('asset').length,
            clipCount: store.listEntities<Clip>('clip').length,
            jobCount: store.listJobs().length
          }
        : null,
      recentLogs: this.logs.slice(-100)
    }
    return redactDeep(rawReport, secrets)
  }

  // ---- Prompt Resolution, Planning & Execution (F009 - F024) ----

  resolveAndPreviewPlan(params: {
    form: PromptFormState
    targetAssetId?: string | null
    targetClipId?: string | null
    targetFrameIndex?: number | null
    hasMask?: boolean
    conflictResolutions?: Record<string, 'form' | 'prompt'>
    disambiguationSelections?: Record<string, string>
  }): { resolution: ResolutionResult; plan: WorkflowPlan } {
    const store = this.requireStore()
    const cfg = store.getProjectConfig()
    const preset = cfg.activePresetId
      ? store.getEntity<StylePreset>('preset', cfg.activePresetId)
      : null
    const assets = store.listEntities<Asset>('asset')
    const folders = store.listEntities<Folder>('folder')
    const targetAsset = params.targetAssetId
      ? store.getEntity<Asset>('asset', params.targetAssetId)
      : null
    const targetRevId = targetAsset?.approvedRevisionId ?? targetAsset?.latestRevisionId ?? null
    const targetRevision = targetRevId ? store.getRevision(targetRevId) : null
    const targetClip = params.targetClipId
      ? store.getEntity<Clip>('clip', params.targetClipId)
      : null

    const ctx = {
      project: cfg,
      preset,
      assets,
      folders,
      targetAsset,
      targetRevision,
      targetClip,
      targetFrameIndex: params.targetFrameIndex ?? null,
      hasMask: Boolean(params.hasMask),
      conflictResolutions: params.conflictResolutions,
      disambiguationSelections: params.disambiguationSelections
    }

    const resolution = resolveParameters(params.form, ctx)
    const plan = buildDeterministicWorkflowPlan(params.form, resolution, ctx, makeId('plan'))
    return { resolution, plan }
  }

  async runPromptWorkflow(params: {
    form: PromptFormState
    planOverride?: WorkflowPlan | null
    targetAssetId?: string | null
    targetClipId?: string | null
    targetFrameIndex?: number | null
    maskPngBase64?: string | null
    referenceBlobHashes?: string[]
    conflictResolutions?: Record<string, 'form' | 'prompt'>
    disambiguationSelections?: Record<string, string>
    idempotencySalt?: string
  }): Promise<{ job: JobRecord; state: ProjectFullState }> {
    const store = this.requireStore()
    const { resolution, plan: builtPlan } = this.resolveAndPreviewPlan({
      form: params.form,
      targetAssetId: params.targetAssetId,
      targetClipId: params.targetClipId,
      targetFrameIndex: params.targetFrameIndex,
      hasMask: Boolean(params.maskPngBase64),
      conflictResolutions: params.conflictResolutions,
      disambiguationSelections: params.disambiguationSelections
    })

    if (!resolution.canExecute) {
      throw new Error(
        'Vui lòng chốt các thông số mâu thuẫn hoặc đối tượng trùng tên trước khi chạy.'
      )
    }

    const plan = params.planOverride ?? builtPlan
    const cfg = store.getProjectConfig()
    const preset = cfg.activePresetId
      ? store.getEntity<StylePreset>('preset', cfg.activePresetId)
      : null
    const targetAsset = params.targetAssetId
      ? store.getEntity<Asset>('asset', params.targetAssetId)
      : null

    let maskBlobHash: string | null = null
    if (params.maskPngBase64) {
      maskBlobHash = store.saveBlobAtomic(Buffer.from(params.maskPngBase64, 'base64')).sha256
    }

    const snapshot: ExecutionSnapshot = {
      snapshotId: makeId('snap'),
      projectId: cfg.projectId,
      mode: params.form.mode,
      contentType: resolution.resolvedContentType,
      promptText: params.form.promptText,
      resolvedSettings: resolution.resolvedSettings,
      fieldSources: resolution.fieldSources,
      conflictsResolved: resolution.conflicts,
      targetAssetId: params.targetAssetId ?? null,
      targetClipId: params.targetClipId ?? null,
      targetFrameIndex: params.targetFrameIndex ?? null,
      baseRevisionId: targetAsset?.latestRevisionId ?? targetAsset?.approvedRevisionId ?? null,
      maskBlobHash,
      referenceBlobHashes: params.referenceBlobHashes ?? [],
      presetId: preset?.id ?? null,
      presetVersion: preset?.version ?? null,
      templateId: 'planner_v1',
      templateVersion: '1.0.0',
      providerId: this.settings.activeProviderId,
      models: { ...this.settings.models },
      createdAt: new Date().toISOString()
    }

    const jobRecord = this.executor.createJobRecord(store, plan, snapshot, params.idempotencySalt)
    const finished = await this.executor.executeJob(store, jobRecord.jobId)
    return { job: finished, state: store.getFullState() }
  }

  savePromptTemplate(tpl: PromptTemplate): ProjectFullState {
    const store = this.requireStore()
    store.upsertEntity('prompt_template', tpl.templateId, {
      ...tpl,
      updatedAt: new Date().toISOString()
    })
    return store.getFullState()
  }

  deletePromptTemplate(templateId: string): ProjectFullState {
    const store = this.requireStore()
    store.deleteEntity('prompt_template', templateId)
    return store.getFullState()
  }

  // ---- Pixel Art & Sprite Operations (F026, F036 - F045) ----

  readBlobBase64(sha256: string): string {
    const store = this.requireStore()
    return store.readBlob(sha256).toString('base64')
  }

  importPngAsSprite(params: {
    name: string
    pngBase64: string
    assetType?: Asset['type']
    folderId?: string | null
  }): { asset: Asset; revision: AssetRevision; state: ProjectFullState } {
    const store = this.requireStore()
    const buf = Buffer.from(params.pngBase64, 'base64')
    const imported = store.importPngBuffer(`${params.name}.png`, buf)
    const now = new Date().toISOString()
    const assetId = makeId('spr')
    const revId = makeId('rev')

    const asset: Asset = {
      assetId,
      name: params.name,
      slug: slugifyAscii(params.name),
      type: params.assetType ?? 'character',
      description: `Nhập từ PNG (${imported.importRelPath})`,
      folderId: params.folderId ?? null,
      collectionIds: [],
      tags: ['imported'],
      parentAssetId: null,
      approvedRevisionId: revId,
      latestRevisionId: revId,
      metadata: { importRelPath: imported.importRelPath },
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    }
    const rev: AssetRevision = {
      revisionId: revId,
      assetId,
      parentRevisionId: null,
      baseRevisionId: null,
      status: 'approved',
      staleConflict: false,
      rawBlobHash: imported.sha256,
      normalizedBlobHash: imported.sha256,
      maskBlobHash: null,
      canvasPx: { w: imported.width, h: imported.height },
      pivotPx: { x: Math.floor(imported.width / 2), y: imported.height - 1 },
      footprintTiles: params.assetType === 'furniture' ? { w: 1, h: 1 } : null,
      collisionBox: null,
      nineSlice: null,
      layers: [
        {
          id: makeId('lyr'),
          name: 'Lớp nhập PNG',
          visible: true,
          locked: false,
          opacity: 1,
          blobHash: imported.sha256,
          order: 0
        }
      ],
      attachmentPoints: [],
      variantGroupId: null,
      direction: 'down',
      stateName: 'normal',
      settingsSnapshot: {},
      dependencyIds: [],
      operationSummary: 'Nhập PNG',
      createdAt: now
    }
    store.upsertEntity('asset', assetId, asset)
    store.saveRevision(rev)
    return { asset, revision: rev, state: store.getFullState() }
  }

  savePixelEdit(params: {
    assetId: string
    layers: Array<{ id: string; name: string; visible: boolean; locked: boolean; opacity: number; pngBase64: string; order: number }>
    width: number
    height: number
    pivotPx?: PointPx
    attachmentPoints?: AttachmentPoint[]
    nineSlice?: NineSliceBorders | null
    footprintTiles?: { w: number; h: number } | null
    summary?: string
  }): { revision: AssetRevision; state: ProjectFullState } {
    const store = this.requireStore()
    const asset = store.getEntity<Asset>('asset', params.assetId)
    if (!asset) throw new Error('Không tìm thấy asset.')
    const beforeAsset = structuredClone(asset)
    const prevRevId = asset.latestRevisionId ?? asset.approvedRevisionId
    const prevRev = prevRevId ? store.getRevision(prevRevId) : null

    const savedLayers: Layer[] = []
    const decodedLayers: Array<{ image: ReturnType<typeof decodePng>; visible: boolean; opacity: number }> = []
    for (const l of [...params.layers].sort((a, b) => a.order - b.order)) {
      const buf = Buffer.from(l.pngBase64, 'base64')
      const saved = store.saveBlobAtomic(buf)
      savedLayers.push({
        id: l.id,
        name: l.name,
        visible: l.visible,
        locked: l.locked,
        opacity: l.opacity,
        blobHash: saved.sha256,
        order: l.order
      })
      decodedLayers.push({ image: decodePng(buf), visible: l.visible, opacity: l.opacity })
    }

    const flattened = encodePng(composeLayers(params.width, params.height, decodedLayers))
    const flatSaved = store.saveBlobAtomic(flattened)
    const now = new Date().toISOString()
    const newRevId = makeId('rev')

    const newRev: AssetRevision = {
      revisionId: newRevId,
      assetId: asset.assetId,
      parentRevisionId: prevRevId ?? null,
      baseRevisionId: prevRevId ?? null,
      status: 'draft',
      staleConflict: false,
      rawBlobHash: prevRev?.rawBlobHash ?? flatSaved.sha256,
      normalizedBlobHash: flatSaved.sha256,
      maskBlobHash: null,
      canvasPx: { w: params.width, h: params.height },
      pivotPx: params.pivotPx ?? prevRev?.pivotPx ?? { x: Math.floor(params.width / 2), y: params.height - 1 },
      footprintTiles: params.footprintTiles !== undefined ? params.footprintTiles : (prevRev?.footprintTiles ?? null),
      collisionBox: prevRev?.collisionBox ?? null,
      nineSlice: params.nineSlice !== undefined ? params.nineSlice : (prevRev?.nineSlice ?? null),
      layers: savedLayers,
      attachmentPoints: params.attachmentPoints ?? prevRev?.attachmentPoints ?? [],
      variantGroupId: null,
      direction: prevRev?.direction ?? 'down',
      stateName: prevRev?.stateName ?? 'normal',
      settingsSnapshot: {},
      dependencyIds: [],
      operationSummary: params.summary ?? 'Chỉnh sửa pixel art',
      createdAt: now
    }

    store.saveRevision(newRev)
    const updatedAsset: Asset = { ...asset, latestRevisionId: newRevId, updatedAt: now }
    store.upsertEntity('asset', asset.assetId, updatedAsset)
    store.recordTransaction(
      newRev.operationSummary,
      {
        entities: [{ type: 'asset', id: asset.assetId, data: beforeAsset }],
        revisions: [{ revisionId: newRevId, data: null }]
      },
      {
        entities: [{ type: 'asset', id: asset.assetId, data: updatedAsset }],
        revisions: [{ revisionId: newRevId, data: newRev }]
      }
    )
    return { revision: newRev, state: store.getFullState() }
  }

  transformSpriteDeterministic(params: {
    assetId: string
    op: 'flip_h' | 'flip_v' | 'rotate_cw' | 'rotate_ccw' | 'quantize' | 'remove_bg' | 'crop_resize'
    paletteColors?: PaletteColor[]
    dither?: boolean
    colorKeyHex?: string | null
    tolerance?: number
    targetW?: number
    targetH?: number
    anchor?: 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
  }): { revision: AssetRevision; clippedOpaquePixels?: number; state: ProjectFullState } {
    const store = this.requireStore()
    const asset = store.getEntity<Asset>('asset', params.assetId)
    const revId = asset?.latestRevisionId ?? asset?.approvedRevisionId
    const rev = revId ? store.getRevision(revId) : null
    if (!asset || !rev || !rev.normalizedBlobHash) throw new Error('Không có ảnh để biến đổi.')

    const src = decodePng(store.readBlob(rev.normalizedBlobHash))
    let out = src
    let clippedOpaquePixels = 0

    if (params.op === 'flip_h') out = flipImage(src, 'horizontal')
    else if (params.op === 'flip_v') out = flipImage(src, 'vertical')
    else if (params.op === 'rotate_cw') out = rotate90Image(src, true)
    else if (params.op === 'rotate_ccw') out = rotate90Image(src, false)
    else if (params.op === 'quantize') {
      const cfg = store.getProjectConfig()
      const pal = cfg.activePaletteId ? store.getEntity<Palette>('palette', cfg.activePaletteId) : null
      out = quantizeToPalette(src, params.paletteColors ?? pal?.colors ?? [], { dither: params.dither })
    } else if (params.op === 'remove_bg') {
      out = removeBackgroundAlpha(src, { colorKeyHex: params.colorKeyHex, tolerance: params.tolerance })
    } else if (params.op === 'crop_resize') {
      const res = cropAndResizeCanvas(
        src,
        params.targetW ?? src.width,
        params.targetH ?? src.height,
        params.anchor ?? 'bottom-center'
      )
      out = res.image
      clippedOpaquePixels = res.clippedOpaquePixels
    }

    const encoded = encodePng(out)
    const res = this.savePixelEdit({
      assetId: asset.assetId,
      layers: [
        {
          id: makeId('lyr'),
          name: 'Nền chính',
          visible: true,
          locked: false,
          opacity: 1,
          pngBase64: encoded.toString('base64'),
          order: 0
        }
      ],
      width: out.width,
      height: out.height,
      summary: `Biến đổi ${params.op}`
    })
    return { revision: res.revision, clippedOpaquePixels, state: res.state }
  }

  // ---- Animation Timeline Operations (F050 - F063) ----

  saveClip(clip: Clip, label = 'Cập nhật clip'): ProjectFullState {
    const store = this.requireStore()
    const before = store.getEntity<Clip>('clip', clip.clipId)
    const updated: Clip = { ...clip, updatedAt: new Date().toISOString() }
    store.upsertEntity('clip', clip.clipId, updated)
    store.recordTransaction(
      label,
      { entities: [{ type: 'clip', id: clip.clipId, data: before }], revisions: [] },
      { entities: [{ type: 'clip', id: clip.clipId, data: updated }], revisions: [] }
    )
    return store.getFullState()
  }

  duplicateOrReverseClip(clipId: string, reverse: boolean, newActionName?: string): {
    clip: Clip
    state: ProjectFullState
  } {
    const store = this.requireStore()
    const src = store.getEntity<Clip>('clip', clipId)
    if (!src) throw new Error('Không tìm thấy clip nguồn.')
    const now = new Date().toISOString()
    const frames = (reverse ? [...src.frames].reverse() : [...src.frames]).map((f, idx) => ({
      ...f,
      frameId: makeId('frm'),
      slotIndex: idx
    }))
    const action = newActionName || (reverse ? `${src.action}_reverse` : `${src.action}_copy`)
    const cloned: Clip = {
      ...src,
      clipId: makeId('clip'),
      name: `${src.name} (${reverse ? 'Đảo ngược' : 'Bản sao'})`,
      action,
      frames,
      events: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now
    }
    store.upsertEntity('clip', cloned.clipId, cloned)
    return { clip: cloned, state: store.getFullState() }
  }

  importSpriteSheetAsClip(params: {
    assetId: string
    name: string
    action: string
    direction: Direction
    pngBase64: string
    rects: RectPx[]
    fps: number
  }): { clip: Clip; state: ProjectFullState } {
    const store = this.requireStore()
    const sheet = decodePng(Buffer.from(params.pngBase64, 'base64'))
    const slices = sliceSpriteSheet(sheet, params.rects)
    const dur = fpsToFrameDurationMs(params.fps || 8)
    const now = new Date().toISOString()

    const frames = slices.map((slice, idx) => {
      const buf = encodePng(slice)
      const saved = store.saveBlobAtomic(buf)
      const revId = makeId('rev')
      store.saveRevision({
        revisionId: revId,
        assetId: params.assetId,
        parentRevisionId: null,
        baseRevisionId: null,
        status: 'draft',
        staleConflict: false,
        rawBlobHash: saved.sha256,
        normalizedBlobHash: saved.sha256,
        maskBlobHash: null,
        canvasPx: { w: slice.width, h: slice.height },
        pivotPx: { x: Math.floor(slice.width / 2), y: slice.height - 1 },
        footprintTiles: null,
        collisionBox: null,
        nineSlice: null,
        layers: [],
        attachmentPoints: [],
        variantGroupId: null,
        direction: params.direction,
        stateName: null,
        settingsSnapshot: {},
        dependencyIds: [],
        operationSummary: `Tách sprite sheet frame #${idx + 1}`,
        createdAt: now
      })
      return {
        frameId: makeId('frm'),
        slotIndex: idx,
        revisionId: revId,
        blobHash: saved.sha256,
        sourceRect: params.rects[idx],
        durationMs: dur,
        offsetPx: { x: 0, y: 0 },
        isLocked: false,
        isIntentionalHold: false,
        qcWarnings: []
      }
    })

    const w = params.rects[0]?.w ?? 32
    const h = params.rects[0]?.h ?? 32
    const clip: Clip = {
      clipId: makeId('clip'),
      assetId: params.assetId,
      name: params.name,
      action: params.action,
      direction: params.direction,
      fps: params.fps || 8,
      loopMode: 'loop',
      playbackSpeed: 1,
      canvasPx: { w, h },
      anchorPx: { x: Math.floor(w / 2), y: h - 1 },
      frames,
      events: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now
    }
    store.upsertEntity('clip', clip.clipId, clip)
    return { clip, state: store.getFullState() }
  }

  // ---- Tileset, Scene, UI, VFX, Cutscene, Dialogue, Quest, Table CRUD ----

  upsertEntityDirect(type: 'tileset' | 'scene' | 'ui_screen' | 'vfx' | 'cutscene' | 'dialogue' | 'quest' | 'state_flag' | 'data_table' | 'folder' | 'asset', id: string, data: unknown): ProjectFullState {
    const store = this.requireStore()
    store.upsertEntity(type, id, data)
    return store.getFullState()
  }

  // ---- Library, Revision, Trash, Bulk Edit, Duplicate (F093 - F100) ----

  approveRevision(assetId: string, revisionId: string): ProjectFullState {
    const store = this.requireStore()
    store.approveRevision(assetId, revisionId)
    return store.getFullState()
  }

  restoreRevision(assetId: string, revisionId: string): ProjectFullState {
    const store = this.requireStore()
    store.restoreRevisionAsNew(assetId, revisionId)
    return store.getFullState()
  }

  bulkEditAssets(params: {
    assetIds: string[]
    name?: string
    description?: string
    addTags?: string[]
    removeTags?: string[]
    folderId?: string | null
  }): ProjectFullState {
    const store = this.requireStore()
    const beforeEntities: Array<{ type: 'asset'; id: string; data: Asset }> = []
    const afterEntities: Array<{ type: 'asset'; id: string; data: Asset }> = []
    const now = new Date().toISOString()

    for (const id of params.assetIds) {
      const a = store.getEntity<Asset>('asset', id)
      if (!a) continue
      beforeEntities.push({ type: 'asset', id, data: structuredClone(a) })
      const tags = new Set(a.tags)
      for (const t of params.addTags ?? []) tags.add(t)
      for (const t of params.removeTags ?? []) tags.delete(t)
      const next: Asset = {
        ...a,
        name: params.assetIds.length === 1 && params.name ? params.name : a.name,
        slug: params.assetIds.length === 1 && params.name ? slugifyAscii(params.name) : a.slug,
        description: params.description !== undefined ? params.description : a.description,
        folderId: params.folderId !== undefined ? params.folderId : a.folderId,
        tags: [...tags],
        updatedAt: now
      }
      store.upsertEntity('asset', id, next)
      afterEntities.push({ type: 'asset', id, data: next })
    }

    if (beforeEntities.length > 0) {
      store.recordTransaction(
        `Cập nhật ${beforeEntities.length} asset`,
        { entities: beforeEntities, revisions: [] },
        { entities: afterEntities, revisions: [] }
      )
    }
    return store.getFullState()
  }

  duplicateAsset(assetId: string, newName?: string): { asset: Asset; state: ProjectFullState } {
    const store = this.requireStore()
    const src = store.getEntity<Asset>('asset', assetId)
    if (!src) throw new Error('Không tìm thấy asset để nhân bản.')
    const now = new Date().toISOString()
    const newId = makeId(src.type)
    const name = newName || `${src.name} (Bản sao)`
    const revId = src.approvedRevisionId ?? src.latestRevisionId
    const srcRev = revId ? store.getRevision(revId) : null
    let newRevId: string | null = null

    if (srcRev) {
      newRevId = makeId('rev')
      store.saveRevision({
        ...srcRev,
        revisionId: newRevId,
        assetId: newId,
        parentRevisionId: null,
        baseRevisionId: null,
        status: 'draft',
        operationSummary: `Nhân bản từ ${src.name}`,
        createdAt: now
      })
    }

    const cloned: Asset = {
      ...src,
      assetId: newId,
      name,
      slug: slugifyAscii(name),
      approvedRevisionId: null,
      latestRevisionId: newRevId,
      createdAt: now,
      updatedAt: now
    }
    store.upsertEntity('asset', newId, cloned)
    return { asset: cloned, state: store.getFullState() }
  }

  trashAsset(assetId: string): { referencingIds: string[]; state: ProjectFullState } {
    const store = this.requireStore()
    const asset = store.getEntity<Asset>('asset', assetId)
    if (!asset) throw new Error('Không tìm thấy asset.')
    const refs: string[] = []
    for (const sc of store.listEntities<Scene>('scene')) {
      if (sc.placements.some((p) => p.assetId === assetId)) refs.push(sc.sceneId)
    }
    for (const c of store.listEntities<Clip>('clip')) {
      if (c.assetId === assetId) refs.push(c.clipId)
    }
    store.upsertEntity('asset', assetId, { ...asset, trashedAt: new Date().toISOString() })
    return { referencingIds: refs, state: store.getFullState() }
  }

  restoreTrashedAsset(assetId: string): ProjectFullState {
    const store = this.requireStore()
    const asset = store.getEntity<Asset>('asset', assetId)
    if (!asset) throw new Error('Không tìm thấy asset trong thùng rác.')
    store.upsertEntity('asset', assetId, { ...asset, trashedAt: null, updatedAt: new Date().toISOString() })
    return store.getFullState()
  }

  undo(): { applied: boolean; label: string | null; state: ProjectFullState } {
    const store = this.requireStore()
    const res = store.undo()
    return { ...res, state: store.getFullState() }
  }

  redo(): { applied: boolean; label: string | null; state: ProjectFullState } {
    const store = this.requireStore()
    const res = store.redo()
    return { ...res, state: store.getFullState() }
  }

  // ---- Queue Actions ----

  cancelJob(jobId: string): ProjectFullState {
    const store = this.requireStore()
    this.executor.cancelJob(store, jobId)
    return store.getFullState()
  }

  async retryJob(jobId: string): Promise<{ job: JobRecord; state: ProjectFullState }> {
    const store = this.requireStore()
    const job = await this.executor.retryFailedSteps(store, jobId)
    return { job, state: store.getFullState() }
  }

  async resumeInterruptedJobs(): Promise<ProjectFullState> {
    const store = this.requireStore()
    await this.executor.resumeInterruptedJobs(store)
    return store.getFullState()
  }

  // ---- Unity Export & Path-Guarded Reads (F110 - F117, A11) ----

  preflightExport(scopeKind: ExportRequest['scopeKind'], rootIds: string[]): ExportPreflightReport {
    return runExportPreflight(this.requireStore(), scopeKind, rootIds)
  }

  exportToUnity(req: ExportRequest): { result: ExportExecutionResult; state: ProjectFullState } {
    const store = this.requireStore()
    const result = exportUnityPackage(store, {
      ...req,
      extraSecretsToRedact: this.secretStore.getAllSecretValues()
    })
    return { result, state: store.getFullState() }
  }

  verifyExportPackage(exportDir: string) {
    return verifyExportDirectory(exportDir)
  }

  readProjectRelativeFile(relPath: string): string {
    const store = this.requireStore()
    const safeAbs = assertPathInsideRoot(store.rootDir, relPath)
    return fs.readFileSync(safeAbs, 'utf-8')
  }
}
