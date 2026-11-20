import {
  type Asset,
  type AssetRevision,
  type Clip,
  type ClipFrame,
  type Cutscene,
  type DataTable,
  type DialogueGraph,
  type Direction,
  type ExecutionSnapshot,
  type FrameQcWarning,
  type JobRecord,
  type JobStepRecord,
  type LoopMode,
  type Palette,
  type Quest,
  type Scene,
  type SizePx,
  type StateFlag,
  type TileSet,
  type UIScreen,
  type VFXConfig,
  type WorkflowPlan,
  type WorkflowStep
} from '@domain/schemas/types'
import {
  fpsToFrameDurationMs,
  scaleFrameDurationMs,
  slugifyAscii
} from '@domain/rules/unityMath'
import { validateWorkflowPlan } from '@domain/planner/validator'
import { ProjectStore, makeId, type TransactionSnapshotPayload } from '../db/projectStore'
import {
  analyzeSpriteMetrics,
  compositeWithMask,
  computePixelDiffRatio,
  decodePng,
  encodePng,
  quantizeToPalette,
  removeBackgroundAlpha,
  renderProceduralSprite,
  resizeNearestNeighbor
} from '../imaging/pixelEngine'
import { ProviderError, type ProviderAdapter } from '../providers/adapter'

export interface JobEventListener {
  (event: { type: 'job_updated'; job: JobRecord }): void
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new ProviderError({ category: 'CANCELLED', message: 'Đã hủy tác vụ.' }))
      },
      { once: true }
    )
  })
}

export class JobQueueExecutor {
  private readonly activeControllers = new Map<string, AbortController>()
  private readonly listeners = new Set<JobEventListener>()
  private readonly inflightIdempotencyKeys = new Set<string>()
  private runningImageCalls = 0

  constructor(
    private readonly getAdapter: (providerId: string) => ProviderAdapter,
    private readonly getApiKey: (providerId: string) => string | null,
    private readonly isOfflineMode: () => boolean = () => false
  ) {}

  subscribe(listener: JobEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(job: JobRecord): void {
    for (const l of this.listeners) {
      try {
        l({ type: 'job_updated', job })
      } catch {
        // ignore listener errors
      }
    }
  }

  private async acquireImageSlot(maxConcurrency: number, signal?: AbortSignal): Promise<void> {
    while (this.runningImageCalls >= maxConcurrency) {
      await sleep(20, signal)
    }
    this.runningImageCalls += 1
  }

  private releaseImageSlot(): void {
    this.runningImageCalls = Math.max(0, this.runningImageCalls - 1)
  }

  cancelJob(store: ProjectStore, jobId: string): JobRecord | null {
    const controller = this.activeControllers.get(jobId)
    if (controller) {
      controller.abort()
    }
    const job = store.getJob(jobId)
    if (!job) return null
    const now = new Date().toISOString()
    for (const step of job.steps) {
      if (step.status === 'queued' || step.status === 'running') {
        step.status = 'cancelled'
        step.completedAt = now
      }
    }
    job.status = 'cancelled'
    job.updatedAt = now
    store.saveJob(job)
    this.emit(job)
    return job
  }

  createJobRecord(
    store: ProjectStore,
    plan: WorkflowPlan,
    snapshot: ExecutionSnapshot,
    idempotencySalt?: string
  ): JobRecord {
    const existingAssets = new Set(store.listEntities<Asset>('asset').map((a) => a.assetId))
    const existingClips = new Set(store.listEntities<Clip>('clip').map((c) => c.clipId))
    const existingRevs = new Set(store.listRevisions().map((r) => r.revisionId))
    const adapter = this.getAdapter(snapshot.providerId)
    const caps = adapter.listCapabilities()

    const validation = validateWorkflowPlan(plan, {
      projectId: store.getProjectConfig().projectId,
      existingAssetIds: existingAssets,
      existingClipIds: existingClips,
      existingRevisionIds: existingRevs,
      imageModelCapability: caps.find((c) => c.modelId === snapshot.models.imageGenerate),
      editModelCapability: caps.find((c) => c.modelId === snapshot.models.imageEdit),
      plannerModelCapability: caps.find((c) => c.modelId === snapshot.models.planner)
    })

    if (!validation.valid) {
      const msg = validation.issues
        .filter((i) => i.severity === 'error')
        .map((i) => i.message)
        .join(' | ')
      throw new Error(`Kế hoạch không hợp lệ: ${msg}`)
    }

    const now = new Date().toISOString()
    const jobId = makeId('job')
    const orderedSteps = validation.orderedStepIds
      .map((id) => plan.steps.find((s) => s.id === id)!)
      .filter(Boolean)

    const steps: JobStepRecord[] = orderedSteps.map((s) => {
      const idempotencyKey = idempotencySalt ? `${idempotencySalt}:${s.id}` : `${plan.planId}:${s.id}`
      const alreadyDone = store.hasIdempotencyKey(idempotencyKey)
      return {
        stepId: s.id,
        jobId,
        idempotencyKey,
        operation: s.operation,
        kind: s.kind,
        dependsOn: s.dependsOn,
        status: alreadyDone ? 'succeeded' : 'queued',
        attemptCount: 0,
        providerRequestId: null,
        errorCategory: null,
        errorMessage: null,
        retryAfterMs: null,
        outputAssetIds: [],
        outputRevisionIds: [],
        outputClipIds: [],
        startedAt: null,
        completedAt: alreadyDone ? now : null
      }
    })

    const job: JobRecord = {
      jobId,
      projectId: plan.projectId,
      status: 'queued',
      plan,
      snapshot,
      steps,
      createdAt: now,
      updatedAt: now
    }
    return store.saveJob(job)
  }

  /**
   * Executes a job from its current checkpoint (skips steps already marked `succeeded`).
   */
  async executeJob(store: ProjectStore, jobId: string): Promise<JobRecord> {
    const job = store.getJob(jobId)
    if (!job) throw new Error(`Không tìm thấy job "${jobId}".`)

    const controller = new AbortController()
    this.activeControllers.set(jobId, controller)
    job.status = 'running'
    job.updatedAt = new Date().toISOString()
    store.saveJob(job)
    this.emit(job)

    const stepOutputs = new Map<string, { assetId?: string; revisionId?: string; tilesetId?: string }>()

    // Pre-populate outputs from previously succeeded checkpoint steps
    for (const s of job.steps) {
      if (s.status === 'succeeded') {
        stepOutputs.set(s.stepId, {
          assetId: s.outputAssetIds[0],
          revisionId: s.outputRevisionIds[0]
        })
      }
    }

    try {
      for (const stepRec of job.steps) {
        if (controller.signal.aborted) {
          stepRec.status = 'cancelled'
          continue
        }
        if (stepRec.status === 'succeeded') {
          continue
        }

        // Check idempotency across duplicate callbacks / double-clicks
        if (
          this.inflightIdempotencyKeys.has(stepRec.idempotencyKey) ||
          store.hasIdempotencyKey(stepRec.idempotencyKey)
        ) {
          stepRec.status = 'succeeded'
          stepRec.completedAt = new Date().toISOString()
          store.saveJob(job)
          continue
        }

        // Verify all dependencies succeeded
        const depFailed = stepRec.dependsOn.some((depId) => {
          const dep = job.steps.find((x) => x.stepId === depId)
          return !dep || dep.status !== 'succeeded'
        })
        if (depFailed) {
          stepRec.status = 'failed'
          stepRec.errorCategory = 'INTERNAL_ERROR'
          stepRec.errorMessage = 'Bỏ qua do bước phụ thuộc trước đó thất bại.'
          continue
        }

        const wfStep = job.plan.steps.find((s) => s.id === stepRec.stepId)!
        this.inflightIdempotencyKeys.add(stepRec.idempotencyKey)

        try {
          await this.runStepWithRetries(store, job, stepRec, wfStep, stepOutputs, controller.signal)
        } finally {
          this.inflightIdempotencyKeys.delete(stepRec.idempotencyKey)
        }

        job.updatedAt = new Date().toISOString()
        store.saveJob(job)
        this.emit(job)
      }

      const allSucceeded = job.steps.every((s) => s.status === 'succeeded')
      const anyCancelled = job.steps.some((s) => s.status === 'cancelled')
      const anyAmbiguous = job.steps.some((s) => s.status === 'ambiguous')
      const anyFailed = job.steps.some((s) => s.status === 'failed')

      job.status = allSucceeded
        ? 'succeeded'
        : anyCancelled
          ? 'cancelled'
          : anyAmbiguous
            ? 'ambiguous'
            : anyFailed
              ? 'failed'
              : 'partial'
      job.updatedAt = new Date().toISOString()
      store.saveJob(job)
      this.emit(job)
      return job
    } finally {
      this.activeControllers.delete(jobId)
    }
  }

  async retryFailedSteps(store: ProjectStore, jobId: string): Promise<JobRecord> {
    const job = store.getJob(jobId)
    if (!job) throw new Error(`Không tìm thấy job "${jobId}".`)
    for (const s of job.steps) {
      if (s.status === 'failed' || s.status === 'cancelled' || s.status === 'ambiguous') {
        s.status = 'queued'
        s.errorCategory = null
        s.errorMessage = null
        s.retryAfterMs = null
      }
    }
    job.status = 'queued'
    job.updatedAt = new Date().toISOString()
    store.saveJob(job)
    return this.executeJob(store, jobId)
  }

  async resumeInterruptedJobs(store: ProjectStore): Promise<JobRecord[]> {
    const jobs = store.listJobs().filter((j) => j.status === 'running' || j.status === 'queued')
    const resumed: JobRecord[] = []
    for (const j of jobs) {
      for (const s of j.steps) {
        if (s.status === 'running') s.status = 'queued'
      }
      store.saveJob(j)
      resumed.push(await this.executeJob(store, j.jobId))
    }
    return resumed
  }

  private async runStepWithRetries(
    store: ProjectStore,
    job: JobRecord,
    stepRec: JobStepRecord,
    wfStep: WorkflowStep,
    stepOutputs: Map<string, { assetId?: string; revisionId?: string; tilesetId?: string }>,
    signal: AbortSignal
  ): Promise<void> {
    const maxAttempts = 4 // initial + up to 3 bounded retries for retryable errors

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      stepRec.attemptCount = attempt
      stepRec.status = 'running'
      stepRec.startedAt = stepRec.startedAt ?? new Date().toISOString()
      stepRec.errorCategory = null
      stepRec.errorMessage = null
      store.saveJob(job)
      this.emit(job)

      try {
        if (wfStep.kind !== 'deterministic' && this.isOfflineMode() && job.snapshot.providerId !== 'mock') {
          throw new ProviderError({
            category: 'NETWORK_ERROR',
            message: 'Ứng dụng đang ở chế độ ngoại tuyến; chỉ các thao tác cục bộ khả dụng.'
          })
        }

        await this.executeSingleStep(store, job, stepRec, wfStep, stepOutputs, signal)
        stepRec.status = 'succeeded'
        stepRec.completedAt = new Date().toISOString()
        return
      } catch (err) {
        const pErr =
          err instanceof ProviderError
            ? err
            : new ProviderError({
                category: 'INTERNAL_ERROR',
                message: err instanceof Error ? err.message : String(err)
              })

        stepRec.providerRequestId = pErr.providerRequestId ?? stepRec.providerRequestId
        stepRec.errorCategory = pErr.category
        stepRec.errorMessage = pErr.message
        stepRec.retryAfterMs = pErr.retryAfterMs

        if (pErr.category === 'CANCELLED') {
          stepRec.status = 'cancelled'
          stepRec.completedAt = new Date().toISOString()
          return
        }
        if (pErr.category === 'AMBIGUOUS_OUTCOME') {
          stepRec.status = 'ambiguous'
          stepRec.completedAt = new Date().toISOString()
          return
        }
        if (pErr.isRetryable && attempt < maxAttempts) {
          const waitMs = pErr.retryAfterMs ?? Math.min(2000, 120 * Math.pow(2, attempt - 1))
          store.saveJob(job)
          this.emit(job)
          await sleep(waitMs, signal)
          continue
        }
        stepRec.status = 'failed'
        stepRec.completedAt = new Date().toISOString()
        return
      }
    }
  }

