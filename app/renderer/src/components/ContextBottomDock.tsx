import React, { useEffect, useState } from 'react'
import {
  Lock,
  Unlock,
  Copy,
  Trash2,
  Plus,
  Flag,
  ArrowLeftRight,
  AlertTriangle,
  Check,
  RotateCcw,
  Film,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Layers,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import {
  getSelectedAsset,
  getSelectedClip,
  useStudioStore
} from '../store/useStudioStore'
import type { ProjectFullState } from '../../../main/db/projectStore'

const FRAME_COL_WIDTH = 100

export const ContextBottomDock: React.FC = () => {
  const state = useStudioStore()
  const {
    project,
    selectedFrameIndex,
    isPlaying,
    playFrameIndex,
    onionSkin,
    selectFrameIndex,
    setIsPlaying,
    setOnionSkin,
    selectClip,
    loadBlobDataUrl,
    setProjectState,
    setFeedback
  } = state

  const asset = getSelectedAsset(state)
  const clip = getSelectedClip(state)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!project) return
    const hashes = new Set<string>()
    if (clip) {
      for (const f of clip.frames) hashes.add(f.blobHash)
    }
    if (asset) {
      for (const r of project.revisions.filter((x) => x.assetId === asset.assetId)) {
        if (r.normalizedBlobHash) hashes.add(r.normalizedBlobHash)
      }
    }
    for (const h of hashes) {
      if (!thumbs[h]) {
        loadBlobDataUrl(h).then((url) => {
          if (url) setThumbs((prev) => ({ ...prev, [h]: url }))
        })
      }
    }
  }, [clip, asset, project, loadBlobDataUrl, thumbs])

  if (!project || !asset) return null

  // ---- PRECISION GRID ANIMATION TIMELINE ----
  if (clip) {
    const totalMs = Math.max(1, clip.frames.reduce((acc, f) => acc + f.durationMs, 0))
    let cumulative = 0
    const frameStarts = clip.frames.map((f) => {
      const start = cumulative
      cumulative += f.durationMs
      return { start, end: cumulative }
    })

    const currentDisplayIdx = isPlaying
      ? playFrameIndex % Math.max(1, clip.frames.length)
      : Math.min(selectedFrameIndex, Math.max(0, clip.frames.length - 1))
    const activeStart = frameStarts[currentDisplayIdx]?.start ?? 0
    const activeFrame = clip.frames[currentDisplayIdx] ?? clip.frames[0]

    const updateClip = async (next: typeof clip, label: string) => {
      const s = (await window.pixelStudio.saveClip(next, label)) as ProjectFullState
      setProjectState(s)
      setFeedback('draft_ready', label)
    }

    const handleFrameDuration = (idx: number, ms: number) => {
      const frames = clip.frames.map((f, i) => (i === idx ? { ...f, durationMs: Math.max(1, ms) } : f))
      updateClip({ ...clip, frames }, `Đổi thời lượng frame #${idx + 1}`)
    }

    const handleToggleLock = (idx: number) => {
      const frames = clip.frames.map((f, i) => (i === idx ? { ...f, isLocked: !f.isLocked } : f))
      updateClip({ ...clip, frames }, `Khóa/mở khóa frame #${idx + 1}`)
    }

    const handleDuplicateFrame = (idx: number) => {
      const src = clip.frames[idx]
      if (!src) return
      const copy = { ...src, frameId: `frm_${Date.now()}`, isIntentionalHold: true }
      const frames = [...clip.frames.slice(0, idx + 1), copy, ...clip.frames.slice(idx + 1)].map((f, i) => ({
        ...f,
        slotIndex: i
      }))
      updateClip({ ...clip, frames }, `Nhân bản frame #${idx + 1}`)
    }

    const handleDeleteFrame = (idx: number) => {
      if (clip.frames.length <= 1) return
      const frames = clip.frames
        .filter((_, i) => i !== idx)
        .map((f, i) => ({ ...f, slotIndex: i }))
      selectFrameIndex(Math.min(idx, frames.length - 1))
      updateClip({ ...clip, frames }, `Xóa frame #${idx + 1}`)
    }

    const handleMoveFrame = (idx: number, delta: number) => {
      const target = idx + delta
      if (target < 0 || target >= clip.frames.length) return
      const arr = [...clip.frames]
      const [item] = arr.splice(idx, 1)
      arr.splice(target, 0, item)
      const frames = arr.map((f, i) => ({ ...f, slotIndex: i }))
      let acc = 0
      const frameStart = new Map<string, number>()
      for (const f of frames) {
        frameStart.set(f.frameId, acc)
        acc += f.durationMs
      }
      const events = clip.events.map((ev) => ({
        ...ev,
        timeMs: frameStart.get(ev.frameId) ?? ev.timeMs
      }))
      selectFrameIndex(target)
      updateClip({ ...clip, frames, events }, 'Sắp xếp thứ tự frame')
    }

    const handleAddEventMarker = () => {
      const frame = clip.frames[currentDisplayIdx]
      if (!frame) return
      const name = window.prompt('Tên sự kiện (VD: footstep_left, door_shut):', 'footstep')
      if (!name?.trim()) return
      const timeMs = frameStarts[currentDisplayIdx]?.start ?? 0
      const events = [
        ...clip.events,
        { eventId: `evt_${Date.now()}`, name: name.trim(), frameId: frame.frameId, timeMs, payload: {} }
      ]
      updateClip({ ...clip, events }, `Gắn marker sự kiện "${name.trim()}"`)
    }

    const handleCloneReverse = async (reverse: boolean) => {
      const res = (await window.pixelStudio.duplicateOrReverseClip(clip.clipId, reverse)) as {
        clip: typeof clip
        state: ProjectFullState
      }
      setProjectState(res.state)
      selectClip(res.clip.clipId, 0)
      setFeedback('draft_ready', reverse ? 'Đã tạo clip đảo ngược' : 'Đã sao chép clip')
    }

    const handleStepFrame = (delta: number) => {
      const count = clip.frames.length
      if (count <= 0) return
      const next = (currentDisplayIdx + delta + count) % count
      selectFrameIndex(next)
    }

    const speedLabel = clip.playbackSpeed && clip.playbackSpeed !== 1 ? ` · ${clip.playbackSpeed.toFixed(1)}×` : ''

    return (
      <section
        style={{
          height: '100%',
          background: 'var(--bg-panel)',
          borderTop: '1px solid var(--border-divider)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Unified Timeline Toolbar: Clip Info (Left) + Selected Frame Actions (Center) + Clip Operations (Right) */}
        <div
          style={{
            height: 34,
            padding: '0 12px',
            borderBottom: '1px solid var(--border-divider)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexShrink: 0
          }}
        >
          {/* Left: Clip Title & Summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Film size={13} strokeWidth={1.75} color="var(--accent)" style={{ flexShrink: 0 }} />
            <strong
              style={{
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              title={clip.name}
            >
              {clip.name}
            </strong>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {clip.frames.length}f · {clip.fps}fps · {totalMs}ms
              {speedLabel}
            </span>
          </div>

          {/* Right: Active Frame Inspector Bar + Clip Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {activeFrame && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  background: 'var(--bg-panel-subtle)',
                  border: '1px solid var(--border-divider)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px 5px'
                }}
              >
                <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginRight: 1 }}>
                  #{currentDisplayIdx + 1}
                </span>
                <input
                  type="number"
                  value={activeFrame.durationMs}
                  min={10}
                  max={5000}
                  onChange={(e) => handleFrameDuration(currentDisplayIdx, Number(e.target.value) || 100)}
                  className="mono"
                  aria-label="Thời lượng frame đang chọn (ms)"
                  style={{ width: 38, padding: '1px 3px', fontSize: 10.5, borderRadius: 3, textAlign: 'right' }}
                />
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 1 }}>ms</span>

                <span className="divider-v" style={{ height: 12 }} />

                <button
                  className={activeFrame.isLocked ? 'active icon-btn' : 'ghost icon-btn'}
                  style={{ width: 20, height: 20 }}
                  onClick={() => handleToggleLock(currentDisplayIdx)}
                  title={activeFrame.isLocked ? 'Mở khóa frame đang chọn' : 'Khóa frame đang chọn'}
                >
                  {activeFrame.isLocked ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
                <button
                  className="ghost icon-btn"
                  style={{ width: 20, height: 20 }}
                  disabled={currentDisplayIdx <= 0}
                  onClick={() => handleMoveFrame(currentDisplayIdx, -1)}
                  title="Dời frame sang trái"
                >
                  <ChevronLeft size={12} />
                </button>
                <button
                  className="ghost icon-btn"
                  style={{ width: 20, height: 20 }}
                  disabled={currentDisplayIdx >= clip.frames.length - 1}
                  onClick={() => handleMoveFrame(currentDisplayIdx, 1)}
                  title="Dời frame sang phải"
                >
                  <ChevronRight size={12} />
                </button>
                <button
                  className="ghost icon-btn"
                  style={{ width: 20, height: 20 }}
                  onClick={() => handleDuplicateFrame(currentDisplayIdx)}
                  title="Nhân bản frame đang chọn"
                >
                  <Copy size={11} />
                </button>
                <button
                  className="ghost icon-btn"
                  style={{ width: 20, height: 20 }}
                  disabled={clip.frames.length <= 1}
                  onClick={() => handleDeleteFrame(currentDisplayIdx)}
                  title="Xóa frame đang chọn"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )}

            <span className="divider-v" style={{ height: 14 }} />

            <button className="ghost" style={{ padding: '3px 6px', fontSize: 11 }} onClick={handleAddEventMarker} title="Gắn sự kiện vào frame đang chọn">
              <Flag size={11} strokeWidth={1.75} color="var(--status-info)" /> Sự kiện
            </button>
            <button className="ghost" style={{ padding: '3px 6px', fontSize: 11 }} onClick={() => handleCloneReverse(false)} title="Nhân bản toàn bộ clip">
              <Plus size={11} strokeWidth={1.75} /> Bản sao
            </button>
            <button className="ghost icon-btn" style={{ width: 24, height: 24 }} onClick={() => handleCloneReverse(true)} title="Tạo bản sao clip đảo ngược">
              <ArrowLeftRight size={12} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Dedicated Left Playback Control Zone + Right Aligned Frame Grid */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          {/* Left Playback & Transport Controls (tightly structured, no awkward middle void) */}
          <div
            style={{
              width: 148,
              flexShrink: 0,
              background: 'var(--bg-panel-subtle)',
              borderRight: '1px solid var(--border-divider)',
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 6
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  className="ghost icon-btn"
                  style={{ width: 26, height: 26 }}
                  onClick={() => handleStepFrame(-1)}
                  title="Frame trước"
                  aria-label="Frame trước"
                >
                  <SkipBack size={12} strokeWidth={1.75} />
                </button>
                <button
                  className={isPlaying ? 'active' : ''}
                  style={{ flex: 1, height: 26, padding: '0 8px', fontSize: 11.5 }}
                  onClick={() => setIsPlaying(!isPlaying)}
                  title="Phát / Dừng clip (Space)"
                  data-testid="btn-timeline-play"
                >
                  {isPlaying ? <Pause size={12} strokeWidth={2} /> : <Play size={12} strokeWidth={2} />}
                  {isPlaying ? 'Dừng' : 'Phát'}
                </button>
                <button
                  className="ghost icon-btn"
                  style={{ width: 26, height: 26 }}
                  onClick={() => handleStepFrame(1)}
                  title="Frame kế tiếp"
                  aria-label="Frame kế tiếp"
                >
                  <SkipForward size={12} strokeWidth={1.75} />
                </button>
              </div>

              <button
                className={onionSkin ? 'toggle-on' : 'ghost'}
                style={{
                  width: '100%',
                  height: 24,
                  justifyContent: 'center',
                  padding: '2px 8px',
                  fontSize: 11,
                  border: onionSkin ? undefined : '1px solid var(--border-divider)'
                }}
                onClick={() => setOnionSkin(!onionSkin)}
                title="Bật/tắt bóng mờ frame trước (Onion skin)"
              >
                <Layers size={11} strokeWidth={1.75} />
                Onion skin
              </button>
            </div>

            <div
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-divider)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5 }}>
                <span style={{ color: 'var(--text-muted)' }}>Frame</span>
                <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  #{currentDisplayIdx + 1} / {clip.frames.length}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5 }}>
                <span style={{ color: 'var(--text-muted)' }}>Mốc</span>
                <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                  {activeStart} / {totalMs} ms
                </span>
              </div>
            </div>
          </div>

          {/* Unified Ruler + Playhead + Clean Frame Thumbnail Strip */}
          <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ minWidth: 'fit-content', flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Playhead & Frame Number Grid Rail (exact 100px column match with thumbnails below) */}
              <div
                style={{
                  height: 24,
                  background: 'var(--bg-app)',
                  borderBottom: '1px solid var(--border-hairline)',
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'stretch',
                  gap: 8,
                  flexShrink: 0
                }}
              >
                {clip.frames.map((f, idx) => {
                  const isAct = idx === currentDisplayIdx
                  const hasEv = clip.events.some((e) => e.frameId === f.frameId)
                  const startMs = frameStarts[idx]?.start ?? 0
                  return (
                    <div
                      key={f.frameId}
                      onClick={() => selectFrameIndex(idx)}
                      title={`Frame #${idx + 1} · Bắt đầu tại ${startMs} ms (Thời lượng ${f.durationMs} ms)`}
                      style={{
                        width: FRAME_COL_WIDTH,
                        flexShrink: 0,
                        position: 'relative',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 4px',
                        borderTop: isAct ? '2px solid var(--accent)' : '2px solid transparent',
                        background: isAct ? 'var(--accent-soft)' : 'transparent'
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          fontWeight: isAct ? 700 : 500,
                          color: isAct ? 'var(--accent)' : 'var(--text-secondary)'
                        }}
                      >
                        #{idx + 1}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {hasEv && (
                          <span
                            title={`Sự kiện: ${clip.events.filter((e) => e.frameId === f.frameId).map((e) => e.name).join(', ')}`}
                            style={{
                              width: 6,
                              height: 6,
                              background: 'var(--status-info)',
                              transform: 'rotate(45deg)',
                              display: 'inline-block'
                            }}
                          />
                        )}
                        <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {startMs}ms
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Clean Frame Thumbnails Strip (no repeated inputs or 24 tiny buttons cramming the footer!) */}
              <div
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'stretch',
                  gap: 8,
                  minHeight: 0
                }}
              >
                {clip.frames.map((frame, idx) => {
                  const active = idx === currentDisplayIdx
                  return (
                    <div
                      key={frame.frameId}
                      onClick={() => selectFrameIndex(idx)}
                      data-testid={`timeline-frame-${idx}`}
                      className={`timeline-frame-cell ${active ? 'active' : ''}`}
                      style={{
                        width: FRAME_COL_WIDTH,
                        flexShrink: 0,
                        background: active ? 'rgba(241, 190, 107, 0.08)' : 'var(--bg-input)',
                        border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-divider)',
                        borderRadius: 'var(--radius-sm)',
                        padding: 5,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 4
                      }}
                    >
                      {/* Spacious Thumbnail Box */}
                      <div
                        className="checkerboard"
                        style={{
                          position: 'relative',
                          flex: 1,
                          minHeight: 62,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 3,
                          border: '1px solid var(--border-hairline)',
                          overflow: 'hidden'
                        }}
                      >
                        {thumbs[frame.blobHash] && (
                          <img
                            src={thumbs[frame.blobHash]}
                            alt={`f${idx + 1}`}
                            className="pixelated"
                            style={{ maxHeight: 58, maxWidth: 82, display: 'block' }}
                          />
                        )}
                      </div>

                      {/* Clean Single-Line Readout Footer */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0 2px',
                          height: 15
                        }}
                      >
                        <span
                          className="mono"
                          style={{
                            fontSize: 10.5,
                            color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                            fontWeight: active ? 600 : 400
                          }}
                        >
                          {frame.durationMs} ms
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          {frame.qcWarnings.length > 0 && (
                            <span title={frame.qcWarnings.map((w) => w.message).join('\n')} style={{ color: 'var(--status-warning)', display: 'inline-flex' }}>
                              <AlertTriangle size={10} />
                            </span>
                          )}
                          {frame.isLocked && (
                            <span title="Frame đang khóa" style={{ color: 'var(--status-warning)', display: 'inline-flex' }}>
                              <Lock size={10} />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // ---- COMPACT REVISION & VARIANTS DOCK FOR STATIC SPRITES ----
  const revisions = project.revisions.filter((r) => r.assetId === asset.assetId).reverse()
  if (revisions.length === 0) return null

  return (
    <section
      style={{
        height: '100%',
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border-divider)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          height: 32,
          padding: '0 12px',
          borderBottom: '1px solid var(--border-divider)',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}
      >
        <strong style={{ fontSize: 12, fontWeight: 600 }}>
          Lịch sử phiên bản ({revisions.length}) — {asset.name}
        </strong>
        <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Không phá hủy · Bấm duyệt để áp dụng</span>
      </div>

      <div style={{ flex: 1, overflowX: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
        {revisions.map((rev) => {
          const isApproved = asset.approvedRevisionId === rev.revisionId
          return (
            <div
              key={rev.revisionId}
              style={{
                width: 220,
                height: 88,
                flexShrink: 0,
                background: 'var(--bg-input)',
                border: `1px solid ${isApproved ? 'rgba(107, 196, 141, 0.5)' : rev.staleConflict ? 'var(--status-warning)' : 'var(--border-divider)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 10
              }}
            >
              <div
                className="checkerboard"
                style={{
                  width: 64,
                  height: 64,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 3,
                  border: '1px solid var(--border-hairline)'
                }}
              >
                {rev.normalizedBlobHash && thumbs[rev.normalizedBlobHash] && (
                  <img
                    src={thumbs[rev.normalizedBlobHash]}
                    alt={rev.revisionId}
                    className="pixelated"
                    style={{ maxHeight: 56, maxWidth: 56, display: 'block' }}
                  />
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {rev.revisionId.slice(0, 10)}
                  </span>
                  <span className={`badge ${isApproved ? 'approved' : rev.staleConflict ? 'warning' : 'draft'}`} style={{ fontSize: 10, padding: '1px 5px' }}>
                    {isApproved ? 'Đang dùng' : rev.staleConflict ? 'Xung đột' : rev.status}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={rev.operationSummary || 'Revision'}
                >
                  {rev.operationSummary || 'Revision'}
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                  {!isApproved && (
                    <button
                      className="primary"
                      style={{ flex: 1, padding: '2px 6px', fontSize: 11 }}
                      onClick={async () => {
                        const s = (await window.pixelStudio.approveRevision(asset.assetId, rev.revisionId)) as ProjectFullState
                        setProjectState(s)
                        setFeedback('approved', `Đã duyệt ${rev.revisionId}`)
                      }}
                    >
                      <Check size={11} /> Duyệt
                    </button>
                  )}
                  <button
                    className="ghost"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    title="Khôi phục thành bản làm việc mới"
                    onClick={async () => {
                      const s = (await window.pixelStudio.restoreRevision(asset.assetId, rev.revisionId)) as ProjectFullState
                      setProjectState(s)
                      setFeedback('draft_ready', `Đã khôi phục ${rev.revisionId} thành bản nháp mới`)
                    }}
                  >
                    <RotateCcw size={11} /> Khôi phục
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
