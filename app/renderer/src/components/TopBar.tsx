import React from 'react'
import {
  Undo2,
  Redo2,
  Upload,
  Settings,
  ListChecks,
  Wifi,
  WifiOff,
  Archive,
  Palette,
  PanelLeft,
  PanelRight,
  PanelBottom,
  LayoutGrid,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from 'lucide-react'
import {
  getSelectedAsset,
  getSelectedClip,
  useStudioStore
} from '../store/useStudioStore'
import type { ProjectFullState } from '../../../main/db/projectStore'

export const TopBar: React.FC = () => {
  const state = useStudioStore()
  const {
    project,
    settings,
    uiFeedbackState,
    statusMessage,
    leftCollapsed,
    rightCollapsed,
    bottomCollapsed,
    setProjectState,
    setActiveModal,
    togglePanel,
    bootstrap,
    setFeedback,
    setErrorBanner
  } = state

  if (!project) return null

  const selectedAsset = getSelectedAsset(state)
  const selectedClip = getSelectedClip(state)
  const runningJobs = project.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length
  const failedJobs = project.jobs.filter((j) => j.status === 'failed').length

  const handleUndo = async () => {
    const res = (await window.pixelStudio.undo()) as { applied: boolean; label: string | null; state: ProjectFullState }
    setProjectState(res.state)
    if (res.applied) setFeedback('draft_ready', `Đã hoàn tác: ${res.label}`)
  }

  const handleRedo = async () => {
    const res = (await window.pixelStudio.redo()) as { applied: boolean; label: string | null; state: ProjectFullState }
    setProjectState(res.state)
    if (res.applied) setFeedback('draft_ready', `Đã làm lại: ${res.label}`)
  }

  const handleBackup = async () => {
    const zipPath = await window.pixelStudio.pickSaveFile('Lưu bản sao lưu dự án (.zip)', `${project.config.name}.zip`)
    if (!zipPath) return
    try {
      const res = (await window.pixelStudio.backupProject(zipPath)) as { fileCount: number }
      setFeedback('approved', `Đã sao lưu ${res.fileCount} tệp thành công`)
    } catch (err) {
      setErrorBanner({
        title: 'Sao lưu thất bại',
        reason: err instanceof Error ? err.message : String(err),
        preserved: 'Dữ liệu dự án không thay đổi.'
      })
    }
  }

  const handleToggleOffline = async () => {
    await window.pixelStudio.updateAppSettings({ offlineMode: !settings?.offlineMode })
    await bootstrap()
  }

  const handleCloseProject = async () => {
    await window.pixelStudio.closeProject()
    setProjectState(null)
    await bootstrap()
  }

  const isIdleStatus =
    (uiFeedbackState === 'empty' || uiFeedbackState === 'approved' || uiFeedbackState === 'draft_ready') &&
    statusMessage === 'Sẵn sàng'

  const statusTone =
    uiFeedbackState === 'failed'
      ? 'error'
      : uiFeedbackState === 'needs_resolution'
        ? 'warning'
        : uiFeedbackState === 'running' || uiFeedbackState === 'analyzing' || uiFeedbackState === 'queued'
          ? 'info'
          : uiFeedbackState === 'approved' || uiFeedbackState === 'exported'
            ? 'approved'
            : ''

  return (
    <header
      style={{
        height: 44,
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-divider)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        gap: 12,
        flexShrink: 0,
        zIndex: 10
      }}
    >
      {/* Left: Hub Back + Project › Active Asset/Clip Breadcrumb + Quiet Save State */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '1 1 auto' }}>
        <button
          className="ghost icon-btn"
          onClick={handleCloseProject}
          title="Quay về Màn hình dự án"
          aria-label="Quay về Màn hình dự án"
        >
          <LayoutGrid size={15} strokeWidth={1.75} />
        </button>

        <span
          style={{
            fontSize: 12.5,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 165
          }}
          title={project.config.name}
        >
          {project.config.name}
        </span>

        {selectedAsset && (
          <>
            <ChevronRight size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0
              }}
              data-testid="topbar-active-asset"
            >
              <strong
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 190
                }}
              >
                {selectedAsset.name}
              </strong>
              {selectedClip && (
                <span
                  className="mono"
                  style={{
                    fontSize: 11.5,
                    color: 'var(--accent)',
                    fontWeight: 500,
                    whiteSpace: 'nowrap'
                  }}
                >
                  · {selectedClip.action} ({selectedClip.direction})
                </span>
              )}
            </span>
          </>
        )}

        <span
          title="Lưu tự động vào SQLite WAL"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            marginLeft: 6,
            fontSize: 11,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          <span className="status-dot" style={{ background: 'var(--status-success)' }} />
          Đã lưu
        </span>

        {settings?.activeProviderId === 'mock' && (
          <span
            title="Chế độ MockTestAdapter kiểm thử xác định"
            style={{
              fontSize: 10.5,
              color: 'var(--text-muted)',
              border: '1px solid var(--border-divider)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 6px',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            Mock
          </span>
        )}
      </div>

      {/* Center: Undo/Redo + Panel Visibility + Semantic Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            className="ghost icon-btn"
            disabled={!project.undoRedo.canUndo}
            onClick={handleUndo}
            title={project.undoRedo.undoLabel ? `Hoàn tác: ${project.undoRedo.undoLabel} (Ctrl+Z)` : 'Hoàn tác (Ctrl+Z)'}
            data-testid="btn-undo"
          >
            <Undo2 size={14} strokeWidth={1.75} />
          </button>
          <button
            className="ghost icon-btn"
            disabled={!project.undoRedo.canRedo}
            onClick={handleRedo}
            title={project.undoRedo.redoLabel ? `Làm lại: ${project.undoRedo.redoLabel} (Ctrl+Y)` : 'Làm lại (Ctrl+Y)'}
            data-testid="btn-redo"
          >
            <Redo2 size={14} strokeWidth={1.75} />
          </button>
        </div>

        <span className="divider-v" />

        <div className="segmented" role="group" aria-label="Bố cục panel">
          <button
            className={!leftCollapsed ? 'seg-active' : ''}
            style={{ padding: '4px 6px' }}
            onClick={() => togglePanel('left')}
            title="Ẩn/hiện cột tài nguyên"
          >
            <PanelLeft size={14} strokeWidth={1.75} />
          </button>
          <button
            className={!bottomCollapsed ? 'seg-active' : ''}
            style={{ padding: '4px 6px' }}
            onClick={() => togglePanel('bottom')}
            title="Ẩn/hiện khay timeline"
          >
            <PanelBottom size={14} strokeWidth={1.75} />
          </button>
          <button
            className={!rightCollapsed ? 'seg-active' : ''}
            style={{ padding: '4px 6px' }}
            onClick={() => togglePanel('right')}
            title="Ẩn/hiện bảng Tạo/Sửa"
          >
            <PanelRight size={14} strokeWidth={1.75} />
          </button>
        </div>

        <span
          className={isIdleStatus ? '' : `badge ${statusTone}`}
          data-testid="status-pill"
          style={{
            maxWidth: isIdleStatus ? 0 : 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 11.5,
            opacity: isIdleStatus ? 0 : 1,
            pointerEvents: isIdleStatus ? 'none' : 'auto',
            padding: isIdleStatus ? 0 : undefined,
            border: isIdleStatus ? 'none' : undefined,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5
          }}
        >
          {!isIdleStatus && uiFeedbackState === 'failed' && <AlertCircle size={12} />}
          {!isIdleStatus && uiFeedbackState === 'needs_resolution' && <AlertTriangle size={12} />}
          {!isIdleStatus && (uiFeedbackState === 'approved' || uiFeedbackState === 'exported') && <CheckCircle2 size={12} />}
          {!isIdleStatus && (uiFeedbackState === 'running' || uiFeedbackState === 'analyzing') && <Loader2 size={12} />}
          {statusMessage}
        </span>
      </div>

      {/* Right: Studio Utilities + Secondary Export Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <button
          className="ghost"
          style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={() => setActiveModal('project_settings')}
          title="Cấu hình dự án, Bảng màu & StylePreset"
        >
          <Palette size={14} strokeWidth={1.75} />
          Phong cách
        </button>
        <button className="ghost icon-btn" onClick={handleBackup} title="Sao lưu dự án (.zip)">
          <Archive size={14} strokeWidth={1.75} />
        </button>
        <button
          className={settings?.offlineMode ? 'active' : 'ghost'}
          style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={handleToggleOffline}
          title="Chuyển chế độ Ngoại tuyến / Trực tuyến"
          data-testid="btn-offline-toggle"
        >
          {settings?.offlineMode ? <WifiOff size={14} strokeWidth={1.75} /> : <Wifi size={14} strokeWidth={1.75} />}
          {settings?.offlineMode ? 'Ngoại tuyến' : 'Trực tuyến'}
        </button>
        <button
          className="ghost"
          style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={() => setActiveModal('queue')}
          title="Hàng đợi tác vụ & Nhật ký sử dụng"
        >
          <ListChecks size={14} strokeWidth={1.75} />
          Hàng đợi
          {runningJobs > 0 && <span className="badge info tabular">{runningJobs}</span>}
          {failedJobs > 0 && <span className="badge error tabular">{failedJobs}</span>}
        </button>
        <button className="ghost icon-btn" onClick={() => setActiveModal('settings')} title="Cài đặt Provider & API Key">
          <Settings size={14} strokeWidth={1.75} />
        </button>

        <span className="divider-v" style={{ margin: '0 4px' }} />

        <button
          className="secondary-cta"
          style={{ padding: '5px 10px', fontSize: 12 }}
          onClick={() => setActiveModal('export')}
          data-testid="btn-open-export"
        >
          <Upload size={14} strokeWidth={1.75} color="var(--accent)" />
          Xuất Unity
        </button>
      </div>
    </header>
  )
}