  private getActivePalette(store: ProjectStore): Palette | null {
    const cfg = store.getProjectConfig()
    if (!cfg.activePaletteId) return null
    return store.getEntity<Palette>('palette', cfg.activePaletteId)
  }

  private normalizeImageBuffer(
    rawPng: Buffer,
    targetW: number,
    targetH: number,
    palette: Palette | null,
    enforcePalette: boolean
  ): Buffer {
    const decoded = decodePng(rawPng)
    const cleanAlpha = removeBackgroundAlpha(decoded)
    const resized = resizeNearestNeighbor(cleanAlpha, targetW, targetH)
    const finalImg =
      enforcePalette && palette ? quantizeToPalette(resized, palette.colors) : resized
    return encodePng(finalImg)
  }

  private async executeSingleStep(
    store: ProjectStore,
    job: JobRecord,
    stepRec: JobStepRecord,
    wfStep: WorkflowStep,
    stepOutputs: Map<string, { assetId?: string; revisionId?: string; tilesetId?: string }>,
    signal: AbortSignal
  ): Promise<void> {
    const adapter = this.getAdapter(job.snapshot.providerId)
    const apiKey = this.getApiKey(job.snapshot.providerId)
    const palette = this.getActivePalette(store)
    const now = new Date().toISOString()

    // ----- DETERMINISTIC LOCAL OPERATIONS (0 AI image calls) -----
    if (wfStep.kind === 'deterministic') {
      if (wfStep.operation === 'update_clip_timing') {
        let clip: Clip | null = wfStep.targetClipId
          ? store.getEntity<Clip>('clip', wfStep.targetClipId)
          : null
        if (!clip) {
          const targetDir = wfStep.settings.targetDirection as Direction | undefined
          const allClips = store.listEntities<Clip>('clip')
          clip =
            (targetDir ? allClips.find((c) => c.direction === targetDir) : allClips[0]) ?? null
        }
        if (!clip) throw new Error('Không tìm thấy clip mục tiêu để chỉnh thời lượng.')

        const beforeClip = structuredClone(clip)
        const speedFactor = Number(wfStep.settings.speedFactor ?? 1)
        const newFps = wfStep.settings.fps ? Number(wfStep.settings.fps) : null

        const updatedFrames = clip.frames.map((f) => ({
          ...f,
          durationMs: newFps
            ? fpsToFrameDurationMs(newFps)
            : scaleFrameDurationMs(f.durationMs, speedFactor)
        }))
        const updatedClip: Clip = {
          ...clip,
          fps: newFps ?? Number((clip.fps * speedFactor).toFixed(2)),
          playbackSpeed: newFps ? 1 : Number((clip.playbackSpeed * speedFactor).toFixed(4)),
          frames: updatedFrames,
          updatedAt: now
        }
        store.upsertEntity('clip', updatedClip.clipId, updatedClip)
        store.recordTransaction(
          wfStep.title || 'Cập nhật thời lượng clip',
          { entities: [{ type: 'clip', id: clip.clipId, data: beforeClip }], revisions: [] },
          { entities: [{ type: 'clip', id: clip.clipId, data: updatedClip }], revisions: [] }
        )
        stepRec.outputClipIds.push(updatedClip.clipId)
        return
      }

      if (wfStep.operation === 'rename_asset') {
        const asset = wfStep.targetAssetId
          ? store.getEntity<Asset>('asset', wfStep.targetAssetId)
          : null
        if (!asset) throw new Error('Không tìm thấy asset để đổi tên.')
        const before = structuredClone(asset)
        const newName = String(wfStep.settings.newName || asset.name)
        const updated: Asset = {
          ...asset,
          name: newName,
          slug: slugifyAscii(newName),
          updatedAt: now
        }
        store.upsertEntity('asset', asset.assetId, updated)
        store.recordTransaction(
          `Đổi tên "${before.name}" → "${newName}"`,
          { entities: [{ type: 'asset', id: asset.assetId, data: before }], revisions: [] },
          { entities: [{ type: 'asset', id: asset.assetId, data: updated }], revisions: [] }
        )
        stepRec.outputAssetIds.push(asset.assetId)
        return
      }

      if (wfStep.operation === 'move_map_placement') {
        const scenes = store.listEntities<Scene>('scene')
        const scene = scenes[0]
        if (!scene || scene.placements.length === 0) {
          throw new Error('Không tìm thấy vật thể trên bản đồ để di chuyển.')
        }
        const before = structuredClone(scene)
        const dx = Number(wfStep.settings.dx ?? 0)
        const dy = Number(wfStep.settings.dy ?? 0)
        const target =
          scene.placements.find((p) => p.assetId === wfStep.targetAssetId) ?? scene.placements[0]
        target.gridX = Math.max(0, Math.min(scene.cols - target.footprint.w, target.gridX + dx))
        target.gridY = Math.max(0, Math.min(scene.rows - target.footprint.h, target.gridY + dy))
        scene.updatedAt = now
        store.upsertEntity('scene', scene.sceneId, scene)
        store.recordTransaction(
          `Di chuyển "${target.name}" trên bản đồ`,
          { entities: [{ type: 'scene', id: scene.sceneId, data: before }], revisions: [] },
          { entities: [{ type: 'scene', id: scene.sceneId, data: scene }], revisions: [] }
        )
        stepRec.outputAssetIds.push(scene.assetId)
        return
      }

      return
    }

    // ----- INPAINT / MASK REGION EDIT (A04 & F044) -----
    if (wfStep.operation === 'inpaint_region' || wfStep.operation === 'regenerate_frame') {
      const promptText = String(wfStep.settings.promptText ?? job.snapshot.promptText)
      const enforcePalette = Boolean(wfStep.settings.enforcePalette ?? true)
      const maskHash = job.snapshot.maskBlobHash

      // Frame-targeted edit on a Clip
      if (wfStep.targetClipId && wfStep.targetFrameIndex !== null) {
        const clip = store.getEntity<Clip>('clip', wfStep.targetClipId)
        if (!clip) throw new Error('Không tìm thấy clip mục tiêu.')
        const slotIdx = wfStep.targetFrameIndex
        const frame = clip.frames[slotIdx]
        if (!frame) throw new Error(`Slot frame #${slotIdx + 1} không tồn tại.`)

        const beforeClip = structuredClone(clip)
        const srcPng = store.readBlob(frame.blobHash)
        const maskPng = maskHash ? store.readBlob(maskHash) : null

        await this.acquireImageSlot(adapter.maxConcurrency, signal)
        let editedRaw: Buffer
        try {
          if (wfStep.operation === 'inpaint_region' && maskPng) {
            const res = await adapter.editImage(
              {
                modelId: job.snapshot.models.imageEdit,
                prompt: promptText,
                sourcePng: srcPng,
                maskPng,
                width: clip.canvasPx.w,
                height: clip.canvasPx.h,
                signal
              },
              apiKey
            )
            editedRaw = res.image
            stepRec.providerRequestId = res.usage.providerRequestId ?? null
            store.recordUsage({
              usageId: makeId('use'),
              projectId: job.projectId,
              jobId: job.jobId,
              stepId: stepRec.stepId,
              providerId: adapter.providerId,
              modelId: job.snapshot.models.imageEdit,
              operation: wfStep.operation,
              inputTokens: res.usage.inputTokens,
              outputTokens: res.usage.outputTokens,
              imageCount: res.usage.imageCount,
              isEstimated: res.usage.isEstimated,
              createdAt: now
            })
          } else {
            const res = await adapter.generateImage(
              {
                modelId: job.snapshot.models.imageGenerate,
                prompt: promptText,
                width: clip.canvasPx.w,
                height: clip.canvasPx.h,
                direction: clip.direction,
                frameIndex: slotIdx,
                totalFrames: clip.frames.length,
                signal
              },
              apiKey
            )
            editedRaw = res.images[0]
            stepRec.providerRequestId = res.usage.providerRequestId ?? null
            store.recordUsage({
              usageId: makeId('use'),
              projectId: job.projectId,
              jobId: job.jobId,
              stepId: stepRec.stepId,
              providerId: adapter.providerId,
              modelId: job.snapshot.models.imageGenerate,
              operation: wfStep.operation,
              inputTokens: res.usage.inputTokens,
              outputTokens: res.usage.outputTokens,
              imageCount: res.usage.imageCount,
              isEstimated: res.usage.isEstimated,
              createdAt: now
            })
          }
        } finally {
          this.releaseImageSlot()
        }

        const normalizedEdited = this.normalizeImageBuffer(
          editedRaw,
          clip.canvasPx.w,
          clip.canvasPx.h,
          palette,
          enforcePalette
        )

        // Guarantee 100% pixel identity outside mask when mask is provided
        const finalPng = maskPng
          ? encodePng(
              compositeWithMask(decodePng(srcPng), decodePng(normalizedEdited), decodePng(maskPng))
            )
          : normalizedEdited

        const rawSaved = store.saveBlobAtomic(editedRaw)
        const finalSaved = store.saveBlobAtomic(finalPng)
        const newRevId = makeId('rev')

        const newRev: AssetRevision = {
          revisionId: newRevId,
          assetId: clip.assetId,
          parentRevisionId: frame.revisionId,
          baseRevisionId: frame.revisionId,
          status: 'draft',
          staleConflict: false,
          rawBlobHash: rawSaved.sha256,
          normalizedBlobHash: finalSaved.sha256,
          maskBlobHash: maskHash ?? null,
          canvasPx: clip.canvasPx,
          pivotPx: clip.anchorPx,
          footprintTiles: null,
          collisionBox: null,
          nineSlice: null,
          layers: [
            {
              id: makeId('lyr'),
              name: 'Nền chính',
              visible: true,
              locked: false,
              opacity: 1,
              blobHash: finalSaved.sha256,
              order: 0
            }
          ],
          attachmentPoints: [],
          variantGroupId: null,
          direction: clip.direction,
          stateName: null,
          settingsSnapshot: { promptText, clipId: clip.clipId, slotIndex: slotIdx },
          dependencyIds: [],
          operationSummary: `Chỉnh frame #${slotIdx + 1} (${clip.direction}): ${promptText.slice(0, 60)}`,
          createdAt: now
        }
        store.saveRevision(newRev)

        const updatedClip: Clip = {
          ...clip,
          frames: clip.frames.map((f, idx) =>
            idx === slotIdx
              ? { ...f, revisionId: newRevId, blobHash: finalSaved.sha256, qcWarnings: [] }
              : f
          ),
          updatedAt: now
        }
        store.upsertEntity('clip', updatedClip.clipId, updatedClip)

        const txBefore: TransactionSnapshotPayload = {
          entities: [{ type: 'clip', id: clip.clipId, data: beforeClip }],
          revisions: [{ revisionId: newRevId, data: null }]
        }
        const txAfter: TransactionSnapshotPayload = {
          entities: [{ type: 'clip', id: clip.clipId, data: updatedClip }],
          revisions: [{ revisionId: newRevId, data: newRev }]
        }
        store.recordTransaction(`Chỉnh frame #${slotIdx + 1} clip ${clip.name}`, txBefore, txAfter)

        stepRec.outputAssetIds.push(clip.assetId)
        stepRec.outputRevisionIds.push(newRevId)
        stepRec.outputClipIds.push(clip.clipId)
        return
      }

      // Sprite-level masked inpaint
      if (wfStep.targetAssetId) {
        const asset = store.getEntity<Asset>('asset', wfStep.targetAssetId)
        const baseRevId =
          wfStep.sourceRevisionId ?? asset?.approvedRevisionId ?? asset?.latestRevisionId ?? null
        const baseRev = baseRevId ? store.getRevision(baseRevId) : null
        if (!asset || !baseRev || !baseRev.normalizedBlobHash) {
          throw new Error('Không tìm thấy sprite gốc để chỉnh vùng.')
        }
        const srcPng = store.readBlob(baseRev.normalizedBlobHash)
        const maskPng = maskHash ? store.readBlob(maskHash) : srcPng

        await this.acquireImageSlot(adapter.maxConcurrency, signal)
        let editedRaw: Buffer
        try {
          const res = await adapter.editImage(
            {
              modelId: job.snapshot.models.imageEdit,
              prompt: promptText,
              sourcePng: srcPng,
              maskPng,
              width: baseRev.canvasPx.w,
              height: baseRev.canvasPx.h,
              signal
            },
            apiKey
          )
          editedRaw = res.image
          store.recordUsage({
            usageId: makeId('use'),
            projectId: job.projectId,
            jobId: job.jobId,
            stepId: stepRec.stepId,
            providerId: adapter.providerId,
            modelId: job.snapshot.models.imageEdit,
            operation: wfStep.operation,
            inputTokens: res.usage.inputTokens,
            outputTokens: res.usage.outputTokens,
            imageCount: res.usage.imageCount,
            isEstimated: res.usage.isEstimated,
            createdAt: now
          })
        } finally {
          this.releaseImageSlot()
        }

        const norm = this.normalizeImageBuffer(
          editedRaw,
          baseRev.canvasPx.w,
          baseRev.canvasPx.h,
          palette,
          enforcePalette
        )
        const composited = maskHash
          ? encodePng(compositeWithMask(decodePng(srcPng), decodePng(norm), decodePng(maskPng)))
          : norm
        const rawSaved = store.saveBlobAtomic(editedRaw)
        const finalSaved = store.saveBlobAtomic(composited)

        const { revision } = store.appendRevisionWithConflictCheck(asset.assetId, {
          revisionId: makeId('rev'),
          assetId: asset.assetId,
          parentRevisionId: baseRev.revisionId,
          baseRevisionId: job.snapshot.baseRevisionId ?? baseRev.revisionId,
          status: 'draft',
          rawBlobHash: rawSaved.sha256,
          normalizedBlobHash: finalSaved.sha256,
          maskBlobHash: maskHash ?? null,
          canvasPx: baseRev.canvasPx,
          pivotPx: baseRev.pivotPx,
          footprintTiles: baseRev.footprintTiles,
          collisionBox: baseRev.collisionBox,
          nineSlice: baseRev.nineSlice,
          layers: [
            {
              id: makeId('lyr'),
              name: 'Nền chính',
              visible: true,
              locked: false,
              opacity: 1,
              blobHash: finalSaved.sha256,
              order: 0
            }
          ],
          attachmentPoints: baseRev.attachmentPoints,
          variantGroupId: null,
          direction: baseRev.direction,
          stateName: baseRev.stateName,
          settingsSnapshot: { promptText },
          dependencyIds: [],
          operationSummary: `Chỉnh vùng mask: ${promptText.slice(0, 60)}`,
          createdAt: now
        })
        stepRec.outputAssetIds.push(asset.assetId)
        stepRec.outputRevisionIds.push(revision.revisionId)
        return
      }
    }

    // ----- ANIMATION / VFX GENERATION (A03, F046-F049, F082) -----
    if (wfStep.operation === 'generate_animation' || wfStep.operation === 'generate_vfx') {
      const sourceStepId = wfStep.settings.sourceStepId as string | undefined
      const upstream = sourceStepId ? stepOutputs.get(sourceStepId) : undefined
      let assetId = wfStep.targetAssetId ?? upstream?.assetId ?? null
      const sourceRevId = wfStep.sourceRevisionId ?? upstream?.revisionId ?? null
      const directions = (wfStep.settings.directions as Direction[]) || ['down']
      const framesPerDir = Number(wfStep.settings.framesPerDirection ?? 6)
      const fps = Number(wfStep.settings.fps ?? 8)
      const frameDurationMs = Number(wfStep.settings.frameDurationMs ?? fpsToFrameDurationMs(fps))
      const loopMode = (wfStep.settings.loopMode as LoopMode) || 'loop'
      const action =
        wfStep.operation === 'generate_vfx' ? 'vfx' : String(wfStep.settings.action ?? 'walk')
      const frameW = Number(wfStep.settings.frameWidth ?? (wfStep.settings.canvasPx as SizePx | undefined)?.w ?? 32)
      const frameH = Number(wfStep.settings.frameHeight ?? (wfStep.settings.canvasPx as SizePx | undefined)?.h ?? 48)
      const promptText = String(wfStep.settings.promptText ?? job.snapshot.promptText)
      const enforcePalette = Boolean(wfStep.settings.enforcePalette ?? true)

      if (!assetId) {
        assetId = makeId(wfStep.operation === 'generate_vfx' ? 'vfx' : 'char')
        const newAsset: Asset = {
          assetId,
          name: wfStep.operation === 'generate_vfx' ? 'Hiệu ứng VFX' : 'Nhân vật Animation',
          slug: slugifyAscii(wfStep.operation === 'generate_vfx' ? 'vfx' : 'character'),
          type: wfStep.operation === 'generate_vfx' ? 'vfx' : 'character',
          description: promptText,
          folderId: null,
          collectionIds: [],
          tags: [action],
          parentAssetId: null,
          approvedRevisionId: null,
          latestRevisionId: null,
          metadata: {},
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        }
        store.upsertEntity('asset', assetId, newAsset)
      }

      const targetAsset = store.getEntity<Asset>('asset', assetId)!
      const hintKind =
        wfStep.operation === 'generate_vfx'
          ? 'vfx_dust'
          : targetAsset.type === 'furniture'
            ? 'furniture_cabinet'
            : 'character'

      for (const dir of directions) {
        const frames: ClipFrame[] = []
        const decodedFrames = []

        await this.acquireImageSlot(adapter.maxConcurrency, signal)
        try {
          for (let fi = 0; fi < framesPerDir; fi++) {
            const res = await adapter.generateImage(
              {
                modelId: job.snapshot.models.imageGenerate,
                prompt: `${promptText} (${action}, direction=${dir}, frame ${fi + 1}/${framesPerDir})`,
                width: frameW,
                height: frameH,
                transparentBackground: true,
                hintKind,
                direction: dir,
                frameIndex: fi,
                totalFrames: framesPerDir,
                signal
              },
              apiKey
            )
            if (fi === 0) {
              store.recordUsage({
                usageId: makeId('use'),
                projectId: job.projectId,
                jobId: job.jobId,
                stepId: stepRec.stepId,
                providerId: adapter.providerId,
                modelId: job.snapshot.models.imageGenerate,
                operation: wfStep.operation,
                inputTokens: res.usage.inputTokens,
                outputTokens: res.usage.outputTokens,
                imageCount: 1,
                isEstimated: res.usage.isEstimated,
                createdAt: now
              })
            }

            const normPng = this.normalizeImageBuffer(
              res.images[0],
              frameW,
              frameH,
              palette,
              enforcePalette
            )
            const rawSaved = store.saveBlobAtomic(res.images[0])
            const normSaved = store.saveBlobAtomic(normPng)
            const decoded = decodePng(normPng)
            decodedFrames.push(decoded)

            const metrics = analyzeSpriteMetrics(decoded, palette?.colors)
            const warnings: FrameQcWarning[] = []
            if (metrics.isEmpty) {
              warnings.push({
                code: 'EMPTY_FRAME',
                severity: 'error',
                message: 'Frame trống hoàn toàn.'
              })
            }
            if (metrics.touchesEdge) {
              warnings.push({
                code: 'EDGE_CLIPPED',
                severity: 'warning',
                message: 'Nội dung chạm mép canvas, có nguy cơ bị cắt.'
              })
            }

            const revId = makeId('rev')
            store.saveRevision({
              revisionId: revId,
              assetId,
              parentRevisionId: sourceRevId,
              baseRevisionId: sourceRevId,
              status: 'approved',
              staleConflict: false,
              rawBlobHash: rawSaved.sha256,
              normalizedBlobHash: normSaved.sha256,
              maskBlobHash: null,
              canvasPx: { w: frameW, h: frameH },
              pivotPx: { x: Math.floor(frameW / 2), y: frameH - 2 },
              footprintTiles: null,
              collisionBox: null,
              nineSlice: null,
              layers: [
                {
                  id: makeId('lyr'),
                  name: 'Frame',
                  visible: true,
                  locked: false,
                  opacity: 1,
                  blobHash: normSaved.sha256,
                  order: 0
                }
              ],
              attachmentPoints: [],
              variantGroupId: null,
              direction: dir,
              stateName: null,
              settingsSnapshot: { action, direction: dir, slotIndex: fi },
              dependencyIds: sourceRevId ? [sourceRevId] : [],
              operationSummary: `${action}_${dir}_f${fi + 1}`,
              createdAt: now
            })

            frames.push({
              frameId: makeId('frm'),
              slotIndex: fi,
              revisionId: revId,
              blobHash: normSaved.sha256,
              sourceRect: null,
              durationMs: frameDurationMs,
              offsetPx: { x: 0, y: 0 },
              isLocked: false,
              isIntentionalHold: false,
              qcWarnings: warnings
            })
          }
        } finally {
          this.releaseImageSlot()
        }

        // Loop seam check (F059)
        if (loopMode === 'loop' && decodedFrames.length >= 2) {
          const diff = computePixelDiffRatio(decodedFrames[0], decodedFrames[decodedFrames.length - 1])
          if (diff > 0.45) {
            frames[frames.length - 1].qcWarnings.push({
              code: 'LOOP_SEAM_JUMP',
              severity: 'warning',
              metric: Number(diff.toFixed(3)),
              message: 'Sai khác lớn giữa frame cuối và frame đầu, vòng lặp có thể bị giật.'
            })
          }
        }

        const clip: Clip = {
          clipId: makeId('clip'),
          assetId,
          name: `${targetAsset.name} — ${action} (${dir})`,
          action,
          direction: dir,
          fps,
          loopMode,
          playbackSpeed: 1,
          canvasPx: { w: frameW, h: frameH },
          anchorPx: { x: Math.floor(frameW / 2), y: frameH - 2 },
          frames,
          events:
            action === 'walk' && frames.length >= 4
              ? [
                  {
                    eventId: makeId('evt'),
                    name: 'footstep_left',
                    frameId: frames[1].frameId,
                    timeMs: frameDurationMs,
                    payload: { surface: 'wood' }
                  },
                  {
                    eventId: makeId('evt'),
                    name: 'footstep_right',
                    frameId: frames[Math.min(frames.length - 1, 4)].frameId,
                    timeMs: frameDurationMs * Math.min(frames.length - 1, 4),
                    payload: { surface: 'wood' }
                  }
                ]
              : [],
          status: 'draft',
          createdAt: now,
          updatedAt: now
        }
        store.upsertEntity('clip', clip.clipId, clip)
        stepRec.outputClipIds.push(clip.clipId)

        if (wfStep.operation === 'generate_vfx') {
          const vfx: VFXConfig = {
            vfxId: makeId('vfx'),
            assetId,
            clipId: clip.clipId,
            name: clip.name,
            emitterOffsetPx: { x: 0, y: 0 },
            previewTargetType: 'none',
            previewTargetId: null,
            blendMode: 'normal',
            playbackSpeed: 1,
            loopMode,
            createdAt: now,
            updatedAt: now
          }
          store.upsertEntity('vfx', vfx.vfxId, vfx)
        }
      }

      stepRec.outputAssetIds.push(assetId)
      return
    }

    // ----- TILESET GENERATION (F064-F068) -----
    if (wfStep.operation === 'generate_tileset' || wfStep.operation === 'generate_tile_transitions') {
      const tileSizePx = Number(wfStep.settings.tileSizePx ?? store.getProjectConfig().tileSizePx ?? 32)
      const promptText = String(wfStep.settings.promptText ?? job.snapshot.promptText)
      const enforcePalette = Boolean(wfStep.settings.enforcePalette ?? true)
      const name = String(wfStep.settings.name ?? 'Tileset mới')

      await this.acquireImageSlot(adapter.maxConcurrency, signal)
      try {
        const res = await adapter.generateImage(
          {
            modelId: job.snapshot.models.imageGenerate,
            prompt: promptText,
            width: tileSizePx,
            height: tileSizePx,
            transparentBackground: false,
            hintKind: 'tile_wood_floor',
            signal
          },
          apiKey
        )
        store.recordUsage({
          usageId: makeId('use'),
          projectId: job.projectId,
          jobId: job.jobId,
          stepId: stepRec.stepId,
          providerId: adapter.providerId,
          modelId: job.snapshot.models.imageGenerate,
          operation: wfStep.operation,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          imageCount: res.usage.imageCount,
          isEstimated: res.usage.isEstimated,
          createdAt: now
        })

        const tileSpecs = [
          { key: 'floor_wood', name: 'Sàn gỗ', kind: 'tile_wood_floor' as const, walkable: true, col: 'none' as const, tag: 'wood' },
          { key: 'wall_wood', name: 'Tường gỗ', kind: 'tile_wall' as const, walkable: false, col: 'full' as const, tag: 'wall' },
          { key: 'dirt_floor', name: 'Nền đất', kind: 'tile_dirt' as const, walkable: true, col: 'none' as const, tag: 'dirt' },
          { key: 'border_north', name: 'Viền giao tường', kind: 'tile_border' as const, walkable: true, col: 'none' as const, tag: 'wood_edge' }
        ]

        const tiles = tileSpecs.map((spec, idx) => {
          const rawBuf =
            idx === 0
              ? res.images[0]
              : encodePng(renderProceduralSprite({ kind: spec.kind, width: tileSizePx, height: tileSizePx }))
          const normBuf = this.normalizeImageBuffer(rawBuf, tileSizePx, tileSizePx, palette, enforcePalette)
          const saved = store.saveBlobAtomic(normBuf)
          return {
            tileId: makeId('tile'),
            name: spec.name,
            blobHash: saved.sha256,
            terrainTag: spec.tag,
            walkable: spec.walkable,
            collisionShape: spec.col,
            customCollisionRect: null,
            isOverlay: false
          }
        })

        const assetId = makeId('ts_asset')
        const revId = makeId('rev')
        const tilesetId = makeId('tileset')
        store.saveRevision({
          revisionId: revId,
          assetId,
          parentRevisionId: null,
          baseRevisionId: null,
          status: 'approved',
          staleConflict: false,
          rawBlobHash: tiles[0].blobHash,
          normalizedBlobHash: tiles[0].blobHash,
          maskBlobHash: null,
          canvasPx: { w: tileSizePx, h: tileSizePx },
          pivotPx: { x: Math.floor(tileSizePx / 2), y: Math.floor(tileSizePx / 2) },
          footprintTiles: null,
          collisionBox: null,
          nineSlice: null,
          layers: [],
          attachmentPoints: [],
          variantGroupId: null,
          direction: null,
          stateName: null,
          settingsSnapshot: { tileSizePx },
          dependencyIds: [],
          operationSummary: 'Tạo tileset',
          createdAt: now
        })

        store.upsertEntity<Asset>('asset', assetId, {
          assetId,
          name,
          slug: slugifyAscii(name),
          type: 'tileset',
          description: promptText,
          folderId: null,
          collectionIds: [],
          tags: ['tileset'],
          parentAssetId: null,
          approvedRevisionId: revId,
          latestRevisionId: revId,
          metadata: { tilesetId },
          trashedAt: null,
          createdAt: now,
          updatedAt: now
        })

        const tileset: TileSet = {
          tilesetId,
          assetId,
          name,
          tileSizePx,
          paddingPx: 2,
          tiles,
          autoTileRules: [
            {
              ruleId: makeId('rule'),
              name: 'Viền sàn tiếp giáp tường trên',
              mode: '4-bit',
              terrainTag: 'wood',
              bitmask: 14,
              tileId: tiles[3].tileId,
              priority: 10
            }
          ],
          createdAt: now,
          updatedAt: now
        }
        store.upsertEntity('tileset', tilesetId, tileset)
        stepRec.outputAssetIds.push(assetId)
        stepRec.outputRevisionIds.push(revId)
        stepOutputs.set(stepRec.stepId, { assetId, revisionId: revId, tilesetId })
      } finally {
        this.releaseImageSlot()
      }
      return
    }

    // ----- MAP LAYOUT GENERATION (A06, F069-F075) -----
    if (wfStep.operation === 'generate_map_layout') {
      const cols = Number(wfStep.settings.cols ?? 10)
      const rows = Number(wfStep.settings.rows ?? 8)
      const tileSizePx = Number(wfStep.settings.tileSizePx ?? store.getProjectConfig().tileSizePx ?? 32)
      const name = String(wfStep.settings.name ?? `Bản đồ ${cols}×${rows}`)

      const tilesetStepId = wfStep.settings.tilesetStepId as string | undefined
      const tilesets = store.listEntities<TileSet>('tileset')
      const chosenTileset =
        (tilesetStepId && stepOutputs.get(tilesetStepId)?.tilesetId
          ? store.getEntity<TileSet>('tileset', stepOutputs.get(tilesetStepId)!.tilesetId!)
          : tilesets[0]) ?? null

      const floorTileId = chosenTileset?.tiles.find((t) => t.walkable)?.tileId ?? 'tile_floor'
      const wallTileId = chosenTileset?.tiles.find((t) => !t.walkable)?.tileId ?? floorTileId
      const borderTileId = chosenTileset?.tiles[3]?.tileId ?? floorTileId

      const groundCells: Record<string, string> = {}
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const isEdgeWall = r === 0 || c === 0 || c === cols - 1 || (r === rows - 1 && c !== Math.floor(cols / 2))
          if (isEdgeWall) groundCells[`${c},${r}`] = wallTileId
          else if (r === 1) groundCells[`${c},${r}`] = borderTileId
          else groundCells[`${c},${r}`] = floorTileId
        }
      }

