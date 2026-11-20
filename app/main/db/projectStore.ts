import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { zipSync, unzipSync } from 'fflate'
import {
  ProjectConfigSchema,
  SCHEMA_VERSION,
  type Asset,
  type AssetRevision,
  type Clip,
  type Cutscene,
  type DataTable,
  type DialogueGraph,
  type Folder,
  type JobRecord,
  type Palette,
  type ProjectConfig,
  type PromptTemplate,
  type Quest,
  type ReferenceImage,
  type Scene,
  type StateFlag,
  type StylePreset,
  type TileSet,
  type UIScreen,
  type UsageLedgerEntry,
  type VFXConfig
} from '@domain/schemas/types'
import { redactDeep } from '@domain/security/redactor'
import { assertPathInsideRoot } from '../security/pathGuard'
import { computeSha256, decodePng, WORKSHOP_PALETTE_HEX } from '../imaging/pixelEngine'
import { openSqliteConnection, type SqliteConnection } from './sqliteDriver'
import { runMigrations, type MigrationResult } from './migrations'

export type EntityTypeKey =
  | 'palette'
  | 'preset'
  | 'reference_image'
  | 'folder'
  | 'asset'
  | 'clip'
  | 'tileset'
  | 'scene'
  | 'ui_screen'
  | 'vfx'
  | 'cutscene'
  | 'dialogue'
  | 'quest'
  | 'state_flag'
  | 'data_table'
  | 'prompt_template'

export interface ProjectFullState {
  rootDir: string
  config: ProjectConfig
  palettes: Palette[]
  presets: StylePreset[]
  referenceImages: ReferenceImage[]
  folders: Folder[]
  assets: Asset[]
  revisions: AssetRevision[]
  clips: Clip[]
  tilesets: TileSet[]
  scenes: Scene[]
  uiScreens: UIScreen[]
  vfxConfigs: VFXConfig[]
  cutscenes: Cutscene[]
  dialogues: DialogueGraph[]
  quests: Quest[]
  stateFlags: StateFlag[]
  dataTables: DataTable[]
  promptTemplates: PromptTemplate[]
  jobs: JobRecord[]
  usageLedger: UsageLedgerEntry[]
  exportRuns: Array<Record<string, unknown>>
  workspaceUiState: Record<string, unknown>
  undoRedo: { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }
  migration: MigrationResult
}

export interface TransactionSnapshotPayload {
  entities: Array<{ type: EntityTypeKey; id: string; data: unknown | null }>
  revisions: Array<{ revisionId: string; data: AssetRevision | null }>
}

