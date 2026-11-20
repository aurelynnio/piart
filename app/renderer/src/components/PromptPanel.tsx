import React, { useEffect, useState } from 'react'
import {
  Play,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  BookmarkPlus,
  History,
  Plus,
  Wrench,
  Layers
} from 'lucide-react'
import {
  getSelectedAsset,
  getSelectedClip,
  getSelectedRevision,
  useStudioStore
} from '../store/useStudioStore'
import type {
  ContentType,
  JobRecord,
  LoopMode,
  WorkflowPlan
} from '@domain/schemas/types'
import type { PromptFormState, ResolutionResult } from '@domain/rules/parameterResolver'
import type { ProjectFullState } from '../../../main/db/projectStore'

const SOURCE_LABELS: Record<string, string> = {
  selected: 'Đã chọn',
  prompt: 'Từ prompt',
  asset: 'Từ asset',
  preset: 'Từ preset',
  default: 'Mặc định'
}

const QUICK_CHIPS = [
  { label: 'NPC 4 hướng', text: 'Tạo thợ mộc đeo tạp dề nâu. Cho nhân vật đi bộ, bước chân chắc và nhịp đều.', mode: 'create' as const },
  { label: 'Phòng 10×8', text: 'Tạo xưởng mộc 10 × 8 ô, có bàn, ghế và tủ hai ô ngang. Tủ có clip mở 6 frame. Đặt cửa ra vào ở phía dưới.', mode: 'create' as const },
  { label: 'Chậm 20%', text: 'Cho clip đi trái chậm hơn 20%.', mode: 'edit' as const }
]

