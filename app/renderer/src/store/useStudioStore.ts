import { create } from 'zustand'
import type {
  Asset,
  AssetRevision,
  Clip,
  JobRecord,
  ModelCapability,
  WorkflowPlan
} from '@domain/schemas/types'
import type { ProjectFullState } from '../../../main/db/projectStore'
import type { AppSettingsState } from '../../../main/ipc/studioService'
import type { StoredProviderKeyMeta } from '../../../main/security/secretStore'
import type { ResolutionResult } from '@domain/rules/parameterResolver'

export type StudioUiFeedbackState =
  | 'empty'
  | 'analyzing'
  | 'needs_resolution'
  | 'queued'
  | 'running'
  | 'draft_ready'
  | 'approved'
  | 'failed'
  | 'cancelled'
  | 'exported'

export interface StudioStoreState {
  initialized: boolean
  loading: boolean
  settings: AppSettingsState | null
  providerKeys: Record<string, StoredProviderKeyMeta>
  capabilities: Record<string, ModelCapability[]>
  sampleWorkshopAvailable: boolean
  project: ProjectFullState | null

  // Selection & Navigation
  selectedAssetId: string | null
  selectedClipId: string | null
  selectedFrameIndex: number
  selectedRevisionId: string | null
  maskPngBase64: string | null
  blobCache: Record<string, string> // sha256 -> data:image/png;base64,...

  // Timeline / Canvas Synced Playback
  isPlaying: boolean
  playFrameIndex: number
  onionSkin: boolean

  // Workspace Layout
  leftWidth: number
  rightWidth: number
  bottomHeight: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  bottomCollapsed: boolean

  // Modals & Feedback
  activeModal: null | 'settings' | 'queue' | 'export' | 'project_settings' | 'diagnostics'
  uiFeedbackState: StudioUiFeedbackState
  statusMessage: string
  errorBanner: { title: string; reason: string; preserved: string } | null
  lastPlanPreview: { resolution: ResolutionResult; plan: WorkflowPlan } | null

  // Actions
  bootstrap: () => Promise<void>
  setProjectState: (proj: ProjectFullState | null) => void
  selectAsset: (assetId: string | null) => void
  selectClip: (clipId: string | null, frameIndex?: number) => void
  selectFrameIndex: (idx: number) => void
  setIsPlaying: (playing: boolean) => void
  setPlayFrameIndex: (idx: number) => void
  setOnionSkin: (enabled: boolean) => void
  setMaskPngBase64: (b64: string | null) => void
  loadBlobDataUrl: (sha256: string) => Promise<string | null>
  setActiveModal: (m: StudioStoreState['activeModal']) => void
  setFeedback: (state: StudioUiFeedbackState, msg: string) => void
  setErrorBanner: (err: StudioStoreState['errorBanner']) => void
  setLastPlanPreview: (p: { resolution: ResolutionResult; plan: WorkflowPlan } | null) => void
  togglePanel: (side: 'left' | 'right' | 'bottom') => void
  setPanelSize: (side: 'left' | 'right' | 'bottom', px: number) => void
  updateJobRealtime: (job: JobRecord) => void
}