function nowIso(): string {
  return new Date().toISOString()
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`
}

export class ProjectStore {
  public readonly rootDir: string
  public readonly conn: SqliteConnection
  public readonly migration: MigrationResult

  private constructor(rootDir: string, conn: SqliteConnection, migration: MigrationResult) {
    this.rootDir = path.resolve(rootDir)
    this.conn = conn
    this.migration = migration
  }

  static ensureDirectories(rootDir: string): void {
    const dirs = ['blobs', 'imports', 'staging', 'exports', 'backups']
    fs.mkdirSync(rootDir, { recursive: true })
    for (const d of dirs) {
      fs.mkdirSync(path.join(rootDir, d), { recursive: true })
    }
  }

  static async create(params: {
    name: string
    rootDir: string
    tileSizePx?: number
    pixelsPerUnit?: number
    defaultCanvasPx?: { w: number; h: number }
    defaultPerspective?: 'top-down' | '3/4' | 'side-view'
  }): Promise<ProjectStore> {
    const absRoot = path.resolve(params.rootDir)
    ProjectStore.ensureDirectories(absRoot)
    const dbPath = path.join(absRoot, 'studio.sqlite')
    const conn = await openSqliteConnection(dbPath)
    const migration = runMigrations(conn, absRoot)
    const store = new ProjectStore(absRoot, conn, migration)

    const ts = nowIso()
    const defaultPaletteId = 'palette_workshop_default'
    const defaultPresetId = 'preset_workshop_default'
    const config: ProjectConfig = ProjectConfigSchema.parse({
      projectId: makeId('proj'),
      schemaVersion: SCHEMA_VERSION,
      configVersion: 1,
      name: params.name.trim() || 'Dự án mới',
      locale: 'vi-VN',
      pixelsPerUnit: params.pixelsPerUnit ?? 32,
      tileSizePx: params.tileSizePx ?? 32,
      defaultCanvasPx: params.defaultCanvasPx ?? { w: 32, h: 48 },
      defaultPerspective: params.defaultPerspective ?? '3/4',
      uiResolutionPx: { w: 480, h: 270 },
      activePaletteId: defaultPaletteId,
      activePresetId: defaultPresetId,
      createdAt: ts,
      updatedAt: ts
    })

    const defaultPalette: Palette = {
      id: defaultPaletteId,
      name: 'Xưởng mộc ấm áp (16 màu)',
      colors: WORKSHOP_PALETTE_HEX.map((hex, i) => ({
        hex,
        name: `Màu ${i + 1}`,
        locked: i === 0
      })),
      createdAt: ts,
      updatedAt: ts
    }

    const defaultPreset: StylePreset = {
      id: defaultPresetId,
      version: 1,
      name: 'Nông trại 3/4 chuẩn',
      perspective: config.defaultPerspective,
      outlineStyle: 'dark',
      shadingStyle: 'cel',
      enforcePalette: true,
      paletteId: defaultPaletteId,
      defaultCanvasPx: config.defaultCanvasPx,
      referenceImageIds: [],
      notes: 'Viền tối sắc nét, không anti-aliasing, ánh sáng ấm từ trên trái.',
      createdAt: ts,
      updatedAt: ts
    }

    store.saveProjectConfig(config)
    store.upsertEntity('palette', defaultPalette.id, defaultPalette)
    store.upsertEntity('preset', defaultPreset.id, defaultPreset)
    return store
  }

  static async open(rootDir: string): Promise<ProjectStore> {
    const absRoot = path.resolve(rootDir)
    const dbPath = path.join(absRoot, 'studio.sqlite')
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Không tìm thấy tệp cơ sở dữ liệu dự án tại "${dbPath}".`)
    }
    ProjectStore.ensureDirectories(absRoot)
    const conn = await openSqliteConnection(dbPath)
    const migration = runMigrations(conn, absRoot)
    const store = new ProjectStore(absRoot, conn, migration)
    store.reconcileStagingOnStartup()
    return store
  }

  static async cloneProject(sourceDir: string, targetDir: string, newName?: string): Promise<ProjectStore> {
    const absSource = path.resolve(sourceDir)
    const absTarget = path.resolve(targetDir)
    if (!fs.existsSync(path.join(absSource, 'studio.sqlite'))) {
      throw new Error(`Dự án nguồn không hợp lệ: "${absSource}".`)
    }
    fs.mkdirSync(absTarget, { recursive: true })
    const copyRec = (src: string, dst: string) => {
      fs.mkdirSync(dst, { recursive: true })
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (entry.name === 'staging' || entry.name.endsWith('-wal') || entry.name.endsWith('-shm')) {
          continue
        }
        const s = path.join(src, entry.name)
        const d = path.join(dst, entry.name)
        if (entry.isDirectory()) copyRec(s, d)
        else fs.copyFileSync(s, d)
      }
    }
    copyRec(absSource, absTarget)
    const store = await ProjectStore.open(absTarget)
    const cfg = store.getProjectConfig()
    cfg.projectId = makeId('proj')
    if (newName) cfg.name = newName
    cfg.updatedAt = nowIso()
    store.saveProjectConfig(cfg)
    return store
  }

  close(): void {
    this.conn.close()
  }

  reconcileStagingOnStartup(): { cleanedFiles: string[] } {
    const stagingDir = path.join(this.rootDir, 'staging')
    const cleanedFiles: string[] = []
    if (!fs.existsSync(stagingDir)) return { cleanedFiles }
    for (const entry of fs.readdirSync(stagingDir)) {
      const full = path.join(stagingDir, entry)
      fs.rmSync(full, { recursive: true, force: true })
      cleanedFiles.push(entry)
    }
    return { cleanedFiles }
  }

  private writeProjectJson(config: ProjectConfig): void {
    const stagingFile = path.join(this.rootDir, 'staging', `project_${Date.now()}.json`)
    const finalFile = path.join(this.rootDir, 'project.json')
    const payload = {
      schemaVersion: config.schemaVersion,
      projectId: config.projectId,
      name: config.name,
      locale: config.locale,
      updatedAt: config.updatedAt
    }
    fs.writeFileSync(stagingFile, JSON.stringify(payload, null, 2), 'utf-8')
    fs.renameSync(stagingFile, finalFile)
  }

  getProjectConfig(): ProjectConfig {
    const row = this.conn.get<{ value_json: string }>(
      "SELECT value_json FROM kv_meta WHERE key = 'project_config'"
    )
    if (!row) {
      throw new Error('Dự án thiếu bản ghi project_config trong SQLite.')
    }
    return ProjectConfigSchema.parse(JSON.parse(row.value_json))
  }

  saveProjectConfig(config: ProjectConfig): ProjectConfig {
    const parsed = ProjectConfigSchema.parse({
      ...config,
      updatedAt: nowIso()
    })
    this.conn.run(
      `INSERT INTO kv_meta (key, value_json, updated_at) VALUES ('project_config', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [JSON.stringify(parsed), parsed.updatedAt]
    )
    this.writeProjectJson(parsed)
    return parsed
  }

  getWorkspaceUiState(): Record<string, unknown> {
    const row = this.conn.get<{ value_json: string }>(
      "SELECT value_json FROM kv_meta WHERE key = 'workspace_ui_state'"
    )
    return row ? (JSON.parse(row.value_json) as Record<string, unknown>) : {}
  }

  saveWorkspaceUiState(state: Record<string, unknown>): void {
    this.conn.run(
      `INSERT INTO kv_meta (key, value_json, updated_at) VALUES ('workspace_ui_state', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [JSON.stringify(state), nowIso()]
    )
  }

  // ---- Atomic Content-Addressed Blobs ----

  getBlobAbsolutePath(sha256: string): string {
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error(`Mã hash blob không hợp lệ: "${sha256}"`)
    }
    const prefix = sha256.slice(0, 2).toLowerCase()
    return assertPathInsideRoot(this.rootDir, path.join('blobs', prefix, `${sha256.toLowerCase()}.png`))
  }

  saveBlobAtomic(pngBuffer: Buffer): { sha256: string; relPath: string; byteSize: number } {
    const sha256 = computeSha256(pngBuffer)
    const targetPath = this.getBlobAbsolutePath(sha256)
    const relPath = path.relative(this.rootDir, targetPath).replace(/\\/g, '/')
    if (fs.existsSync(targetPath)) {
      return { sha256, relPath, byteSize: pngBuffer.byteLength }
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    const tmpPath = path.join(this.rootDir, 'staging', `blob_${sha256}_${Date.now()}.tmp`)
    fs.writeFileSync(tmpPath, pngBuffer)
    fs.renameSync(tmpPath, targetPath)
    return { sha256, relPath, byteSize: pngBuffer.byteLength }
  }

  blobExists(sha256: string): boolean {
    if (!sha256 || !/^[0-9a-f]{64}$/i.test(sha256)) return false
    return fs.existsSync(this.getBlobAbsolutePath(sha256))
  }

  readBlob(sha256: string): Buffer {
    const p = this.getBlobAbsolutePath(sha256)
    if (!fs.existsSync(p)) {
      throw new Error(`Thiếu tệp ảnh blob: ${sha256}`)
    }
    return fs.readFileSync(p)
  }

  importPngBuffer(fileName: string, pngBuffer: Buffer): {
    sha256: string
    width: number
    height: number
    importRelPath: string
  } {
    const decoded = decodePng(pngBuffer)
    const saved = this.saveBlobAtomic(pngBuffer)
    const safeName = `${Date.now()}_${fileName.replace(/[<>:"/\\|?*]/g, '_')}`
    const importPath = assertPathInsideRoot(this.rootDir, path.join('imports', safeName))
    fs.writeFileSync(importPath, pngBuffer)
    return {
      sha256: saved.sha256,
      width: decoded.width,
      height: decoded.height,
      importRelPath: path.relative(this.rootDir, importPath).replace(/\\/g, '/')
    }
  }

  // ---- Generic Entity CRUD ----

  upsertEntity<T>(type: EntityTypeKey, id: string, data: T): T {
    this.conn.run(
      `INSERT INTO entities (entity_type, entity_id, data_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
      [type, id, JSON.stringify(data), nowIso()]
    )
    return data
  }

  getEntity<T>(type: EntityTypeKey, id: string): T | null {
    const row = this.conn.get<{ data_json: string }>(
      'SELECT data_json FROM entities WHERE entity_type = ? AND entity_id = ?',
      [type, id]
    )
    return row ? (JSON.parse(row.data_json) as T) : null
  }

  listEntities<T>(type: EntityTypeKey): T[] {
    const rows = this.conn.all<{ data_json: string }>(
      'SELECT data_json FROM entities WHERE entity_type = ? ORDER BY updated_at ASC',
      [type]
    )
    return rows.map((r) => JSON.parse(r.data_json) as T)
  }

  deleteEntity(type: EntityTypeKey, id: string): void {
    this.conn.run('DELETE FROM entities WHERE entity_type = ? AND entity_id = ?', [type, id])
  }

  // ---- Revision Graph & Stale-Base Protection ----

  saveRevision(rev: AssetRevision): AssetRevision {
    this.conn.run(
      `INSERT OR REPLACE INTO revisions (revision_id, asset_id, parent_revision_id, status, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rev.revisionId, rev.assetId, rev.parentRevisionId, rev.status, JSON.stringify(rev), rev.createdAt]
    )
    return rev
  }

  getRevision(revisionId: string): AssetRevision | null {
    const row = this.conn.get<{ data_json: string }>(
      'SELECT data_json FROM revisions WHERE revision_id = ?',
      [revisionId]
    )
    return row ? (JSON.parse(row.data_json) as AssetRevision) : null
  }

  listRevisions(assetId?: string): AssetRevision[] {
    const rows = assetId
      ? this.conn.all<{ data_json: string }>(
          'SELECT data_json FROM revisions WHERE asset_id = ? ORDER BY created_at ASC',
          [assetId]
        )
      : this.conn.all<{ data_json: string }>(
          'SELECT data_json FROM revisions ORDER BY created_at ASC'
        )
    return rows.map((r) => JSON.parse(r.data_json) as AssetRevision)
  }

  /**
   * Adds a new revision to an existing asset with automatic stale-base conflict detection (A08).
   * If baseRevisionId was supplied and differs from asset.latestRevisionId, saves as draft with staleConflict = true
   * and NEVER overwrites asset.approvedRevisionId!
   */
  appendRevisionWithConflictCheck(
    assetId: string,
    revInput: Omit<AssetRevision, 'staleConflict'> & { autoApprove?: boolean }
  ): { asset: Asset; revision: AssetRevision; staleConflict: boolean } {
    const asset = this.getEntity<Asset>('asset', assetId)
    if (!asset) throw new Error(`Không tìm thấy asset "${assetId}".`)

    const staleConflict =
      Boolean(revInput.baseRevisionId) &&
      Boolean(asset.latestRevisionId) &&
      revInput.baseRevisionId !== asset.latestRevisionId

    const { autoApprove, ...rest } = revInput
    const revision: AssetRevision = {
      ...rest,
      status: staleConflict ? 'draft' : autoApprove ? 'approved' : rest.status,
      staleConflict
    }

    this.saveRevision(revision)
    const updatedAsset: Asset = {
      ...asset,
      latestRevisionId: staleConflict ? asset.latestRevisionId : revision.revisionId,
      approvedRevisionId:
        !staleConflict && autoApprove ? revision.revisionId : asset.approvedRevisionId,
      updatedAt: nowIso()
    }
    this.upsertEntity('asset', assetId, updatedAsset)
    return { asset: updatedAsset, revision, staleConflict }
  }

  approveRevision(assetId: string, revisionId: string): { asset: Asset; revision: AssetRevision } {
    const asset = this.getEntity<Asset>('asset', assetId)
    const rev = this.getRevision(revisionId)
    if (!asset || !rev || rev.assetId !== assetId) {
      throw new Error('Asset hoặc revision không hợp lệ để duyệt.')
    }
    const updatedRev: AssetRevision = { ...rev, status: 'approved', staleConflict: false }
    this.saveRevision(updatedRev)
    const updatedAsset: Asset = {
      ...asset,
      approvedRevisionId: revisionId,
      latestRevisionId: revisionId,
      updatedAt: nowIso()
    }
    this.upsertEntity('asset', assetId, updatedAsset)
    return { asset: updatedAsset, revision: updatedRev }
  }

  restoreRevisionAsNew(assetId: string, sourceRevisionId: string): {
    asset: Asset
    revision: AssetRevision
  } {
    const asset = this.getEntity<Asset>('asset', assetId)
    const src = this.getRevision(sourceRevisionId)
    if (!asset || !src || src.assetId !== assetId) {
      throw new Error('Không tìm thấy revision để khôi phục.')
    }
    const newRev: AssetRevision = {
      ...src,
      revisionId: makeId('rev'),
      parentRevisionId: asset.latestRevisionId,
      baseRevisionId: asset.latestRevisionId,
      status: 'draft',
      staleConflict: false,
      operationSummary: `Khôi phục từ ${sourceRevisionId}`,
      createdAt: nowIso()
    }
    this.saveRevision(newRev)
    const updatedAsset: Asset = {
      ...asset,
      latestRevisionId: newRev.revisionId,
      updatedAt: nowIso()
    }
    this.upsertEntity('asset', assetId, updatedAsset)
    return { asset: updatedAsset, revision: newRev }
  }

  // ---- Jobs, Steps, Usage, Export Runs ----

  saveJob(job: JobRecord): JobRecord {
    const redactedJob = redactDeep(job)
    this.conn.transaction(() => {
      this.conn.run(
        `INSERT OR REPLACE INTO jobs (job_id, status, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          redactedJob.jobId,
          redactedJob.status,
          JSON.stringify(redactedJob),
          redactedJob.createdAt,
          redactedJob.updatedAt
        ]
      )
      for (const step of redactedJob.steps) {
        const stepKey = `${redactedJob.jobId}:${step.stepId}`
        this.conn.run(
          `INSERT OR REPLACE INTO job_steps (step_key, job_id, step_id, idempotency_key, status, data_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            stepKey,
            redactedJob.jobId,
            step.stepId,
            step.idempotencyKey,
            step.status,
            JSON.stringify(step),
            redactedJob.updatedAt
          ]
        )
      }
    })
    return redactedJob
  }

  getJob(jobId: string): JobRecord | null {
    const row = this.conn.get<{ data_json: string }>('SELECT data_json FROM jobs WHERE job_id = ?', [
      jobId
    ])
    return row ? (JSON.parse(row.data_json) as JobRecord) : null
  }

  listJobs(): JobRecord[] {
    const rows = this.conn.all<{ data_json: string }>(
      'SELECT data_json FROM jobs ORDER BY created_at DESC'
    )
    return rows.map((r) => JSON.parse(r.data_json) as JobRecord)
  }

  hasIdempotencyKey(idempotencyKey: string): boolean {
    const row = this.conn.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM job_steps WHERE idempotency_key = ? AND status = 'succeeded'",
      [idempotencyKey]
    )
    return Number(row?.c ?? 0) > 0
  }

  recordUsage(entry: UsageLedgerEntry): UsageLedgerEntry {
    const clean = redactDeep(entry)
    this.conn.run(
      `INSERT OR REPLACE INTO usage_ledger (usage_id, provider_id, model_id, is_estimated, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        clean.usageId,
        clean.providerId,
        clean.modelId,
        clean.isEstimated ? 1 : 0,
        JSON.stringify(clean),
        clean.createdAt
      ]
    )
    return clean
  }

  listUsageLedger(): UsageLedgerEntry[] {
    const rows = this.conn.all<{ data_json: string }>(
      'SELECT data_json FROM usage_ledger ORDER BY created_at DESC'
    )
    return rows.map((r) => JSON.parse(r.data_json) as UsageLedgerEntry)
  }

  saveExportRun(run: Record<string, unknown> & { exportRunId: string; exportedAt: string }): void {
    const clean = redactDeep(run)
    this.conn.run(
      `INSERT OR REPLACE INTO export_runs (export_run_id, data_json, created_at) VALUES (?, ?, ?)`,
      [clean.exportRunId, JSON.stringify(clean), clean.exportedAt]
    )
  }

  listExportRuns(): Array<Record<string, unknown>> {
    const rows = this.conn.all<{ data_json: string }>(
      'SELECT data_json FROM export_runs ORDER BY created_at DESC'
    )
    return rows.map((r) => JSON.parse(r.data_json) as Record<string, unknown>)
  }

  // ---- Persistent Transactional Undo / Redo (F024) ----

  recordTransaction(
    label: string,
    before: TransactionSnapshotPayload,
    after: TransactionSnapshotPayload
  ): string {
    const txId = makeId('tx')
    this.conn.transaction(() => {
      // Clear redo stack on new action
      this.conn.run('DELETE FROM command_history WHERE undone = 1')
      this.conn.run(
        `INSERT INTO command_history (tx_id, label, undone, before_json, after_json, created_at)
         VALUES (?, ?, 0, ?, ?, ?)`,
        [txId, label, JSON.stringify(before), JSON.stringify(after), nowIso()]
      )
    })
    return txId
  }

  private applySnapshotPayload(payload: TransactionSnapshotPayload): void {
    for (const e of payload.entities) {
      if (e.data === null) {
        this.deleteEntity(e.type, e.id)
      } else {
        this.upsertEntity(e.type, e.id, e.data)
      }
    }
    for (const r of payload.revisions) {
      if (r.data === null) {
        this.conn.run('DELETE FROM revisions WHERE revision_id = ?', [r.revisionId])
      } else {
        this.saveRevision(r.data)
      }
    }
  }

  undo(): { applied: boolean; label: string | null } {
    const row = this.conn.get<{ seq: number; label: string; before_json: string }>(
      'SELECT seq, label, before_json FROM command_history WHERE undone = 0 ORDER BY seq DESC LIMIT 1'
    )
    if (!row) return { applied: false, label: null }
    const before = JSON.parse(row.before_json) as TransactionSnapshotPayload
    this.conn.transaction(() => {
      this.applySnapshotPayload(before)
      this.conn.run('UPDATE command_history SET undone = 1 WHERE seq = ?', [row.seq])
    })
    return { applied: true, label: row.label }
  }

  redo(): { applied: boolean; label: string | null } {
    const row = this.conn.get<{ seq: number; label: string; after_json: string }>(
      'SELECT seq, label, after_json FROM command_history WHERE undone = 1 ORDER BY seq ASC LIMIT 1'
    )
    if (!row) return { applied: false, label: null }
    const after = JSON.parse(row.after_json) as TransactionSnapshotPayload
    this.conn.transaction(() => {
      this.applySnapshotPayload(after)
      this.conn.run('UPDATE command_history SET undone = 0 WHERE seq = ?', [row.seq])
    })
    return { applied: true, label: row.label }
  }

  getUndoRedoState(): {
    canUndo: boolean
    canRedo: boolean
    undoLabel: string | null
    redoLabel: string | null
  } {
    const u = this.conn.get<{ label: string }>(
      'SELECT label FROM command_history WHERE undone = 0 ORDER BY seq DESC LIMIT 1'
    )
    const r = this.conn.get<{ label: string }>(
      'SELECT label FROM command_history WHERE undone = 1 ORDER BY seq ASC LIMIT 1'
    )
    return {
      canUndo: Boolean(u),
      canRedo: Boolean(r),
      undoLabel: u?.label ?? null,
      redoLabel: r?.label ?? null
    }
  }

  // ---- Backup & Restore (F004) ----

  backupToZip(targetZipPath: string, extraSecrets: string[] = []): {
    zipPath: string
    sha256: string
    fileCount: number
  } {
    this.conn.flush()
    const files: Record<string, Uint8Array> = {}
    const addFile = (relPath: string, content: Uint8Array) => {
      files[relPath.replace(/\\/g, '/')] = content
    }

    const config = redactDeep(this.getProjectConfig(), extraSecrets)
    addFile('project.json', Buffer.from(JSON.stringify(config, null, 2), 'utf-8'))
    addFile('studio.sqlite', fs.readFileSync(path.join(this.rootDir, 'studio.sqlite')))

    const walkDir = (dirName: string) => {
      const fullDir = path.join(this.rootDir, dirName)
      if (!fs.existsSync(fullDir)) return
      const walk = (cur: string) => {
        for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
          const full = path.join(cur, entry.name)
          if (entry.isDirectory()) walk(full)
          else {
            const rel = path.relative(this.rootDir, full).replace(/\\/g, '/')
            addFile(rel, fs.readFileSync(full))
          }
        }
      }
      walk(fullDir)
    }

    walkDir('blobs')
    walkDir('imports')

    // Compute per-file manifest inside backup
    const checksums: Record<string, string> = {}
    for (const [rel, data] of Object.entries(files)) {
      checksums[rel] = computeSha256(data)
    }
    addFile(
      'backup_manifest.json',
      Buffer.from(
        JSON.stringify(
          {
            backupSchemaVersion: 1,
            createdAt: nowIso(),
            projectId: config.projectId,
            checksums
          },
          null,
          2
        ),
        'utf-8'
      )
    )

    const zipped = zipSync(files, { level: 6 })
    fs.mkdirSync(path.dirname(targetZipPath), { recursive: true })
    const tmp = `${targetZipPath}.tmp`
    fs.writeFileSync(tmp, zipped)
    fs.renameSync(tmp, targetZipPath)
    return {
      zipPath: targetZipPath,
      sha256: computeSha256(zipped),
      fileCount: Object.keys(files).length
    }
  }

  static async restoreFromZip(zipPath: string, targetDir: string): Promise<ProjectStore> {
    const absTarget = path.resolve(targetDir)
    ProjectStore.ensureDirectories(absTarget)
    const rawZip = fs.readFileSync(zipPath)
    const entries = unzipSync(new Uint8Array(rawZip))

    let expectedChecksums: Record<string, string> | null = null
    if (entries['backup_manifest.json']) {
      const bm = JSON.parse(Buffer.from(entries['backup_manifest.json']).toString('utf-8')) as {
        checksums?: Record<string, string>
      }
      expectedChecksums = bm.checksums ?? null
    }

    for (const [rel, data] of Object.entries(entries)) {
      if (rel === 'backup_manifest.json') continue
      const dest = assertPathInsideRoot(absTarget, rel)
      if (expectedChecksums?.[rel]) {
        const actual = computeSha256(data)
        if (actual !== expectedChecksums[rel]) {
          throw new Error(`Tệp sao lưu bị hỏng checksum tại "${rel}".`)
        }
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, Buffer.from(data))
    }

    return ProjectStore.open(absTarget)
  }

  // ---- Integrity Verification (A11) ----

  verifyIntegrity(): { ok: boolean; missingBlobs: string[] } {
    const missing = new Set<string>()
    for (const rev of this.listRevisions()) {
      for (const h of [rev.normalizedBlobHash, rev.rawBlobHash, rev.maskBlobHash]) {
        if (h && !this.blobExists(h)) missing.add(h)
      }
      for (const layer of rev.layers) {
        if (layer.blobHash && !this.blobExists(layer.blobHash)) missing.add(layer.blobHash)
      }
    }
    for (const clip of this.listEntities<Clip>('clip')) {
      for (const f of clip.frames) {
        if (f.blobHash && !this.blobExists(f.blobHash)) missing.add(f.blobHash)
      }
    }
    for (const ts of this.listEntities<TileSet>('tileset')) {
      for (const t of ts.tiles) {
        if (t.blobHash && !this.blobExists(t.blobHash)) missing.add(t.blobHash)
      }
    }
    return { ok: missing.size === 0, missingBlobs: [...missing] }
  }

  getFullState(): ProjectFullState {
    return {
      rootDir: this.rootDir,
      config: this.getProjectConfig(),
      palettes: this.listEntities<Palette>('palette'),
      presets: this.listEntities<StylePreset>('preset'),
      referenceImages: this.listEntities<ReferenceImage>('reference_image'),
      folders: this.listEntities<Folder>('folder'),
      assets: this.listEntities<Asset>('asset'),
      revisions: this.listRevisions(),
      clips: this.listEntities<Clip>('clip'),
      tilesets: this.listEntities<TileSet>('tileset'),
      scenes: this.listEntities<Scene>('scene'),
      uiScreens: this.listEntities<UIScreen>('ui_screen'),
      vfxConfigs: this.listEntities<VFXConfig>('vfx'),
      cutscenes: this.listEntities<Cutscene>('cutscene'),
      dialogues: this.listEntities<DialogueGraph>('dialogue'),
      quests: this.listEntities<Quest>('quest'),
      stateFlags: this.listEntities<StateFlag>('state_flag'),
      dataTables: this.listEntities<DataTable>('data_table'),
      promptTemplates: this.listEntities<PromptTemplate>('prompt_template'),
      jobs: this.listJobs(),
      usageLedger: this.listUsageLedger(),
      exportRuns: this.listExportRuns(),
      workspaceUiState: this.getWorkspaceUiState(),
      undoRedo: this.getUndoRedoState(),
      migration: this.migration
    }
  }
}
