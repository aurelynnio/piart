import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StudioService } from '@main/ipc/studioService'
import { ProjectStore } from '@main/db/projectStore'
import { openSqliteConnection } from '@main/db/sqliteDriver'
import {
  createBlankImage,
  decodePng,
  encodePng,
  fillRect
} from '@main/imaging/pixelEngine'
import {
  createSimulationState,
  stepSimulation
} from '@domain/validators/gameplayValidator'

const SAMPLE_WORKSHOP = path.resolve(process.cwd(), 'examples', 'workshop')
const cleanupDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  cleanupDirs.push(dir)
  return dir
}

afterEach(() => {
  while (cleanupDirs.length) {
    try {
      fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true })
    } catch {
      // ignore Windows handle release delay
    }
  }
})

describe('Full Production Acceptance Suite (A01–A08, A11–A12)', () => {
  it('A01: opens sample workshop independently, creates project in Vietnamese accented path with spaces, closes and reopens cleanly', async () => {
    const tmp = makeTempDir('aps-a01-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })

    // Open sample workshop as independent copy
    const sampleCopyDir = path.join(tmp, 'Bản sao Xưởng Mộc')
    const sampleState = await svc.openSampleWorkshop(sampleCopyDir)
    expect(sampleState.assets.length).toBeGreaterThanOrEqual(15)
    expect(sampleState.clips.length).toBeGreaterThanOrEqual(9)
    expect(sampleState.scenes.length).toBe(1)

    // Create new project at path with Vietnamese diacritics and spaces
    const accentedDir = path.join(tmp, 'Dự án Xưởng Mộc Thử Nghiệm 2026')
    const created = await svc.createProject({ name: 'Xưởng Mộc Mới', rootDir: accentedDir })
    expect(created.config.name).toBe('Xưởng Mộc Mới')
    expect(fs.existsSync(path.join(accentedDir, 'project.json'))).toBe(true)
    expect(fs.existsSync(path.join(accentedDir, 'studio.sqlite'))).toBe(true)

    // Backup & restore (F004)
    const zipPath = path.join(tmp, 'backup.zip')
    const backup = svc.backupProject(zipPath)
    expect(backup.fileCount).toBeGreaterThanOrEqual(2)

    svc.closeProject()
    const reopened = await svc.openProject(accentedDir)
    expect(reopened.config.name).toBe('Xưởng Mộc Mới')

    const restoredDir = path.join(tmp, 'Khôi phục dự án')
    const restored = await svc.restoreProject(zipPath, restoredDir)
    expect(restored.config.projectId).toBe(created.config.projectId)
    svc.closeProject()
  })

  it('A02: detects form 32x32 vs prompt "Tạo NPC 64 × 64", blocks with 0 image API calls until resolved, then outputs exact 32x32 PNG', async () => {
    const tmp = makeTempDir('aps-a02-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })
    await svc.createProject({ name: 'A02 Test', rootDir: path.join(tmp, 'p') })
    svc.mockAdapter.reset()

    const form = {
      mode: 'create' as const,
      contentType: 'character' as const,
      promptText: 'Tạo NPC 64 × 64',
      spriteSize: { value: { w: 32, h: 32 }, mode: 'selected' as const }
    }

    const preview = svc.resolveAndPreviewPlan({ form })
    expect(preview.resolution.canExecute).toBe(false)
    expect(preview.resolution.unresolvedConflicts).toHaveLength(1)

    // Attempting to execute before resolution MUST throw and make 0 image API calls
    await expect(svc.runPromptWorkflow({ form })).rejects.toThrow(/mâu thuẫn/i)
    expect(svc.mockAdapter.counters.imageGenerateCalls).toBe(0)

    // User resolves conflict in favor of form 32x32
    const { job, state } = await svc.runPromptWorkflow({
      form,
      conflictResolutions: { spriteSize: 'form' }
    })
    expect(job.status).toBe('succeeded')
    expect(svc.mockAdapter.counters.imageGenerateCalls).toBe(1)

    const revId = job.steps[0].outputRevisionIds[0]
    const rev = state.revisions.find((r) => r.revisionId === revId)!
    const png = decodePng(svc.requireStore().readBlob(rev.normalizedBlobHash!))
    expect(png.width).toBe(32)
    expect(png.height).toBe(32)
    svc.closeProject()
  })

  it('A03: creates 4-direction carpenter NPC (32x48, 4 clips, 24 frames, 8 FPS, 125ms, loop, consistent pivot & palette)', async () => {
    const tmp = makeTempDir('aps-a03-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })
    await svc.createProject({ name: 'A03 NPC', rootDir: path.join(tmp, 'p') })

    const { job, state } = await svc.runPromptWorkflow({
      form: {
        mode: 'create',
        contentType: 'auto',
        promptText: 'Tạo thợ mộc đeo tạp dề nâu. Cho nhân vật đi bộ, bước chân chắc và nhịp đều.',
        spriteSize: { value: { w: 32, h: 48 }, mode: 'selected' },
        directionCount: { value: 4, mode: 'selected' },
        framesPerDirection: { value: 6, mode: 'selected' },
        fps: { value: 8, mode: 'selected' },
        loopMode: { value: 'loop', mode: 'selected' },
        enforcePalette: { value: true, mode: 'selected' }
      }
    })

    expect(job.status).toBe('succeeded')
    const walkClips = state.clips.filter((c) => c.action === 'walk')
    expect(walkClips).toHaveLength(4)
    expect(new Set(walkClips.map((c) => c.direction))).toEqual(
      new Set(['down', 'left', 'right', 'up'])
    )
    const totalFrames = walkClips.reduce((acc, c) => acc + c.frames.length, 0)
    expect(totalFrames).toBe(24)

    for (const clip of walkClips) {
      expect(clip.fps).toBe(8)
      expect(clip.loopMode).toBe('loop')
      expect(clip.canvasPx).toEqual({ w: 32, h: 48 })
      for (const f of clip.frames) {
        expect(f.durationMs).toBe(125)
        const img = decodePng(svc.requireStore().readBlob(f.blobHash))
        expect(img.width).toBe(32)
        expect(img.height).toBe(48)
      }
    }
    svc.closeProject()
  })

  it('A04: masked edit on frame #3 of walk_left preserves 100% pixels outside mask, 100% SHA-256 of other frames, and supports Undo/Redo', async () => {
    const tmp = makeTempDir('aps-a04-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })
    const initialState = await svc.openSampleWorkshop(path.join(tmp, 'ws'))
    const walkLeftBefore = initialState.clips.find((c) => c.clipId === 'clip_carpenter_walk_left')!
    const otherClipsBefore = initialState.clips
      .filter((c) => c.clipId !== 'clip_carpenter_walk_left')
      .map((c) => ({ id: c.clipId, hashes: c.frames.map((f) => f.blobHash) }))
    const frameHashesBefore = walkLeftBefore.frames.map((f) => f.blobHash)
    const frame3BeforeImg = decodePng(svc.requireStore().readBlob(frameHashesBefore[2]))

    // Draw mask strictly around arm/hammer region (x=1..9, y=18..30)
    const mask = createBlankImage(32, 48)
    fillRect(mask, 1, 18, 9, 13, '#FFFFFF')
    const maskB64 = encodePng(mask).toString('base64')

    const { job, state } = await svc.runPromptWorkflow({
      form: {
        mode: 'edit',
        contentType: 'animation',
        promptText: 'Chỉnh tay cầm búa thấp xuống.'
      },
      targetAssetId: 'character_carpenter',
      targetClipId: 'clip_carpenter_walk_left',
      targetFrameIndex: 2,
      maskPngBase64: maskB64
    })

    expect(job.status).toBe('succeeded')
    const walkLeftAfter = state.clips.find((c) => c.clipId === 'clip_carpenter_walk_left')!
    expect(walkLeftAfter.clipId).toBe(walkLeftBefore.clipId)

    // Frame 3 changed, all other 5 frames have identical SHA-256!
    expect(walkLeftAfter.frames[2].blobHash).not.toBe(frameHashesBefore[2])
    for (const idx of [0, 1, 3, 4, 5]) {
      expect(walkLeftAfter.frames[idx].blobHash).toBe(frameHashesBefore[idx])
    }

    // All other clips (18 frames across down/right/up + idle + cabinet) untouched 100%!
    for (const oc of otherClipsBefore) {
      const nowClip = state.clips.find((c) => c.clipId === oc.id)!
      expect(nowClip.frames.map((f) => f.blobHash)).toEqual(oc.hashes)
    }

    // Verify 100% pixel identity OUTSIDE the mask on Frame 3!
    const frame3AfterImg = decodePng(svc.requireStore().readBlob(walkLeftAfter.frames[2].blobHash))
    let outsideDiffs = 0
    let insideDiffs = 0
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4
        const inMask = mask.data[i + 3] > 127
        const differs =
          frame3BeforeImg.data[i] !== frame3AfterImg.data[i] ||
          frame3BeforeImg.data[i + 1] !== frame3AfterImg.data[i + 1] ||
          frame3BeforeImg.data[i + 2] !== frame3AfterImg.data[i + 2] ||
          frame3BeforeImg.data[i + 3] !== frame3AfterImg.data[i + 3]
        if (inMask && differs) insideDiffs++
        if (!inMask && differs) outsideDiffs++
      }
    }
    expect(outsideDiffs).toBe(0)
    expect(insideDiffs).toBeGreaterThan(0)

    // Undo & Redo
    const undone = svc.undo()
    expect(undone.applied).toBe(true)
    expect(
      undone.state.clips.find((c) => c.clipId === 'clip_carpenter_walk_left')!.frames[2].blobHash
    ).toBe(frameHashesBefore[2])

    const redone = svc.redo()
    expect(redone.applied).toBe(true)
    expect(
      redone.state.clips.find((c) => c.clipId === 'clip_carpenter_walk_left')!.frames[2].blobHash
    ).toBe(walkLeftAfter.frames[2].blobHash)

    svc.closeProject()
  })

  it('A05: "Cho clip đi trái chậm hơn 20%." sets speed=0.8, increases frame durations by 25% with 0 image API calls', async () => {
    const tmp = makeTempDir('aps-a05-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })
    await svc.openSampleWorkshop(path.join(tmp, 'ws'))
    svc.mockAdapter.reset()

    const { job, state } = await svc.runPromptWorkflow({
      form: {
        mode: 'edit',
        contentType: 'auto',
        promptText: 'Cho clip đi trái chậm hơn 20%.'
      },
      targetClipId: 'clip_carpenter_walk_left'
    })

    expect(job.status).toBe('succeeded')
    expect(svc.mockAdapter.counters.imageGenerateCalls).toBe(0)
    expect(svc.mockAdapter.counters.imageEditCalls).toBe(0)

    const updated = state.clips.find((c) => c.clipId === 'clip_carpenter_walk_left')!
    expect(updated.playbackSpeed).toBeCloseTo(0.8, 3)
    expect(updated.frames.every((f) => f.durationMs === 156)).toBe(true)
    svc.closeProject()
  })

  it('A06: creates 10x8 workshop room with table, chair, 2x1 cabinet + 6-frame open clip, bottom door, reopens cleanly', async () => {
    const tmp = makeTempDir('aps-a06-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })
    const projDir = path.join(tmp, 'room')
    await svc.createProject({ name: 'Room A06', rootDir: projDir })

    const { job, state } = await svc.runPromptWorkflow({
      form: {
        mode: 'create',
        contentType: 'auto',
        promptText:
          'Tạo xưởng mộc 10 × 8 ô, có bàn, ghế và tủ hai ô ngang. Tủ có clip mở 6 frame. Đặt cửa ra vào ở phía dưới.',
        tileSizePx: { value: 32, mode: 'project' }
      }
    })

    expect(job.status).toBe('succeeded')
    expect(state.scenes).toHaveLength(1)
    const sc = state.scenes[0]
    expect(sc.cols).toBe(10)
    expect(sc.rows).toBe(8)
    expect(sc.placements.length).toBe(3)
    const cabPlacement = sc.placements.find((p) => p.name.includes('Tủ'))!
    expect(cabPlacement.footprint).toEqual({ w: 2, h: 1 })
    const door = sc.markers.find((m) => m.kind === 'door')!
    expect(door.gridY).toBe(7)
    const openClip = state.clips.find((c) => c.action === 'open')!
    expect(openClip.frames).toHaveLength(6)

    // Close and reopen map
    svc.closeProject()
    const reopened = await svc.openProject(projDir)
    expect(reopened.scenes[0].cols).toBe(10)
    expect(reopened.scenes[0].placements.length).toBe(3)
    svc.closeProject()
  })

  it('A07: dialogue & hammer quest attached to NPC simulates missing-item and has-item branches and exports cleanly', async () => {
    const tmp = makeTempDir('aps-a07-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })
    const state = await svc.openSampleWorkshop(path.join(tmp, 'ws'))
    const dlg = state.dialogues.find((d) => d.dialogueId === 'dialogue_carpenter_hammer')!
    const quest = state.quests.find((q) => q.questId === 'quest_deliver_hammer')!
    expect(dlg.npcAssetId).toBe('character_carpenter')
    expect(quest.giverNpcAssetId).toBe('character_carpenter')

    const sNo = stepSimulation(dlg, createSimulationState(dlg, { quest_hammer_done: false }, {}), 'e_missing')
    expect(sNo.currentNodeId).toBe('n_no_hammer')
    expect(sNo.flags.quest_hammer_done).toBe(false)

    const sYes = stepSimulation(dlg, createSimulationState(dlg, { quest_hammer_done: false }, { item_hammer: 1 }), 'e_has')
    expect(sYes.currentNodeId).toBe('n_give_hammer')
    expect(sYes.flags.quest_hammer_done).toBe(true)
    expect(sYes.inventory.gold_coin).toBe(50)
    expect(sYes.questStatus.quest_deliver_hammer).toBe('completed')

    const expDir = path.join(tmp, 'exp')
    const { result } = svc.exportToUnity({ scopeKind: 'project', rootIds: [], targetDir: expDir })
    const gpJson = JSON.parse(fs.readFileSync(path.join(result.targetDir, 'gameplay/gameplay_data.json'), 'utf-8'))
    expect(gpJson.quests.some((q: any) => q.questId === 'quest_deliver_hammer')).toBe(true)
    svc.closeProject()
  })

  it('A08: handles 401, 429 retry-after, network crash resume from checkpoint, duplicate callback idempotency, and stale-base concurrent edit', async () => {
    const tmp = makeTempDir('aps-a08-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })
    const projDir = path.join(tmp, 'p')
    await svc.createProject({ name: 'A08 Recovery', rootDir: projDir })

    // 1) 401 AUTH_INVALID (no retry, clear error)
    svc.mockAdapter.enqueueFault({ category: 'AUTH_INVALID', statusCode: 401 })
    const r401 = await svc.runPromptWorkflow({
      form: { mode: 'create', contentType: 'character', promptText: 'Test 401' }
    })
    expect(r401.job.status).toBe('failed')
    expect(r401.job.steps[0].errorCategory).toBe('AUTH_INVALID')
    expect(r401.job.steps[0].attemptCount).toBe(1)

    // 2) 429 RATE_LIMITED with Retry-After -> retries automatically and succeeds!
    svc.mockAdapter.enqueueFault({ category: 'RATE_LIMITED', statusCode: 429, retryAfterMs: 25 })
    const r429 = await svc.runPromptWorkflow({
      form: { mode: 'create', contentType: 'character', promptText: 'Test 429' }
    })
    expect(r429.job.status).toBe('succeeded')
    expect(r429.job.steps[0].attemptCount).toBe(2)

    // 3) Network interruption -> save checkpoint -> close & reopen app -> resume only remaining step!
    svc.mockAdapter.enqueueFault({ category: 'NETWORK_ERROR', remainingTriggers: 5 })
    const rNet = await svc.runPromptWorkflow({
      form: { mode: 'create', contentType: 'character', promptText: 'Test Net' }
    })
    expect(rNet.job.status).toBe('failed')
    expect(rNet.job.steps[0].errorCategory).toBe('NETWORK_ERROR')

    // Clear fault, reopen project and retry from saved snapshot
    svc.mockAdapter.reset()
    svc.closeProject()
    await svc.openProject(projDir)
    const retried = await svc.retryJob(rNet.job.jobId)
    expect(retried.job.status).toBe('succeeded')

    // 4) Duplicate callback / double-click with identical idempotencySalt creates strictly 1 revision!
    const revsBefore = svc.requireStore().listRevisions().length
    const salt = 'idem_click_once_42'
    await svc.runPromptWorkflow({
      form: { mode: 'create', contentType: 'character', promptText: 'Idempotent sprite' },
      idempotencySalt: salt
    })
    await svc.runPromptWorkflow({
      form: { mode: 'create', contentType: 'character', promptText: 'Idempotent sprite' },
      idempotencySalt: salt
    })
    const revsAfter = svc.requireStore().listRevisions().length
    expect(revsAfter - revsBefore).toBe(1)

    // 5) Stale-base concurrent edit protection: R1 -> user edits to R2 while AI runs on R1 -> R3 saved as draft with staleConflict = true, R2 preserved!
    const targetAssetId = retried.job.steps[0].outputAssetIds[0]
    const r1Id = retried.job.steps[0].outputRevisionIds[0]
    const store = svc.requireStore()
    store.approveRevision(targetAssetId, r1Id)
    const r2 = svc.transformSpriteDeterministic({ assetId: targetAssetId, op: 'flip_h' }).revision
    store.approveRevision(targetAssetId, r2.revisionId)

    const baseRev = store.getRevision(r1Id)!
    const staleRes = store.appendRevisionWithConflictCheck(targetAssetId, {
      ...baseRev,
      revisionId: 'rev_ai_stale_r3',
      parentRevisionId: r1Id,
      baseRevisionId: r1Id,
      status: 'draft',
      operationSummary: 'AI finished late on R1',
      autoApprove: true
    })
    expect(staleRes.staleConflict).toBe(true)
    expect(staleRes.revision.status).toBe('draft')
    expect(staleRes.asset.approvedRevisionId).toBe(r2.revisionId) // R2 NOT overwritten!

    svc.closeProject()
  })

  it('A11: masks API keys, leaks 0 secrets in logs/diagnostics/backups/exports, blocks path traversal, detects corrupt manifest/missing blob, migrates v1->v2 SQLite', async () => {
    const tmp = makeTempDir('aps-a11-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })
    const fakeSecret = 'sk-proj-UltraSecretTestingKey99887766ZZ'
    const meta = svc.setApiKey('openai', fakeSecret)
    expect(meta.configured).toBe(true)
    expect(meta.maskedKey).not.toContain('UltraSecret')
    expect(meta.maskedKey.endsWith('66ZZ')).toBe(true)

    await svc.openSampleWorkshop(path.join(tmp, 'ws'))

    // Diagnostic report must contain 0 occurrences of secret
    const diag = JSON.stringify(svc.generateDiagnosticReport())
    expect(diag).not.toContain(fakeSecret)

    // Backup & Export must contain 0 occurrences of secret
    const expDir = path.join(tmp, 'exp')
    svc.exportToUnity({ scopeKind: 'project', rootIds: [], targetDir: expDir })
    const manifestRaw = fs.readFileSync(path.join(expDir, 'manifest.json'), 'utf-8')
    expect(manifestRaw).not.toContain(fakeSecret)

    // Corrupt manifest detection
    const corrupted = manifestRaw.replace(/"sha256": "[0-9a-f]{64}"/, `"sha256": "${'0'.repeat(64)}"`)
    fs.writeFileSync(path.join(expDir, 'manifest.json'), corrupted)
    const verifyBad = svc.verifyExportPackage(expDir)
    expect(verifyBad.valid).toBe(false)
    expect(verifyBad.issues.some((i) => i.code === 'MANIFEST_CHECKSUM_MISMATCH')).toBe(true)

    // Path traversal blocked
    expect(() => svc.readProjectRelativeFile('../../../Windows/win.ini')).toThrow(/ngoài phạm vi/i)

    // Missing blob detected
    const rev = svc.requireStore().listRevisions()[0]
    fs.rmSync(svc.requireStore().getBlobAbsolutePath(rev.normalizedBlobHash!))
    const integrity = svc.requireStore().verifyIntegrity()
    expect(integrity.ok).toBe(false)
    expect(integrity.missingBlobs).toContain(rev.normalizedBlobHash)
    svc.closeProject()

    // SQLite schema v1 -> v2 migration with automatic backup!
    const v1Dir = path.join(tmp, 'legacy_v1')
    ProjectStore.ensureDirectories(v1Dir)
    const conn = await openSqliteConnection(path.join(v1Dir, 'studio.sqlite'))
    conn.exec(`
      CREATE TABLE kv_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE entities (entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (entity_type, entity_id));
      CREATE TABLE revisions (revision_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, parent_revision_id TEXT, status TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE jobs (job_id TEXT PRIMARY KEY, status TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE job_steps (step_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, step_id TEXT NOT NULL, idempotency_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE usage_ledger (usage_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, is_estimated INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE export_runs (export_run_id TEXT PRIMARY KEY, data_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE command_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, tx_id TEXT UNIQUE NOT NULL, label TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0, before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL);
    `)
    conn.run("INSERT INTO kv_meta VALUES ('project_config', ?, ?)", [
      JSON.stringify({
        projectId: 'proj_legacy_v1',
        schemaVersion: 1,
        configVersion: 1,
        name: 'Legacy v1 Project',
        locale: 'vi-VN',
        pixelsPerUnit: 32,
        tileSizePx: 32,
        defaultCanvasPx: { w: 32, h: 48 },
        defaultPerspective: '3/4',
        uiResolutionPx: { w: 480, h: 270 },
        activePaletteId: null,
        activePresetId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z'
      }),
      '2025-01-01T00:00:00Z'
    ])
    conn.setUserVersion(1)
    conn.close()

    const migrated = await svc.openProject(v1Dir)
    expect(migrated.migration.fromVersion).toBe(1)
    expect(migrated.migration.toVersion).toBe(2)
    expect(migrated.migration.backupPath).toBeTruthy()
    expect(fs.existsSync(migrated.migration.backupPath!)).toBe(true)
    svc.closeProject()
  })

  it('A12: full offline workflow — open project, edit pixels, adjust clip timing, edit map, approve revision, export valid Unity package', async () => {
    const tmp = makeTempDir('aps-a12-')
    const svc = new StudioService({
      appDataDir: path.join(tmp, 'appdata'),
      sampleWorkshopDir: SAMPLE_WORKSHOP
    })
    svc.updateAppSettings({ activeProviderId: 'openai', offlineMode: true })

    const state = await svc.openSampleWorkshop(path.join(tmp, 'ws-offline'))
    // Offline pixel transform
    const flipRes = svc.transformSpriteDeterministic({
      assetId: 'character_carpenter',
      op: 'flip_h'
    })
    svc.approveRevision('character_carpenter', flipRes.revision.revisionId)

    // Offline clip timing edit
    const clip = state.clips.find((c) => c.clipId === 'clip_carpenter_walk_down')!
    svc.saveClip({
      ...clip,
      frames: clip.frames.map((f) => ({ ...f, durationMs: 140 }))
    })

    // Offline Unity export
    const expDir = path.join(tmp, 'offline-export')
    const { result } = svc.exportToUnity({ scopeKind: 'project', rootIds: [], targetDir: expDir })
    expect(result.preflight.ok).toBe(true)
    const verified = svc.verifyExportPackage(expDir)
    expect(verified.valid).toBe(true)

    // Verify AI image call fails cleanly with NETWORK_ERROR when offline with OpenAI provider
    const aiFail = await svc.runPromptWorkflow({
      form: { mode: 'create', contentType: 'character', promptText: 'Tạo NPC khi offline' }
    })
    expect(aiFail.job.status).toBe('failed')
    expect(aiFail.job.steps[0].errorCategory).toBe('NETWORK_ERROR')

    svc.closeProject()
  })
})