export const useStudioStore = create<StudioStoreState>((set, get) => ({
  initialized: false,
  loading: false,
  settings: null,
  providerKeys: {},
  capabilities: {},
  sampleWorkshopAvailable: false,
  project: null,

  selectedAssetId: null,
  selectedClipId: null,
  selectedFrameIndex: 0,
  selectedRevisionId: null,
  maskPngBase64: null,
  blobCache: {},

  isPlaying: false,
  playFrameIndex: 0,
  onionSkin: false,

  leftWidth: 232,
  rightWidth: 320,
  bottomHeight: 168,
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: false,

  activeModal: null,
  uiFeedbackState: 'empty',
  statusMessage: 'Sẵn sàng',
  errorBanner: null,
  lastPlanPreview: null,

  bootstrap: async () => {
    if (typeof window === 'undefined' || !window.pixelStudio) {
      set({
        initialized: true,
        loading: false,
        errorBanner: {
          title: 'Thiếu cầu nối Electron',
          reason: 'Ứng dụng cần chạy trong cửa sổ desktop Electron thay vì trình duyệt web thông thường.',
          preserved: 'Không có dữ liệu bị ghi đè.'
        }
      })
      return
    }
    set({ loading: true })
    try {
      const data = (await window.pixelStudio.bootstrap()) as {
        settings: AppSettingsState
        providerKeys: Record<string, StoredProviderKeyMeta>
        capabilities: Record<string, ModelCapability[]>
        sampleWorkshopAvailable: boolean
        currentProject: ProjectFullState | null
      }
      set({
        initialized: true,
        loading: false,
        settings: data.settings,
        providerKeys: data.providerKeys,
        capabilities: data.capabilities,
        sampleWorkshopAvailable: data.sampleWorkshopAvailable
      })
      if (data.currentProject) {
        get().setProjectState(data.currentProject)
      }
    } catch (err) {
      set({
        initialized: true,
        loading: false,
        errorBanner: {
          title: 'Lỗi khởi tạo ứng dụng',
          reason: err instanceof Error ? err.message : String(err),
          preserved: 'Không có dữ liệu bị ghi đè.'
        }
      })
    }
  },

  setProjectState: (proj) => {
    if (!proj) {
      set({
        project: null,
        selectedAssetId: null,
        selectedClipId: null,
        selectedFrameIndex: 0,
        uiFeedbackState: 'empty'
      })
      return
    }
    const prevSelected = get().selectedAssetId
    const activeAssets = proj.assets.filter((a) => !a.trashedAt)
    const stillExists = prevSelected && activeAssets.some((a) => a.assetId === prevSelected)
    const nextAssetId = stillExists ? prevSelected : activeAssets[0]?.assetId ?? null
    const nextAsset = activeAssets.find((a) => a.assetId === nextAssetId) ?? null
    const prevClip = get().selectedClipId
    const clipExists = prevClip && proj.clips.some((c) => c.clipId === prevClip)
    const relatedClip = clipExists
      ? prevClip
      : proj.clips.find((c) => c.assetId === nextAssetId)?.clipId ?? null

    set({
      project: proj,
      selectedAssetId: nextAssetId,
      selectedClipId: relatedClip,
      selectedRevisionId: nextAsset?.approvedRevisionId ?? nextAsset?.latestRevisionId ?? null,
      uiFeedbackState: nextAsset?.approvedRevisionId
        ? 'approved'
        : activeAssets.length > 0
          ? 'draft_ready'
          : 'empty'
    })
  },

  selectAsset: (assetId) => {
    const proj = get().project
    if (!proj || !assetId) {
      set({
        selectedAssetId: null,
        selectedClipId: null,
        selectedFrameIndex: 0,
        playFrameIndex: 0,
        isPlaying: false,
        maskPngBase64: null
      })
      return
    }
    const asset = proj.assets.find((a) => a.assetId === assetId)
    const firstClip = proj.clips.find((c) => c.assetId === assetId) ?? null
    set({
      selectedAssetId: assetId,
      selectedClipId: firstClip?.clipId ?? null,
      selectedFrameIndex: 0,
      playFrameIndex: 0,
      isPlaying: false,
      selectedRevisionId: asset?.approvedRevisionId ?? asset?.latestRevisionId ?? null,
      maskPngBase64: null
    })
  },

  selectClip: (clipId, frameIndex = 0) => {
    const proj = get().project
    const clip = proj?.clips.find((c) => c.clipId === clipId)
    set({
      selectedClipId: clipId,
      selectedAssetId: clip?.assetId ?? get().selectedAssetId,
      selectedFrameIndex: frameIndex,
      playFrameIndex: frameIndex,
      isPlaying: false,
      maskPngBase64: null
    })
  },

  selectFrameIndex: (idx) => {
    const clamped = Math.max(0, idx)
    set({ selectedFrameIndex: clamped, playFrameIndex: clamped, isPlaying: false })
  },
  setIsPlaying: (isPlaying) =>
    set((s) => ({
      isPlaying,
      playFrameIndex: isPlaying ? s.selectedFrameIndex : s.playFrameIndex
    })),
  setPlayFrameIndex: (idx) => set({ playFrameIndex: Math.max(0, idx) }),
  setOnionSkin: (onionSkin) => set({ onionSkin }),
  setMaskPngBase64: (b64) => set({ maskPngBase64: b64 }),

  loadBlobDataUrl: async (sha256) => {
    if (!sha256) return null
    const cached = get().blobCache[sha256]
    if (cached) return cached
    try {
      const b64 = await window.pixelStudio.readBlobBase64(sha256)
      const url = `data:image/png;base64,${b64}`
      set((s) => ({ blobCache: { ...s.blobCache, [sha256]: url } }))
      return url
    } catch {
      return null
    }
  },

  setActiveModal: (m) => set({ activeModal: m }),
  setFeedback: (uiFeedbackState, statusMessage) => set({ uiFeedbackState, statusMessage }),
  setErrorBanner: (errorBanner) => set({ errorBanner }),
  setLastPlanPreview: (lastPlanPreview) => set({ lastPlanPreview }),

  togglePanel: (side) =>
    set((s) =>
      side === 'left'
        ? { leftCollapsed: !s.leftCollapsed }
        : side === 'right'
          ? { rightCollapsed: !s.rightCollapsed }
          : { bottomCollapsed: !s.bottomCollapsed }
    ),

  setPanelSize: (side, px) =>
    set(() =>
      side === 'left'
        ? { leftWidth: Math.max(200, Math.min(360, px)) }
        : side === 'right'
          ? { rightWidth: Math.max(300, Math.min(480, px)) }
          : { bottomHeight: Math.max(150, Math.min(360, px)) }
    ),

  updateJobRealtime: (job) => {
    const proj = get().project
    if (!proj) return
    const exists = proj.jobs.some((j) => j.jobId === job.jobId)
    const jobs = exists
      ? proj.jobs.map((j) => (j.jobId === job.jobId ? job : j))
      : [job, ...proj.jobs]
    set({
      project: { ...proj, jobs },
      uiFeedbackState:
        job.status === 'running'
          ? 'running'
          : job.status === 'queued'
            ? 'queued'
            : job.status === 'failed'
              ? 'failed'
              : job.status === 'cancelled'
                ? 'cancelled'
                : 'draft_ready'
    })
  }
}))

export function getSelectedAsset(state: StudioStoreState): Asset | null {
  if (!state.project || !state.selectedAssetId) return null
  return state.project.assets.find((a) => a.assetId === state.selectedAssetId) ?? null
}

export function getSelectedRevision(state: StudioStoreState): AssetRevision | null {
  if (!state.project || !state.selectedAssetId) return null
  const asset = getSelectedAsset(state)
  const revId = state.selectedRevisionId ?? asset?.approvedRevisionId ?? asset?.latestRevisionId
  if (!revId) return null
  return state.project.revisions.find((r) => r.revisionId === revId) ?? null
}

export function getSelectedClip(state: StudioStoreState): Clip | null {
  if (!state.project || !state.selectedClipId) return null
  return state.project.clips.find((c) => c.clipId === state.selectedClipId) ?? null
}
