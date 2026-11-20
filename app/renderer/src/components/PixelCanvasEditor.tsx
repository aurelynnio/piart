import React, { useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Eraser,
  PaintBucket,
  Pipette,
  Scan,
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  Palette,
  Scissors,
  Crosshair,
  Check,
  Grid3x3,
  Eye,
  SquareDashedMousePointer,
  Trash2
} from 'lucide-react'
import {
  getSelectedAsset,
  getSelectedClip,
  getSelectedRevision,
  useStudioStore
} from '../store/useStudioStore'
import type { ProjectFullState } from '../../../main/db/projectStore'

type DrawTool = 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'mask' | 'pivot'

export const PixelCanvasEditor: React.FC = () => {
  const state = useStudioStore()
  const {
    project,
    selectedFrameIndex,
    isPlaying,
    playFrameIndex,
    onionSkin,
    setIsPlaying,
    setPlayFrameIndex,
    maskPngBase64,
    setMaskPngBase64,
    loadBlobDataUrl,
    setProjectState,
    selectClip,
    setFeedback
  } = state

  const asset = getSelectedAsset(state)
  const revision = getSelectedRevision(state)
  const clip = getSelectedClip(state)

  const [tool, setTool] = useState<DrawTool>('brush')
  const [maskBrushSize, setMaskBrushSize] = useState<number>(2)
  const [color, setColor] = useState('#C89463')
  const [zoom, setZoom] = useState<number>(8)
  const [showGrid, setShowGrid] = useState(true)
  const [showChecker, setShowChecker] = useState(true)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [compareRevId, setCompareRevId] = useState<string | null>(null)
  const [compareUrl, setCompareUrl] = useState<string | null>(null)
  const [prevOnionUrl, setPrevOnionUrl] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const displayFrameIdx = isPlaying ? playFrameIndex : selectedFrameIndex
  const activeFrame = clip?.frames[displayFrameIdx] ?? clip?.frames[0] ?? null
  const activeBlobHash = activeFrame?.blobHash ?? revision?.normalizedBlobHash ?? null
  const width = clip?.canvasPx.w ?? revision?.canvasPx.w ?? 32
  const height = clip?.canvasPx.h ?? revision?.canvasPx.h ?? 48

  useEffect(() => {
    if (!isPlaying || !clip || clip.frames.length === 0) return
    const safeIdx = playFrameIndex % clip.frames.length
    const curFrame = clip.frames[safeIdx]
    const ms = Math.max(16, Math.round(curFrame.durationMs / Math.max(0.1, clip.playbackSpeed || 1)))
    const t = setTimeout(() => {
      const next = safeIdx + 1
      if (next >= clip.frames.length) {
        if (clip.loopMode === 'once') {
          setIsPlaying(false)
          setPlayFrameIndex(clip.frames.length - 1)
          return
        }
        setPlayFrameIndex(0)
        return
      }
      setPlayFrameIndex(next)
    }, ms)
    return () => clearTimeout(t)
  }, [isPlaying, playFrameIndex, clip, setIsPlaying, setPlayFrameIndex])

  useEffect(() => {
    let cancelled = false
    const draw = async () => {
      const cvs = canvasRef.current
      if (!cvs) return
      const ctx = cvs.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)
      if (!activeBlobHash) return
      const url = await loadBlobDataUrl(activeBlobHash)
      if (!url || cancelled) return
      const img = new Image()
      img.onload = () => {
        if (cancelled) return
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
      }
      img.src = url
    }
    draw()
    return () => {
      cancelled = true
    }
  }, [activeBlobHash, width, height, loadBlobDataUrl])

  useEffect(() => {
    if (!onionSkin || !clip || displayFrameIdx <= 0) {
      setPrevOnionUrl(null)
      return
    }
    const prevHash = clip.frames[displayFrameIdx - 1]?.blobHash
    if (prevHash) loadBlobDataUrl(prevHash).then(setPrevOnionUrl)
  }, [onionSkin, clip, displayFrameIdx, loadBlobDataUrl])

  useEffect(() => {
    if (!compareRevId || !project) {
      setCompareUrl(null)
      return
    }
    const r = project.revisions.find((x) => x.revisionId === compareRevId)
    if (r?.normalizedBlobHash) loadBlobDataUrl(r.normalizedBlobHash).then(setCompareUrl)
  }, [compareRevId, project, loadBlobDataUrl])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'b') setTool('brush')
      else if (k === 'e') setTool('eraser')
      else if (k === 'g') setTool('fill')
      else if (k === 'i') setTool('eyedropper')
      else if (k === 'k') setTool('mask')
      else if (k === '1') setZoom(1)
      else if (k === '2') setZoom(2)
      else if (k === '4') setZoom(4)
      else if (k === '8') setZoom(8)
      else if (k === ' ' && clip) {
        e.preventDefault()
        setIsPlaying(!isPlaying)
      } else if (clip && project && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        const dirMap: Record<string, string> = {
          arrowup: 'up',
          arrowdown: 'down',
          arrowleft: 'left',
          arrowright: 'right'
        }
        const matched = project.clips.find(
          (c) => c.assetId === clip.assetId && c.action === clip.action && c.direction === dirMap[k]
        )
        if (matched) selectClip(matched.clipId, 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clip, project, selectClip, isPlaying, setIsPlaying])

  if (!project || !asset) {
    return (
      <div
        className="studio-viewport-bg"
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}
      >
        Chọn một tài nguyên ở cột trái hoặc nhập prompt ở cột phải để bắt đầu.
      </div>
    )
  }

  const getPixelCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * width)
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * height)
    return { x: Math.max(0, Math.min(width - 1, x)), y: Math.max(0, Math.min(height - 1, y)) }
  }

  const applyDrawAt = (x: number, y: number) => {
    if (tool === 'mask') {
      const mCvs = maskCanvasRef.current
      const mCtx = mCvs?.getContext('2d')
      if (!mCvs || !mCtx) return
      mCtx.fillStyle = 'rgba(226, 109, 138, 0.72)'
      const half = Math.floor(maskBrushSize / 2)
      mCtx.fillRect(x - half, y - half, maskBrushSize, maskBrushSize)
      return
    }
    const cvs = canvasRef.current
    const ctx = cvs?.getContext('2d', { willReadFrequently: true })
    if (!cvs || !ctx) return

    if (tool === 'eyedropper') {
      const d = ctx.getImageData(x, y, 1, 1).data
      if (d[3] > 0) {
        const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
        setColor(hex)
      }
      return
    }
    if (tool === 'eraser') {
      ctx.clearRect(x, y, 1, 1)
      return
    }
    if (tool === 'brush') {
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
      return
    }
    if (tool === 'fill') {
      const imgData = ctx.getImageData(0, 0, width, height)
      const data = imgData.data
      const idx0 = (y * width + x) * 4
      const target = [data[idx0], data[idx0 + 1], data[idx0 + 2], data[idx0 + 3]]
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)
      if (target[0] === r && target[1] === g && target[2] === b && target[3] === 255) return
      const stack = [[x, y]]
      const visited = new Uint8Array(width * height)
      while (stack.length) {
        const [cx, cy] = stack.pop()!
        const p = cy * width + cx
        if (visited[p]) continue
        const i = p * 4
        if (data[i] !== target[0] || data[i + 1] !== target[1] || data[i + 2] !== target[2] || data[i + 3] !== target[3]) {
          continue
        }
        visited[p] = 1
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = 255
        if (cx > 0) stack.push([cx - 1, cy])
        if (cx < width - 1) stack.push([cx + 1, cy])
        if (cy > 0) stack.push([cx, cy - 1])
        if (cy < height - 1) stack.push([cx, cy + 1])
      }
      ctx.putImageData(imgData, 0, 0)
    }
  }

  const commitCanvasEdit = async (pivotOverride?: { x: number; y: number }) => {
    const cvs = canvasRef.current
    if (!cvs) return
    const b64 = cvs.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
    const res = (await window.pixelStudio.savePixelEdit({
      assetId: asset.assetId,
      layers: [
        {
          id: revision?.layers[0]?.id ?? 'lyr_main',
          name: 'Nền chính',
          visible: true,
          locked: false,
          opacity: 1,
          pngBase64: b64,
          order: 0
        }
      ],
      width,
      height,
      pivotPx: pivotOverride ?? revision?.pivotPx,
      summary: pivotOverride ? `Đặt điểm neo (${pivotOverride.x}, ${pivotOverride.y})` : 'Vẽ pixel art'
    })) as { state: ProjectFullState }
    setProjectState(res.state)
    setFeedback('draft_ready', 'Đã lưu bản chỉnh sửa pixel vào revision mới')
  }

  const commitMask = () => {
    const mCvs = maskCanvasRef.current
    if (!mCvs) return
    const b64 = mCvs.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
    setMaskPngBase64(b64)
    setFeedback('draft_ready', 'Đã khoanh vùng mask — nhập prompt ở tab Sửa để áp dụng')
  }

  const clearMask = () => {
    const mCvs = maskCanvasRef.current
    if (mCvs) {
      const mCtx = mCvs.getContext('2d')
      mCtx?.clearRect(0, 0, width, height)
    }
    setMaskPngBase64(null)
  }

  const runTransform = async (op: 'flip_h' | 'flip_v' | 'rotate_cw' | 'quantize' | 'remove_bg') => {
    const res = (await window.pixelStudio.transformSprite({ assetId: asset.assetId, op })) as {
      state: ProjectFullState
    }
    setProjectState(res.state)
    setFeedback('draft_ready', `Đã áp dụng phép biến đổi: ${op}`)
  }

  const handleApproveCurrent = async () => {
    if (!revision) return
    const s = (await window.pixelStudio.approveRevision(asset.assetId, revision.revisionId)) as ProjectFullState
    setProjectState(s)
    setFeedback('approved', `Đã duyệt revision ${revision.revisionId}`)
  }

  const activePalette = project.palettes.find((p) => p.id === project.config.activePaletteId) ?? project.palettes[0]
  const assetRevs = project.revisions.filter((r) => r.assetId === asset.assetId)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, background: 'var(--bg-canvas-well)' }}>
      {/* Docked Top Viewport Strip: Zoom + Grid/Checker + Telemetry + Compare/Approve */}
      <div
        style={{
          height: 36,
          background: 'var(--bg-panel-subtle)',
          borderBottom: '1px solid var(--border-divider)',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0
        }}
      >
        {/* Left Group: Zoom + Grid + Checkerboard */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="segmented" role="group" aria-label="Mức phóng đại">
            {[1, 2, 4, 8, 16].map((z) => (
              <button
                key={z}
                className={zoom === z ? 'seg-active-accent mono' : 'mono'}
                style={{ padding: '2px 7px', fontSize: 11.5 }}
                onClick={() => setZoom(z)}
                title={`Phóng đại ${z}×`}
              >
                {z}×
              </button>
            ))}
          </div>

          <span className="divider-v" />

          <button
            className={showGrid ? 'toggle-on' : 'ghost'}
            style={{ padding: '3px 7px', fontSize: 11.5 }}
            onClick={() => setShowGrid(!showGrid)}
            title="Bật/tắt lưới pixel (hiển thị từ 4×)"
          >
            <Grid3x3 size={13} strokeWidth={1.75} />
            Lưới
          </button>
          <button
            className={showChecker ? 'toggle-on' : 'ghost'}
            style={{ padding: '3px 7px', fontSize: 11.5 }}
            onClick={() => setShowChecker(!showChecker)}
            title="Bật/tắt nền caro trong suốt"
          >
            <SquareDashedMousePointer size={13} strokeWidth={1.75} />
            Caro
          </button>

          {/* Contextual Mask Options integrated directly into Top Canvas Bar */}
          {(tool === 'mask' || maskPngBase64) && (
            <>
              <span className="divider-v" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="badge mask" style={{ padding: '1px 6px', fontSize: 10.5 }}>
                  <Scan size={11} /> Mask AI
                </span>
                <div className="segmented" aria-label="Cỡ cọ Mask">
                  {[1, 2, 4].map((sz) => (
                    <button
                      key={sz}
                      className={maskBrushSize === sz ? 'seg-active mono' : 'mono'}
                      style={{ padding: '2px 6px', fontSize: 11 }}
                      onClick={() => setMaskBrushSize(sz)}
                    >
                      {sz}px
                    </button>
                  ))}
                </div>
                {maskPngBase64 && (
                  <button className="danger" style={{ padding: '2px 7px', fontSize: 11 }} onClick={clearMask} title="Xóa vùng mask đã vẽ">
                    <Trash2 size={11} /> Xóa
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Group: Crisp Tabular Telemetry + Revision Compare + Approve */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            className="mono"
            style={{
              fontSize: 11.5,
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap'
            }}
          >
            {width}×{height} px
            {revision ? ` · Neo ${revision.pivotPx.x},${revision.pivotPx.y}` : ''}
            {cursorPos ? ` · (${cursorPos.x},${cursorPos.y})` : ''}
          </span>

          {assetRevs.length > 1 && (
            <select
              value={compareRevId ?? ''}
              onChange={(e) => setCompareRevId(e.target.value || null)}
              style={{ width: 132, padding: '3px 22px 3px 8px', fontSize: 11.5 }}
              aria-label="So sánh revision"
            >
              <option value="">So sánh rev...</option>
              {assetRevs.map((r) => (
                <option key={r.revisionId} value={r.revisionId}>
                  {r.revisionId.slice(0, 10)} ({r.status})
                </option>
              ))}
            </select>
          )}

          {revision && revision.status !== 'approved' && (
            <button
              className="primary"
              style={{ padding: '3px 9px', fontSize: 11.5 }}
              onClick={handleApproveCurrent}
              data-testid="btn-approve-revision"
            >
              <Check size={13} strokeWidth={2} /> Duyệt
            </button>
          )}
        </div>
      </div>

      {/* Main Editor Stage: Docked Tool Rail + Unobstructed Canvas Well */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* Docked Left Drawing Tool Rail (right beside the canvas) */}
        <div
          style={{
            width: 44,
            background: 'var(--bg-panel)',
            borderRight: '1px solid var(--border-divider)',
            padding: '8px 6px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
            overflowY: 'auto'
          }}
          role="toolbar"
          aria-label="Công cụ vẽ pixel"
        >
          <button
            className={`tool-btn ${tool === 'brush' ? 'tool-active' : ''}`}
            onClick={() => setTool('brush')}
            title="Bút pixel (B)"
            data-testid="btn-tool-brush"
          >
            <Pencil size={15} strokeWidth={1.75} />
          </button>
          <button
            className={`tool-btn ${tool === 'eraser' ? 'tool-active' : ''}`}
            onClick={() => setTool('eraser')}
            title="Tẩy (E)"
            data-testid="btn-tool-eraser"
          >
            <Eraser size={15} strokeWidth={1.75} />
          </button>
          <button
            className={`tool-btn ${tool === 'fill' ? 'tool-active' : ''}`}
            onClick={() => setTool('fill')}
            title="Đổ màu (G)"
            data-testid="btn-tool-fill"
          >
            <PaintBucket size={15} strokeWidth={1.75} />
          </button>
          <button
            className={`tool-btn ${tool === 'eyedropper' ? 'tool-active' : ''}`}
            onClick={() => setTool('eyedropper')}
            title="Hút màu (I)"
            data-testid="btn-tool-eyedropper"
          >
            <Pipette size={15} strokeWidth={1.75} />
          </button>
          <button
            className={`tool-btn ${tool === 'mask' ? 'tool-mask-active' : ''}`}
            onClick={() => setTool('mask')}
            title="Vẽ vùng Mask chỉnh AI (K)"
            data-testid="btn-tool-mask"
          >
            <Scan size={15} strokeWidth={1.75} />
          </button>
          <button
            className={`tool-btn ${tool === 'pivot' ? 'tool-active' : ''}`}
            onClick={() => setTool('pivot')}
            title="Đặt điểm neo (Pivot)"
            data-testid="btn-tool-pivot"
          >
            <Crosshair size={15} strokeWidth={1.75} />
          </button>

          <div style={{ width: 22, height: 1, background: 'var(--border-divider)', margin: '4px 0' }} />

          <button className="tool-btn" onClick={() => runTransform('flip_h')} title="Lật ngang">
            <FlipHorizontal size={15} strokeWidth={1.75} />
          </button>
          <button className="tool-btn" onClick={() => runTransform('flip_v')} title="Lật dọc">
            <FlipVertical size={15} strokeWidth={1.75} />
          </button>
          <button className="tool-btn" onClick={() => runTransform('rotate_cw')} title="Xoay 90°">
            <RotateCw size={15} strokeWidth={1.75} />
          </button>
          <button className="tool-btn" onClick={() => runTransform('quantize')} title="Ánh xạ sang bảng màu dự án">
            <Palette size={15} strokeWidth={1.75} />
          </button>
          <button className="tool-btn" onClick={() => runTransform('remove_bg')} title="Tách nền alpha">
            <Scissors size={15} strokeWidth={1.75} />
          </button>
        </div>

        {/* Clean Unobstructed Pixel Art Canvas Well */}
        <div
          className="studio-viewport-bg"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            padding: 20
          }}
        >
          <div
            style={{
              margin: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 24,
              flexShrink: 0
            }}
          >
          <div
            className={showChecker ? 'checkerboard' : ''}
            style={{
              position: 'relative',
              width: width * zoom,
              height: height * zoom,
              boxShadow: 'var(--shadow-canvas)',
              backgroundColor: showChecker ? undefined : '#181816',
              flexShrink: 0
            }}
          >
            {onionSkin && prevOnionUrl && (
              <img
                src={prevOnionUrl}
                alt="onion-skin"
                className="pixelated"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0.32,
                  filter: 'hue-rotate(175deg)',
                  pointerEvents: 'none'
                }}
              />
            )}

            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              className="pixelated"
              style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
              onMouseDown={(e) => {
                const p = getPixelCoords(e)
                setCursorPos(p)
                if (tool === 'pivot') {
                  commitCanvasEdit(p)
                  return
                }
                setIsDrawing(true)
                applyDrawAt(p.x, p.y)
              }}
              onMouseMove={(e) => {
                const p = getPixelCoords(e)
                setCursorPos(p)
                if (isDrawing) applyDrawAt(p.x, p.y)
              }}
              onMouseUp={() => {
                if (!isDrawing) return
                setIsDrawing(false)
                if (tool === 'mask') commitMask()
                else if (tool !== 'eyedropper') commitCanvasEdit()
              }}
              onMouseLeave={() => {
                setIsDrawing(false)
                setCursorPos(null)
              }}
            />

            <canvas
              ref={maskCanvasRef}
              width={width}
              height={height}
              className="pixelated"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            />

            {/* Crisp Light Pixel Grid */}
            {showGrid && zoom >= 4 && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  backgroundImage:
                    'linear-gradient(to right, rgba(240,237,229,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(240,237,229,0.06) 1px, transparent 1px)',
                  backgroundSize: `${zoom}px ${zoom}px`
                }}
              />
            )}

            {/* Crisp Amber Pivot Reticle (flat, no neon glow) */}
            {revision && (
              <div
                title={`Điểm neo (${revision.pivotPx.x}, ${revision.pivotPx.y})`}
                style={{
                  position: 'absolute',
                  left: revision.pivotPx.x * zoom - 4,
                  top: revision.pivotPx.y * zoom - 4,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  border: '1.5px solid var(--accent)',
                  background: 'rgba(33, 23, 10, 0.55)',
                  pointerEvents: 'none'
                }}
              />
            )}
          </div>

          {compareUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div className="badge info">
                <Eye size={12} /> Đối chiếu: {compareRevId?.slice(0, 10)}
              </div>
              <div
                className="checkerboard"
                style={{
                  width: width * zoom,
                  height: height * zoom,
                  boxShadow: '0 0 0 1px var(--status-info)'
                }}
              >
                <img src={compareUrl} alt="compare" className="pixelated" style={{ width: '100%', height: '100%' }} />
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Docked Bottom Palette Strip (single compact 32px bar directly above Timeline) */}
      {activePalette && (
        <div
          style={{
            height: 32,
            background: 'var(--bg-panel)',
            borderTop: '1px solid var(--border-divider)',
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            overflowX: 'auto'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              paddingRight: 8,
              borderRight: '1px solid var(--border-divider)',
              flexShrink: 0
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 3,
                background: color,
                border: '1px solid var(--text-primary)',
                flexShrink: 0
              }}
            />
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              {color}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {activePalette.colors.map((c) => {
              const isCur = color.toUpperCase() === c.hex.toUpperCase()
              return (
                <button
                  key={c.hex}
                  onClick={() => setColor(c.hex)}
                  title={`${c.name} (${c.hex})`}
                  aria-label={`Chọn màu ${c.name} ${c.hex}`}
                  style={{
                    width: 18,
                    height: 18,
                    padding: 0,
                    background: c.hex,
                    borderRadius: 3,
                    border: isCur ? '1.5px solid var(--text-primary)' : '1px solid rgba(0, 0, 0, 0.45)',
                    boxShadow: isCur ? '0 0 0 1px var(--bg-app)' : 'none',
                    flexShrink: 0
                  }}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