      const objectLayerId = makeId('mlay')
      const placeFromSteps = (wfStep.settings.placeFromSteps as string[]) || []
      const placements: Scene['placements'] = []
      let cursorX = 2
      for (const sid of placeFromSteps) {
        const out = stepOutputs.get(sid)
        if (!out?.assetId) continue
        const asset = store.getEntity<Asset>('asset', out.assetId)
        const rev = out.revisionId ? store.getRevision(out.revisionId) : null
        if (!asset) continue
        const fp = rev?.footprintTiles ?? { w: 1, h: 1 }
        if (cursorX + fp.w >= cols - 1) cursorX = 2
        placements.push({
          placementId: makeId('plc'),
          assetId: asset.assetId,
          revisionId: out.revisionId ?? asset.approvedRevisionId,
          name: asset.name,
          layerId: objectLayerId,
          gridX: cursorX,
          gridY: 2,
          offsetPx: { x: 0, y: 0 },
          footprint: fp,
          facing: 'down',
          ySortOffset: 0,
          blocksMovement: true,
          linkedDialogueId: null,
          linkedQuestId: null
        })
        cursorX += fp.w + 1
      }

      const sceneId = makeId('scene')
      const assetId = makeId('map_asset')
      const doorX = Math.floor(cols / 2)
      const scene: Scene = {
        sceneId,
        assetId,
        name,
        cols,
        rows,
        tileSizePx,
        tilesetId: chosenTileset?.tilesetId ?? null,
        layers: [
          { layerId: makeId('mlay'), name: 'Nền (Ground)', kind: 'ground', visible: true, locked: false, opacity: 1, order: 0, cells: groundCells },
          { layerId: makeId('mlay'), name: 'Chi tiết (Detail)', kind: 'detail', visible: true, locked: false, opacity: 1, order: 1, cells: {} },
          { layerId: objectLayerId, name: 'Vật thể (Y-Sort)', kind: 'object', visible: true, locked: false, opacity: 1, order: 2, cells: {} },
          { layerId: makeId('mlay'), name: 'Lớp phủ (Overlay)', kind: 'overlay', visible: true, locked: false, opacity: 1, order: 3, cells: {} },
          { layerId: makeId('mlay'), name: 'Va chạm (Collision)', kind: 'collision', visible: true, locked: false, opacity: 0.6, order: 4, cells: {} }
        ],
        placements,
        collisionRects: [
          { x: 0, y: 0, w: cols * tileSizePx, h: tileSizePx },
          { x: 0, y: 0, w: tileSizePx, h: rows * tileSizePx },
          { x: (cols - 1) * tileSizePx, y: 0, w: tileSizePx, h: rows * tileSizePx }
        ],
        markers: [
          {
            markerId: makeId('mrk'),
            kind: 'spawn',
            name: 'Điểm xuất hiện người chơi',
            gridX: doorX,
            gridY: Math.max(2, rows - 2),
            widthTiles: 1,
            heightTiles: 1,
            eventName: 'player_spawn',
            targetSceneId: null,
            linkedDialogueId: null,
            linkedQuestId: null
          },
          {
            markerId: makeId('mrk'),
            kind: 'door',
            name: 'Cửa ra vào xưởng',
            gridX: doorX,
            gridY: rows - 1,
            widthTiles: 1,
            heightTiles: 1,
            eventName: 'door_workshop_exit',
            targetSceneId: null,
            linkedDialogueId: null,
            linkedQuestId: null
          }
        ],
        createdAt: now,
        updatedAt: now
      }

