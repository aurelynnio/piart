import React, { useEffect } from 'react'
import { AlertCircle, Monitor, RotateCcw, X } from 'lucide-react'
import { getSelectedAsset, useStudioStore } from './store/useStudioStore'
import { ProjectHub } from './components/ProjectHub'
import { TopBar } from './components/TopBar'
import { ExplorerSidebar } from './components/ExplorerSidebar'
import { PixelCanvasEditor } from './components/PixelCanvasEditor'
import { WorldAndGameplayEditors } from './components/WorldAndGameplayEditors'
import { ContextBottomDock } from './components/ContextBottomDock'
import { PromptPanel } from './components/PromptPanel'
import { SettingsQueueExportModals } from './components/SettingsQueueExportModals'
import type { JobRecord } from '@domain/schemas/types'
import type { ProjectFullState } from '../../main/db/projectStore'

const WORLD_EDITOR_TYPES = new Set([
  'tileset',
  'map',
  'dialogue',
  'quest',
  'data_table',
  'ui_screen',
  'cutscene'
])

export const App: React.FC = () => {
  const state = useStudioStore()
  const {
    initialized,
    project,
    bottomHeight,
    leftCollapsed,
    rightCollapsed,
    bottomCollapsed,
    errorBanner,
    bootstrap,
    setErrorBanner,
    setProjectState,
    setFeedback,
    updateJobRealtime
  } = state

  const selectedAsset = getSelectedAsset(state)
  const bridge = typeof window !== 'undefined' ? window.pixelStudio : undefined

  useEffect(() => {
    if (!bridge) return
    bootstrap()
    const unsub = bridge.onJobUpdated((job) => {
      updateJobRealtime(job as JobRecord)
    })
    return () => unsub()
  }, [bridge, bootstrap, updateJobRealtime])

  // Global Ctrl+Z / Ctrl+Y Undo/Redo
  useEffect(() => {
    if (!bridge) return
    const onKey = async (e: KeyboardEvent) => {
      if (!project) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        e.preventDefault()
        const res = (await bridge.undo()) as { applied: boolean; label: string | null; state: ProjectFullState }
        setProjectState(res.state)
        if (res.applied) setFeedback('draft_ready', `Đã hoàn tác: ${res.label}`)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        e.preventDefault()
        const res = (await bridge.redo()) as { applied: boolean; label: string | null; state: ProjectFullState }
        setProjectState(res.state)
        if (res.applied) setFeedback('draft_ready', `Đã làm lại: ${res.label}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bridge, project, setProjectState, setFeedback])

  if (!bridge) {
    return (
      <div
        data-testid="missing-electron-bridge"
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg-app)',
          color: 'var(--text-primary)'
        }}
      >
        <div
          style={{
            maxWidth: 540,
            width: '100%',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            padding: 24,
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Monitor size={20} color="var(--accent-primary)" />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              AI Pixel Studio cần chạy trong cửa sổ Desktop Electron
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Địa chỉ <code>http://localhost:5173/</code> chỉ là máy chủ giao diện (Vite renderer) nên không có cầu nối{' '}
            <code>window.pixelStudio</code> để truy cập SQLite, tệp dự án và hệ thống xuất Unity.
          </p>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              fontSize: 12.5,
              lineHeight: 1.7,
              color: 'var(--text-primary)'
            }}
          >
            <div>
              <strong>Cách 1 (Dev):</strong> Chạy <code>npm run dev</code> trong terminal và dùng cửa sổ desktop{' '}
              <strong>AI Pixel Studio</strong> tự mở.
            </div>
            <div>
              <strong>Cách 2 (Bản đóng gói):</strong> Mở trực tiếp{' '}
              <code>release/win-unpacked/AI Pixel Studio.exe</code>.
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="primary"
              onClick={() => window.location.reload()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RotateCcw size={14} />
              Kiểm tra lại
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!initialized) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
        Đang khởi động AI Pixel Studio...
      </div>
    )
  }

  const useWorldEditor = selectedAsset && WORLD_EDITOR_TYPES.has(selectedAsset.type)
  const hasBottomContent = Boolean(
    project &&
      selectedAsset &&
      !useWorldEditor &&
      (state.selectedClipId || project.revisions.some((r) => r.assetId === selectedAsset.assetId))
  )
  const resolvedBottomHeight = state.selectedClipId ? bottomHeight : Math.min(bottomHeight, 144)

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
      {/* Structured Error Banner */}
      {errorBanner && (
        <div
          role="alert"
          style={{
            background: 'rgba(229, 107, 111, 0.14)',
            borderBottom: '1px solid rgba(229, 107, 111, 0.45)',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: 12.5
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={15} color="var(--status-error)" />
            <span>
              <strong>{errorBanner.title}:</strong> {errorBanner.reason}{' '}
              <span style={{ color: 'var(--text-secondary)' }}>({errorBanner.preserved})</span>
            </span>
          </div>
          <button className="ghost icon-btn" onClick={() => setErrorBanner(null)} aria-label="Đóng thông báo lỗi">
            <X size={14} />
          </button>
        </div>
      )}

      {!project ? (
        <ProjectHub />
      ) : (
        <>
          <TopBar />
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
            {!leftCollapsed && (
              <div className="workspace-left-pane">
                <ExplorerSidebar />
              </div>
            )}

            {/* Center Viewport + Context Bottom Dock */}
            <main style={{ flex: 1, minWidth: 380, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
                {useWorldEditor ? <WorldAndGameplayEditors /> : <PixelCanvasEditor />}
              </div>
              {!bottomCollapsed && hasBottomContent && (
                <div style={{ height: resolvedBottomHeight, flexShrink: 0 }}>
                  <ContextBottomDock />
                </div>
              )}
            </main>

            {!rightCollapsed && (
              <div className="workspace-right-pane">
                <PromptPanel />
              </div>
            )}
          </div>
        </>
      )}

      <SettingsQueueExportModals />
    </div>
  )
}