export const PromptPanel: React.FC = () => {
  const state = useStudioStore()
  const {
    project,
    settings,
    selectedFrameIndex,
    blobCache,
    maskPngBase64,
    lastPlanPreview,
    setLastPlanPreview,
    setProjectState,
    selectAsset,
    selectClip,
    setFeedback,
    setErrorBanner
  } = state

  const selectedAsset = getSelectedAsset(state)
  const selectedClip = getSelectedClip(state)
  const selectedRevision = getSelectedRevision(state)

  const [mode, setMode] = useState<'create' | 'edit'>('create')
  const [contentType, setContentType] = useState<ContentType>('auto')
  const [promptText, setPromptText] = useState('')

  const [spriteW, setSpriteW] = useState<number>(32)
  const [spriteH, setSpriteH] = useState<number>(48)
  const [spriteSizeMode, setSpriteSizeMode] = useState<'auto' | 'selected' | 'project'>('auto')

  const [directionCount, setDirectionCount] = useState<number>(4)
  const [dirMode, setDirMode] = useState<'auto' | 'selected'>('auto')

  const [framesPerDir, setFramesPerDir] = useState<number>(6)
  const [framesMode, setFramesMode] = useState<'auto' | 'selected'>('auto')

  const [fps, setFps] = useState<number>(8)
  const [fpsMode, setFpsMode] = useState<'auto' | 'selected'>('auto')

  const [loopMode, setLoopMode] = useState<LoopMode>('loop')
  const [tileSizePx, setTileSizePx] = useState<number>(32)
  const [tileSizeMode, setTileSizeMode] = useState<'auto' | 'selected' | 'project'>('project')

  const [mapCols, setMapCols] = useState<number>(10)
  const [mapRows, setMapRows] = useState<number>(8)
  const [variantCount, setVariantCount] = useState<number>(1)
  const [enforcePalette, setEnforcePalette] = useState<boolean>(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showTechDetails, setShowTechDetails] = useState(false)

  const [conflictResolutions, setConflictResolutions] = useState<Record<string, 'form' | 'prompt'>>({})
  const [disambiguationSelections, setDisambiguationSelections] = useState<Record<string, string>>({})
  const [editablePlan, setEditablePlan] = useState<WorkflowPlan | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (maskPngBase64) setMode('edit')
  }, [maskPngBase64])

  // Sync auto-mode displayed dimensions & clip parameters with the currently inspected asset/clip
  useEffect(() => {
    if (spriteSizeMode === 'auto') {
      const targetSize = selectedClip?.canvasPx ?? selectedRevision?.canvasPx
      if (targetSize) {
        setSpriteW(targetSize.w)
        setSpriteH(targetSize.h)
      }
    }
    if (framesMode === 'auto' && selectedClip) {
      setFramesPerDir(selectedClip.frames.length)
    }
    if (fpsMode === 'auto' && selectedClip) {
      setFps(selectedClip.fps)
    }
  }, [selectedClip, selectedRevision, spriteSizeMode, framesMode, fpsMode])

  if (!project) return null

  const buildForm = (): PromptFormState => ({
    mode,
    contentType,
    promptText,
    spriteSize: { value: { w: spriteW, h: spriteH }, mode: spriteSizeMode },
    directionCount: { value: directionCount, mode: dirMode },
    framesPerDirection: { value: framesPerDir, mode: framesMode },
    fps: { value: fps, mode: fpsMode },
    loopMode: { value: loopMode, mode: 'auto' },
    tileSizePx: { value: tileSizePx, mode: tileSizeMode },
    mapGrid: { value: { cols: mapCols, rows: mapRows }, mode: 'auto' },
    enforcePalette: { value: enforcePalette, mode: 'selected' },
    variantCount: { value: variantCount, mode: 'selected' }
  })

  const handleAnalyzePlan = async (
    overrideConflicts?: Record<string, 'form' | 'prompt'>,
    overrideDisambig?: Record<string, string>
  ) => {
    if (!promptText.trim()) return null
    setFeedback('analyzing', 'Đang phân tích prompt & thông số...')
    try {
      const res = (await window.pixelStudio.previewPlan({
        form: buildForm(),
        targetAssetId: mode === 'edit' ? selectedAsset?.assetId ?? null : null,
        targetClipId: mode === 'edit' ? selectedClip?.clipId ?? null : null,
        targetFrameIndex: mode === 'edit' && selectedClip ? selectedFrameIndex : null,
        hasMask: Boolean(maskPngBase64),
        conflictResolutions: overrideConflicts ?? conflictResolutions,
        disambiguationSelections: overrideDisambig ?? disambiguationSelections
      })) as { resolution: ResolutionResult; plan: WorkflowPlan }

      setLastPlanPreview(res)
      setEditablePlan(res.plan)
      if (!res.resolution.canExecute) {
        setFeedback('needs_resolution', 'Cần chốt thông số mâu thuẫn trước khi chạy')
      } else {
        setFeedback('draft_ready', `Kế hoạch sẵn sàng (${res.plan.steps.length} bước)`)
      }
      return res
    } catch (err) {
      setFeedback('failed', 'Phân tích kế hoạch thất bại')
      setErrorBanner({
        title: 'Lỗi phân tích prompt',
        reason: err instanceof Error ? err.message : String(err),
        preserved: 'Chưa gọi API sinh ảnh.'
      })
      return null
    }
  }

  const handleExecute = async () => {
    if (!promptText.trim()) return
    const preview = await handleAnalyzePlan()
    if (!preview || !preview.resolution.canExecute) return

    setBusy(true)
    setFeedback('running', 'Đang thực thi kế hoạch...')
    try {
      const res = (await window.pixelStudio.runWorkflow({
        form: buildForm(),
        planOverride: editablePlan ?? preview.plan,
        targetAssetId: mode === 'edit' ? selectedAsset?.assetId ?? null : null,
        targetClipId: mode === 'edit' ? selectedClip?.clipId ?? null : null,
        targetFrameIndex: mode === 'edit' && selectedClip ? selectedFrameIndex : null,
        maskPngBase64: mode === 'edit' ? maskPngBase64 : null,
        conflictResolutions,
        disambiguationSelections
      })) as { job: JobRecord; state: ProjectFullState }

      setProjectState(res.state)
      const firstClipId = res.job.steps.flatMap((s) => s.outputClipIds)[0]
      const firstAssetId = res.job.steps.flatMap((s) => s.outputAssetIds)[0]
      if (firstClipId) selectClip(firstClipId, 0)
      else if (firstAssetId) selectAsset(firstAssetId)

      if (res.job.status === 'succeeded') {
        setFeedback('draft_ready', 'Hoàn thành! Hãy xem trước và duyệt kết quả.')
      } else {
        const failedStep = res.job.steps.find((s) => s.status === 'failed')
        setFeedback('failed', failedStep?.errorMessage || 'Một số bước thất bại')
        setErrorBanner({
          title: `Tác vụ ${res.job.jobId} dừng ở trạng thái ${res.job.status}`,
          reason: failedStep?.errorMessage || 'Lỗi thực thi bước.',
          preserved: `Đã bảo toàn ${res.job.steps.filter((s) => s.status === 'succeeded').length}/${res.job.steps.length} bước hoàn tất.`
        })
      }
    } catch (err) {
      setFeedback('failed', 'Thực thi thất bại')
      setErrorBanner({
        title: 'Không thể chạy tác vụ',
        reason: err instanceof Error ? err.message : String(err),
        preserved: 'Dữ liệu hiện có vẫn an toàn.'
      })
    } finally {
      setBusy(false)
    }
  }

  const handleSaveTemplate = async () => {
    if (!promptText.trim()) return
    const name = window.prompt('Đặt tên cho mẫu prompt:')
    if (!name?.trim()) return
    const nextState = (await window.pixelStudio.savePromptTemplate({
      templateId: `tpl_${Date.now()}`,
      name: name.trim(),
      category: contentType,
      promptText,
      options: { spriteW, spriteH, directionCount, framesPerDir, fps, loopMode },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })) as ProjectFullState
    setProjectState(nextState)
    setFeedback('approved', `Đã lưu mẫu prompt "${name.trim()}"`)
  }

  const applyTemplate = (tplId: string) => {
    const tpl = project.promptTemplates.find((t) => t.templateId === tplId)
    if (!tpl) return
    setPromptText(tpl.promptText)
    setContentType(tpl.category)
    const opts = tpl.options as Record<string, any>
    if (opts.spriteSize) {
      setSpriteW(opts.spriteSize.w)
      setSpriteH(opts.spriteSize.h)
      setSpriteSizeMode('selected')
    }
    if (opts.directionCount) {
      setDirectionCount(opts.directionCount)
      setDirMode('selected')
    }
    if (opts.framesPerDirection) {
      setFramesPerDir(opts.framesPerDirection)
      setFramesMode('selected')
    }
    if (opts.fps) {
      setFps(opts.fps)
      setFpsMode('selected')
    }
  }

  const replayLastJob = () => {
    const last = project.jobs[0]
    if (!last) return
    setMode(last.snapshot.mode)
    setContentType(last.snapshot.contentType)
    setPromptText(last.snapshot.promptText)
    setFeedback('draft_ready', `Đã mở lại đầu vào từ ${last.jobId}`)
  }

  const fieldSources = lastPlanPreview?.resolution.fieldSources ?? {}
  const conflicts = lastPlanPreview?.resolution.conflicts ?? []
  const disambiguations = lastPlanPreview?.resolution.disambiguations ?? []

  const activeFrameHash =
    selectedClip?.frames[selectedFrameIndex]?.blobHash ??
    selectedRevision?.normalizedBlobHash ??
    null
  const activeThumbUrl = activeFrameHash ? blobCache[activeFrameHash] : null

  return (
    <aside
      style={{
        height: '100%',
        background: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border-divider)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Top Mode Switcher */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-divider)', flexShrink: 0 }}>
        <div className="segmented" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <button
            className={mode === 'create' ? 'seg-active-accent' : ''}
            style={{ padding: '5px 8px' }}
            onClick={() => setMode('create')}
            data-testid="tab-mode-create"
          >
            <Plus size={13} strokeWidth={2} /> Tạo mới
          </button>
          <button
            className={mode === 'edit' ? 'seg-active-accent' : ''}
            style={{ padding: '5px 8px' }}
            onClick={() => setMode('edit')}
            data-testid="tab-mode-edit"
          >
            <Wrench size={13} strokeWidth={1.75} /> Sửa mục tiêu
          </button>
        </div>
      </div>

      {/* Scrollable Body: Target Context -> Prompt -> Core Params -> Advanced */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Active Asset / Frame Context Strip (Always visible so user knows what is active) */}
        <div
          style={{
            background: 'var(--bg-panel-subtle)',
            border: '1px solid var(--border-divider)',
            borderLeft: `2px solid ${
              mode === 'edit'
                ? maskPngBase64
                  ? 'var(--status-mask)'
                  : 'var(--accent)'
                : 'var(--border-strong)'
            }`,
            borderRadius: 'var(--radius-sm)',
            padding: '7px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0
          }}
          data-testid="edit-target-pill"
        >
          {activeThumbUrl && (
            <div
              className="checkerboard"
              style={{
                width: 28,
                height: 28,
                borderRadius: 3,
                border: '1px solid var(--border-divider)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                overflow: 'hidden'
              }}
            >
              <img src={activeThumbUrl} alt="" className="pixelated" style={{ maxWidth: 24, maxHeight: 24, display: 'block' }} />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 10.5,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                whiteSpace: 'nowrap'
              }}
            >
              <span>{mode === 'edit' ? 'Mục tiêu sửa' : 'Đang mở'}</span>
              {mode === 'edit' && maskPngBase64 ? (
                <span className="badge mask" style={{ padding: '0 5px', fontSize: 10 }}>Mask AI</span>
              ) : (selectedClip || selectedRevision) ? (
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                  {(selectedClip?.canvasPx.w ?? selectedRevision?.canvasPx.w ?? spriteW)}×{(selectedClip?.canvasPx.h ?? selectedRevision?.canvasPx.h ?? spriteH)} px
                  {selectedClip ? ` · ${selectedClip.frames.length}f · ${selectedClip.fps}fps` : ''}
                </span>
              ) : null}
            </div>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: mode === 'edit' ? (maskPngBase64 ? 'var(--status-mask)' : 'var(--accent)') : 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {selectedClip
                ? `${selectedClip.name} · Frame #${selectedFrameIndex + 1}`
                : selectedAsset
                  ? selectedAsset.name
                  : 'Chưa chọn tài nguyên'}
            </div>
          </div>
        </div>

        {/* Prompt Composer (flexShrink: 0 prevents vertical clipping at 720p) */}
        <div className="prompt-composer">
          <textarea
            rows={3}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                handleExecute()
              }
            }}
            placeholder={
              mode === 'create'
                ? 'Mô tả bằng tiếng Việt hoặc English... VD: Tạo thợ mộc đeo tạp dề nâu đi bộ 4 hướng.'
                : 'VD: Cho clip đi trái chậm hơn 20%. Hoặc: Chỉnh tay cầm búa thấp xuống.'
            }
            data-testid="textarea-prompt"
          />
          <div
            style={{
              padding: '4px 8px',
              borderTop: '1px solid var(--border-hairline)',
              background: 'var(--bg-panel-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              flexShrink: 0
            }}
          >
            <select
              value=""
              onChange={(e) => applyTemplate(e.target.value)}
              aria-label="Áp dụng mẫu prompt"
              style={{ flex: 1, padding: '3px 20px 3px 4px', fontSize: 11.5, border: 'none', background: 'transparent' }}
            >
              <option value="">Mẫu ({project.promptTemplates.length})...</option>
              {project.promptTemplates.map((t) => (
                <option key={t.templateId} value={t.templateId}>
                  {t.name}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <button className="ghost" style={{ padding: 4 }} onClick={handleSaveTemplate} title="Lưu làm mẫu prompt">
                <BookmarkPlus size={13} strokeWidth={1.75} />
              </button>
              <button className="ghost" style={{ padding: 4 }} onClick={replayLastJob} disabled={project.jobs.length === 0} title="Mở lại lần chạy trước">
                <History size={13} strokeWidth={1.75} />
              </button>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 4 }}>
                Ctrl+↵
              </span>
            </div>
          </div>
        </div>

        {/* Compact Quick-Prompt Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flexShrink: 0 }}>
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip.label}
              className="ghost"
              style={{
                padding: '3px 7px',
                fontSize: 11,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-divider)',
                background: 'var(--bg-panel-subtle)',
                color: 'var(--text-secondary)'
              }}
              onClick={() => {
                setMode(chip.mode)
                setPromptText(chip.text)
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Core Creation Parameters (shown directly in Create mode; tucked into Override toggle in Edit mode) */}
        {(mode === 'create' || showAdvanced) && (
          <div
            style={{
              borderTop: '1px solid var(--border-divider)',
              paddingTop: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flexShrink: 0
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span className="section-title" style={{ margin: 0 }}>Loại nội dung</span>
                {lastPlanPreview && (
                  <span className="badge info" style={{ fontSize: 10 }}>{lastPlanPreview.resolution.resolvedContentType}</span>
                )}
              </div>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value as ContentType)}
                data-testid="select-content-type"
              >
                <option value="auto">Tự động (Auto)</option>
                <option value="character">Nhân vật</option>
                <option value="furniture_item">Nội thất & Vật phẩm</option>
                <option value="animation">Animation</option>
                <option value="tileset">Tileset</option>
                <option value="map">Bản đồ (Map / Scene)</option>
                <option value="ui_vfx">UI & VFX</option>
                <option value="dialogue_quest">Hội thoại & Nhiệm vụ</option>
                <option value="content_pack">Gói nhiều đầu ra</option>
              </select>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Kích thước (px)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      color: spriteSizeMode === 'selected' ? 'var(--accent)' : 'var(--text-muted)'
                    }}
                  >
                    {SOURCE_LABELS[fieldSources.spriteSize ?? spriteSizeMode] ?? 'Tự động'}
                  </span>
                  <button
                    className="ghost"
                    style={{ padding: '1px 5px', fontSize: 10.5 }}
                    onClick={() => {
                      setSpriteW(project.config.defaultCanvasPx.w)
                      setSpriteH(project.config.defaultCanvasPx.h)
                      setSpriteSizeMode('project')
                    }}
                  >
                    Theo dự án
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  type="number"
                  value={spriteW}
                  min={8}
                  max={512}
                  className="mono"
                  aria-label="Chiều rộng (px)"
                  data-testid="input-sprite-w"
                  onChange={(e) => {
                    setSpriteW(Number(e.target.value) || 32)
                    setSpriteSizeMode('selected')
                  }}
                />
                <input
                  type="number"
                  value={spriteH}
                  min={8}
                  max={512}
                  className="mono"
                  aria-label="Chiều cao (px)"
                  data-testid="input-sprite-h"
                  onChange={(e) => {
                    setSpriteH(Number(e.target.value) || 32)
                    setSpriteSizeMode('selected')
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <label>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Hướng</div>
                <select
                  value={directionCount}
                  onChange={(e) => {
                    setDirectionCount(Number(e.target.value))
                    setDirMode('selected')
                  }}
                >
                  <option value={1}>1</option>
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                </select>
              </label>
              <label>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Frames</div>
                <input
                  type="number"
                  value={framesPerDir}
                  min={1}
                  max={32}
                  className="mono"
                  onChange={(e) => {
                    setFramesPerDir(Number(e.target.value) || 6)
                    setFramesMode('selected')
                  }}
                />
              </label>
              <label>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>FPS</div>
                <input
                  type="number"
                  value={fps}
                  min={1}
                  max={60}
                  className="mono"
                  onChange={(e) => {
                    setFps(Number(e.target.value) || 8)
                    setFpsMode('selected')
                  }}
                />
              </label>
            </div>
          </div>
        )}

        {/* Inline Conflict Resolution Card (A02 & F013) */}
        {conflicts.length > 0 && (
          <div
            style={{
              background: 'rgba(229, 169, 78, 0.1)',
              border: '1px solid rgba(229, 169, 78, 0.5)',
              borderRadius: 'var(--radius-md)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              flexShrink: 0
            }}
            data-testid="conflict-box"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--status-warning)', fontWeight: 600, fontSize: 12 }}>
              <AlertTriangle size={14} />
              Mâu thuẫn thông số (0 lượt gọi ảnh)
            </div>
            {conflicts.map((c) => {
              const fmt = (v: unknown) =>
                typeof v === 'object' && v && 'w' in (v as any)
                  ? `${(v as any).w} × ${(v as any).h}`
                  : String(v)
              return (
                <div key={c.field} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <strong>{c.label}</strong>: Form <span className="mono">{fmt(c.formValue)}</span> vs. Prompt{' '}
                    <span className="mono">{fmt(c.promptValue)}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      className={conflictResolutions[c.field] === 'form' ? 'primary' : ''}
                      data-testid={`resolve-conflict-form-${c.field}`}
                      onClick={() => {
                        const next = { ...conflictResolutions, [c.field]: 'form' as const }
                        setConflictResolutions(next)
                        handleAnalyzePlan(next)
                      }}
                    >
                      Giữ {fmt(c.formValue)}
                    </button>
                    <button
                      className={conflictResolutions[c.field] === 'prompt' ? 'primary' : ''}
                      data-testid={`resolve-conflict-prompt-${c.field}`}
                      onClick={() => {
                        const next = { ...conflictResolutions, [c.field]: 'prompt' as const }
                        setConflictResolutions(next)
                        handleAnalyzePlan(next)
                      }}
                    >
                      Dùng {fmt(c.promptValue)}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Disambiguation Picker */}
        {disambiguations.length > 0 && (
          <div
            style={{
              background: 'rgba(118, 169, 219, 0.1)',
              border: '1px solid rgba(118, 169, 219, 0.45)',
              borderRadius: 'var(--radius-md)',
              padding: 10,
              flexShrink: 0
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Chọn đúng đối tượng trùng tên:</div>
            {disambiguations.map((d) => (
              <div key={d.mentionText} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 12 }}>@{d.mentionText}</div>
                {d.candidates.map((cand) => (
                  <button
                    key={cand.assetId}
                    className={disambiguationSelections[d.mentionText] === cand.assetId ? 'active' : ''}
                    onClick={() => {
                      const next = { ...disambiguationSelections, [d.mentionText]: cand.assetId }
                      setDisambiguationSelections(next)
                      handleAnalyzePlan(undefined, next)
                    }}
                  >
                    {cand.name} ({cand.type} · {cand.folderName})
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Collapsible Advanced / Parameter Override Group */}
        <div style={{ borderTop: '1px solid var(--border-divider)', paddingTop: 8, flexShrink: 0 }}>
          <button
            className="ghost"
            style={{ width: '100%', justifyContent: 'space-between', padding: '4px 2px', fontSize: 12 }}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {mode === 'edit' ? 'Ghi đè thông số & nâng cao' : 'Tùy chọn nâng cao'}
            </span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
              {mode === 'edit' ? `${spriteW}×${spriteH} · ${fps}fps` : `${loopMode} · ${tileSizePx}px`}
            </span>
          </button>

          {showAdvanced && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Kiểu lặp</div>
                  <select value={loopMode} onChange={(e) => setLoopMode(e.target.value as LoopMode)}>
                    <option value="loop">Loop</option>
                    <option value="once">Once</option>
                    <option value="ping_pong">Ping-pong</option>
                  </select>
                </label>
                <label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Ô Tile (px)</div>
                  <input
                    type="number"
                    value={tileSizePx}
                    min={8}
                    max={256}
                    className="mono"
                    onChange={(e) => {
                      setTileSizePx(Number(e.target.value) || 32)
                      setTileSizeMode('selected')
                    }}
                  />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Cột bản đồ</div>
                  <input type="number" value={mapCols} min={4} max={128} className="mono" onChange={(e) => setMapCols(Number(e.target.value) || 10)} />
                </label>
                <label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Hàng bản đồ</div>
                  <input type="number" value={mapRows} min={4} max={128} className="mono" onChange={(e) => setMapRows(Number(e.target.value) || 8)} />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
                <label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Số phương án</div>
                  <input type="number" value={variantCount} min={1} max={4} className="mono" onChange={(e) => setVariantCount(Number(e.target.value) || 1)} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16 }}>
                  <input type="checkbox" checked={enforcePalette} onChange={(e) => setEnforcePalette(e.target.checked)} />
                  <span style={{ fontSize: 12 }}>Ép bảng màu</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Editable Multi-Output Plan Preview */}
        {editablePlan && (
          <div
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-divider)',
              borderRadius: 'var(--radius-md)',
              padding: 10,
              flexShrink: 0
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Layers size={13} color="var(--accent)" />
                Kế hoạch ({editablePlan.steps.length} bước)
              </strong>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                Ảnh ~{editablePlan.estimatedSummary.imageApiCalls} · Cục bộ {editablePlan.estimatedSummary.localSteps}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {editablePlan.steps.map((step, idx) => (
                <label
                  key={step.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11.5,
                    padding: '4px 6px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-panel)'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={step.enabled}
                    onChange={(e) => {
                      const nextSteps = editablePlan.steps.map((s, i) =>
                        i === idx ? { ...s, enabled: e.target.checked } : s
                      )
                      setEditablePlan({ ...editablePlan, steps: nextSteps })
                    }}
                  />
                  <span style={{ flex: 1 }}>{step.title || step.operation}</span>
                  <span className="badge" style={{ fontSize: 10 }}>{step.kind === 'deterministic' ? 'Cục bộ' : step.kind}</span>
                </label>
              ))}
            </div>
            <button
              className="ghost"
              style={{ fontSize: 11, marginTop: 6, padding: '2px 4px' }}
              onClick={() => setShowTechDetails(!showTechDetails)}
            >
              {showTechDetails ? 'Ẩn JSON' : 'Xem chi tiết JSON'}
            </button>
            {showTechDetails && (
              <pre className="mono" style={{ fontSize: 10, maxHeight: 160, overflow: 'auto', background: 'var(--bg-canvas-well)', padding: 8, borderRadius: 4 }}>
                {JSON.stringify(editablePlan, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Sticky Footer Primary Action Bar */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid var(--border-divider)',
          background: 'var(--bg-panel-subtle)',
          display: 'flex',
          gap: 8,
          flexShrink: 0
        }}
      >
        <button
          onClick={() => handleAnalyzePlan()}
          disabled={busy || !promptText.trim()}
          style={{ flex: 1, padding: '7px 10px' }}
          data-testid="btn-preview-plan"
        >
          Phân tích
        </button>
        <button
          className="primary"
          onClick={handleExecute}
          disabled={busy || !promptText.trim() || (settings?.offlineMode && settings.activeProviderId !== 'mock' && !lastPlanPreview?.resolution.hints.deterministicEdit)}
          style={{ flex: 1.35, padding: '7px 10px' }}
          data-testid="btn-run-prompt"
        >
          <Play size={13} strokeWidth={2} />
          {busy ? 'Đang chạy...' : mode === 'create' ? 'Tạo ngay' : 'Áp dụng sửa'}
        </button>
      </div>
    </aside>
  )
}