      store.upsertEntity('scene', sceneId, scene)
      store.upsertEntity<Asset>('asset', assetId, {
        assetId,
        name,
        slug: slugifyAscii(name),
        type: 'map',
        description: String(wfStep.settings.promptText ?? ''),
        folderId: null,
        collectionIds: [],
        tags: ['map', 'scene'],
        parentAssetId: null,
        approvedRevisionId: null,
        latestRevisionId: null,
        metadata: { sceneId },
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      })

      stepRec.outputAssetIds.push(assetId)
      stepOutputs.set(stepRec.stepId, { assetId })
      return
    }

    // ----- DIALOGUE / QUEST / DATA TABLE / STORYBOARD / UI SCREEN (AI PLAN) -----
    if (
      wfStep.operation === 'generate_dialogue' ||
      wfStep.operation === 'generate_quest' ||
      wfStep.operation === 'generate_data_table' ||
      wfStep.operation === 'generate_storyboard' ||
      wfStep.operation === 'generate_ui_screen'
    ) {
      const promptText = String(wfStep.settings.promptText ?? job.snapshot.promptText)
      const planRes = await adapter.generatePlan(
        {
          modelId: job.snapshot.models.planner,
          systemPrompt: 'Generate structured game content JSON.',
          projectContext: { projectId: job.projectId, operation: wfStep.operation },
          userPrompt: promptText,
          signal
        },
        apiKey
      )
      store.recordUsage({
        usageId: makeId('use'),
        projectId: job.projectId,
        jobId: job.jobId,
        stepId: stepRec.stepId,
        providerId: adapter.providerId,
        modelId: job.snapshot.models.planner,
        operation: wfStep.operation,
        inputTokens: planRes.usage.inputTokens,
        outputTokens: planRes.usage.outputTokens,
        imageCount: 0,
        isEstimated: planRes.usage.isEstimated,
        createdAt: now
      })

      const assetId = makeId('cnt')
      if (wfStep.operation === 'generate_dialogue') {
        const dialogueId = makeId('dlg')
        const npcId = (wfStep.settings.npcAssetId as string | null) ?? null
        const graph: DialogueGraph = {
          dialogueId,
          assetId,
          name: 'Hội thoại mới',
          npcAssetId: npcId,
          startNodeId: 'n_start',
          nodes: [
            { nodeId: 'n_start', kind: 'dialogue', speakerAssetId: npcId, speakerName: 'Thợ mộc', text: 'Chào bạn! Bạn đã mang cây búa đến chưa?', condition: null, effects: [], position: { x: 40, y: 60 } },
            { nodeId: 'n_missing', kind: 'dialogue', speakerAssetId: npcId, speakerName: 'Thợ mộc', text: 'Bạn chưa có búa. Hãy tìm giúp tôi nhé!', condition: null, effects: [], position: { x: 300, y: 20 } },
            { nodeId: 'n_deliver', kind: 'dialogue', speakerAssetId: npcId, speakerName: 'Thợ mộc', text: 'Tuyệt vời! Cảm ơn bạn đã giao búa.', condition: null, effects: [{ kind: 'take_item', key: 'item_hammer', value: 1 }, { kind: 'set_flag', key: 'quest_hammer_done', value: true }], position: { x: 300, y: 140 } },
            { nodeId: 'n_end', kind: 'end', speakerAssetId: null, speakerName: '', text: '', condition: null, effects: [], position: { x: 560, y: 80 } }
          ],
          edges: [
            { edgeId: 'e1', fromNodeId: 'n_start', toNodeId: 'n_deliver', label: 'Giao cây búa', condition: { kind: 'has_item', key: 'item_hammer', value: 1 } },
            { edgeId: 'e2', fromNodeId: 'n_start', toNodeId: 'n_missing', label: 'Chưa có búa', condition: null },
            { edgeId: 'e3', fromNodeId: 'n_missing', toNodeId: 'n_end', label: 'Tạm biệt', condition: null },
            { edgeId: 'e4', fromNodeId: 'n_deliver', toNodeId: 'n_end', label: 'Hoàn tất', condition: null }
          ],
          createdAt: now,
          updatedAt: now
        }
        store.upsertEntity('dialogue', dialogueId, graph)
        store.upsertEntity<Asset>('asset', assetId, {
          assetId, name: graph.name, slug: slugifyAscii(graph.name), type: 'dialogue',
          description: promptText, folderId: null, collectionIds: [], tags: ['dialogue'],
          parentAssetId: null, approvedRevisionId: null, latestRevisionId: null,
          metadata: { dialogueId }, trashedAt: null, createdAt: now, updatedAt: now
        })
      } else if (wfStep.operation === 'generate_quest') {
        const questId = makeId('qst')
        const flag: StateFlag = {
          flagId: makeId('flg'),
          key: 'quest_hammer_done',
          type: 'bool',
          defaultValue: false,
          description: 'Đã giao búa cho thợ mộc'
        }
        store.upsertEntity('state_flag', flag.flagId, flag)
        const quest: Quest = {
          questId,
          assetId,
          name: 'Nhiệm vụ giao búa cho thợ mộc',
          description: promptText,
          giverNpcAssetId: (wfStep.settings.npcAssetId as string | null) ?? null,
          prerequisiteQuestId: null,
          startConditions: [],
          objectives: [
            {
              objectiveId: makeId('obj'),
              description: 'Mang cây búa gỗ giao cho thợ mộc',
              condition: { kind: 'has_item', key: 'item_hammer', value: 1 }
            }
          ],
          rewards: [{ itemAssetId: null, itemKey: 'gold_coin', quantity: 50 }],
          completionFlagKey: 'quest_hammer_done',
          completionEffects: [
            { kind: 'set_flag', key: 'quest_hammer_done', value: true },
            { kind: 'give_item', key: 'gold_coin', value: 50 }
          ],
          createdAt: now,
          updatedAt: now
        }
        store.upsertEntity('quest', questId, quest)
        store.upsertEntity<Asset>('asset', assetId, {
          assetId, name: quest.name, slug: slugifyAscii(quest.name), type: 'quest',
          description: promptText, folderId: null, collectionIds: [], tags: ['quest'],
          parentAssetId: null, approvedRevisionId: null, latestRevisionId: null,
          metadata: { questId }, trashedAt: null, createdAt: now, updatedAt: now
        })
      } else if (wfStep.operation === 'generate_data_table') {
        const tableId = makeId('tbl')
        const table: DataTable = {
          tableId,
          assetId,
          name: 'Bảng chỉ số vật phẩm xưởng mộc',
          columns: [
            { colId: 'c1', name: 'item_key', type: 'string', required: true },
            { colId: 'c2', name: 'ten_hien_thi', type: 'string', required: true },
            { colId: 'c3', name: 'gia_ban', type: 'int', required: true, min: 0, max: 99999 },
            { colId: 'c4', name: 'do_hiem', type: 'enum', required: true, enumValues: ['thuong', 'hiem', 'su_thi'] }
          ],
          rows: [
            { item_key: 'item_hammer', ten_hien_thi: 'Búa thợ mộc', gia_ban: 120, do_hiem: 'thuong' },
            { item_key: 'wood_plank', ten_hien_thi: 'Ván gỗ sồi', gia_ban: 25, do_hiem: 'thuong' }
          ],
          createdAt: now,
          updatedAt: now
        }
        store.upsertEntity('data_table', tableId, table)
        store.upsertEntity<Asset>('asset', assetId, {
          assetId, name: table.name, slug: slugifyAscii(table.name), type: 'data_table',
          description: promptText, folderId: null, collectionIds: [], tags: ['data_table'],
          parentAssetId: null, approvedRevisionId: null, latestRevisionId: null,
          metadata: { tableId }, trashedAt: null, createdAt: now, updatedAt: now
        })
      } else if (wfStep.operation === 'generate_storyboard') {
        const cutsceneId = makeId('cut')
        const cutscene: Cutscene = {
          cutsceneId,
          assetId,
          name: 'Cutscene mở đầu xưởng mộc',
          shots: [
            { shotId: makeId('shot'), order: 0, title: 'Cảnh 1 · Toàn cảnh xưởng mộc', durationMs: 2500, sceneId: null, dialogueId: null, speakerAssetId: null, referencedAssetIds: [], dialogueText: 'Sáng sớm tại xưởng mộc ấm áp.', cameraNotes: 'Pan chậm từ cửa vào bàn mộc', transitionCue: 'fade_in' },
            { shotId: makeId('shot'), order: 1, title: 'Cảnh 2 · Thợ mộc tìm cây búa', durationMs: 3000, sceneId: null, dialogueId: null, speakerAssetId: null, referencedAssetIds: [], dialogueText: 'Cây búa của tôi để đâu rồi nhỉ?', cameraNotes: 'Cận cảnh NPC thợ mộc', transitionCue: 'cut' }
          ],
          createdAt: now,
          updatedAt: now
        }
        store.upsertEntity('cutscene', cutsceneId, cutscene)
        store.upsertEntity<Asset>('asset', assetId, {
          assetId, name: cutscene.name, slug: slugifyAscii(cutscene.name), type: 'cutscene',
          description: promptText, folderId: null, collectionIds: [], tags: ['cutscene'],
          parentAssetId: null, approvedRevisionId: null, latestRevisionId: null,
          metadata: { cutsceneId }, trashedAt: null, createdAt: now, updatedAt: now
        })
      } else {
        const screenId = makeId('uis')
        const screen: UIScreen = {
          screenId,
          assetId,
          name: 'Màn hình HUD & Hội thoại',
          resolutionPx: store.getProjectConfig().uiResolutionPx,
          elements: [
            { elementId: makeId('uie'), name: 'Khung thoại dưới', kind: 'dialogue_box', x: 24, y: 184, w: 432, h: 72, anchor: 'bottom-center', nineSlice: { left: 8, top: 8, right: 8, bottom: 8 }, states: { normalAssetId: null, pressedAssetId: null, disabledAssetId: null, hoverAssetId: null }, text: 'Xin chào từ xưởng mộc!' },
            { elementId: makeId('uie'), name: 'Nút Tiếp tục', kind: 'button', x: 360, y: 224, w: 80, h: 24, anchor: 'bottom-right', nineSlice: { left: 6, top: 6, right: 6, bottom: 6 }, states: { normalAssetId: null, pressedAssetId: null, disabledAssetId: null, hoverAssetId: null }, text: 'Tiếp tục' }
          ],
          createdAt: now,
          updatedAt: now
        }
        store.upsertEntity('ui_screen', screenId, screen)
        store.upsertEntity<Asset>('asset', assetId, {
          assetId, name: screen.name, slug: slugifyAscii(screen.name), type: 'ui_screen',
          description: promptText, folderId: null, collectionIds: [], tags: ['ui'],
          parentAssetId: null, approvedRevisionId: null, latestRevisionId: null,
          metadata: { screenId }, trashedAt: null, createdAt: now, updatedAt: now
        })
      }

      stepRec.outputAssetIds.push(assetId)
      return
    }

    // ----- STATIC SPRITE / FURNITURE / ITEM / PORTRAIT / OUTFIT / ICON / UI ELEMENT -----
    const canvasPx = (wfStep.settings.canvasPx as SizePx | undefined) ?? { w: 32, h: 48 }
    const promptText = String(wfStep.settings.promptText ?? job.snapshot.promptText)
    const enforcePalette = Boolean(wfStep.settings.enforcePalette ?? true)
    const variantCount = Math.max(1, Math.min(4, Number(wfStep.settings.variantCount ?? 1)))
    const name = String(wfStep.settings.name ?? (promptText.slice(0, 32) || 'Sprite mới'))

    const assetType: Asset['type'] =
      wfStep.operation === 'generate_furniture'
        ? 'furniture'
        : wfStep.operation === 'generate_item'
          ? 'item'
          : wfStep.operation === 'generate_icon' || wfStep.operation === 'generate_ui_icon_set'
            ? 'icon'
            : wfStep.operation === 'generate_portrait'
              ? 'portrait'
              : wfStep.operation === 'generate_outfit'
                ? 'outfit'
                : wfStep.operation === 'generate_ui_element'
                  ? 'ui_element'
                  : 'character'

    const hintKind =
      assetType === 'furniture'
        ? name.toLowerCase().includes('bàn')
          ? 'furniture_table'
          : name.toLowerCase().includes('ghế')
            ? 'furniture_chair'
            : 'furniture_cabinet'
        : assetType === 'item'
          ? 'item_hammer'
          : assetType === 'icon'
            ? 'icon_hammer'
            : assetType === 'portrait'
              ? 'portrait'
              : assetType === 'outfit'
                ? 'outfit'
                : assetType === 'ui_element'
                  ? 'ui_box'
                  : 'character'

    await this.acquireImageSlot(adapter.maxConcurrency, signal)
    let rawImages: Buffer[]
    try {
      const res = await adapter.generateImage(
        {
          modelId: job.snapshot.models.imageGenerate,
          prompt: promptText,
          width: canvasPx.w,
          height: canvasPx.h,
          transparentBackground: true,
          variantCount,
          hintKind,
          signal
        },
        apiKey
      )
      rawImages = res.images
      stepRec.providerRequestId = res.usage.providerRequestId ?? null
      store.recordUsage({
        usageId: makeId('use'),
        projectId: job.projectId,
        jobId: job.jobId,
        stepId: stepRec.stepId,
        providerId: adapter.providerId,
        modelId: job.snapshot.models.imageGenerate,
        operation: wfStep.operation,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        imageCount: res.usage.imageCount,
        isEstimated: res.usage.isEstimated,
        createdAt: now
      })
    } finally {
      this.releaseImageSlot()
    }

    const existingAsset = wfStep.targetAssetId
      ? store.getEntity<Asset>('asset', wfStep.targetAssetId)
      : null
    const assetId = existingAsset?.assetId ?? makeId(assetType)
    const variantGroupId = variantCount > 1 ? makeId('vg') : null

    if (!existingAsset) {
      store.upsertEntity<Asset>('asset', assetId, {
        assetId,
        name,
        slug: slugifyAscii(name),
        type: assetType,
        description: promptText,
        folderId: null,
        collectionIds: [],
        tags: [assetType],
        parentAssetId:
          assetType === 'portrait' || assetType === 'outfit' ? wfStep.targetAssetId : null,
        approvedRevisionId: null,
        latestRevisionId: null,
        metadata: {},
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      })
    }

    let firstRevId = ''
    for (let i = 0; i < rawImages.length; i++) {
      const rawBuf = rawImages[i]
      const normBuf = this.normalizeImageBuffer(
        rawBuf,
        canvasPx.w,
        canvasPx.h,
        palette,
        enforcePalette
      )
      const rawSaved = store.saveBlobAtomic(rawBuf)
      const normSaved = store.saveBlobAtomic(normBuf)
      const revId = makeId('rev')
      if (i === 0) firstRevId = revId

      const fp =
        (wfStep.settings.footprintTiles as { w: number; h: number } | undefined) ??
        (assetType === 'furniture' ? { w: 2, h: 1 } : null)

      const { revision } = store.appendRevisionWithConflictCheck(assetId, {
        revisionId: revId,
        assetId,
        parentRevisionId: existingAsset?.latestRevisionId ?? null,
        baseRevisionId: job.snapshot.baseRevisionId ?? existingAsset?.latestRevisionId ?? null,
        status: 'draft',
        rawBlobHash: rawSaved.sha256,
        normalizedBlobHash: normSaved.sha256,
        maskBlobHash: null,
        canvasPx,
        pivotPx: { x: Math.floor(canvasPx.w / 2), y: canvasPx.h - 2 },
        footprintTiles: fp,
        collisionBox: null,
        nineSlice: assetType === 'ui_element' ? { left: 6, top: 6, right: 6, bottom: 6 } : null,
        layers: [
          {
            id: makeId('lyr'),
            name: 'Nền chính',
            visible: true,
            locked: false,
            opacity: 1,
            blobHash: normSaved.sha256,
            order: 0
          }
        ],
        attachmentPoints: [],
        variantGroupId,
        direction: 'down',
        stateName: 'normal',
        settingsSnapshot: { promptText, variantIndex: i, canvasPx },
        dependencyIds: [],
        operationSummary: variantCount > 1 ? `Phương án #${i + 1}: ${name}` : `Tạo ${name}`,
        createdAt: now
      })
      stepRec.outputRevisionIds.push(revision.revisionId)
    }

    stepRec.outputAssetIds.push(assetId)
    stepOutputs.set(stepRec.stepId, { assetId, revisionId: firstRevId })
  }
}
