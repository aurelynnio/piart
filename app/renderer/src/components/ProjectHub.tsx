import React, { useState } from 'react'
import {
  FolderOpen,
  FolderPlus,
  Hammer,
  ArchiveRestore,
  KeyRound,
  Grid3x3,
  WifiOff,
  ArrowRight
} from 'lucide-react'
import { useStudioStore } from '../store/useStudioStore'
import type { ProjectFullState } from '../../../main/db/projectStore'

const STYLE_PRESETS = [
  {
    id: 'cozy_34',
    title: 'Nông trại 3/4 ấm áp',
    subtitle: 'Tile 32px · 3/4 RPG',
    perspective: '3/4' as const,
    tileSize: 32,
    ppu: 32,
    swatches: ['#3A2820', '#9A6744', '#C89463', '#4F6D8A', '#F1BE6B']
  },
  {
    id: 'retro_topdown',
    title: 'Phiêu lưu Top-down',
    subtitle: 'Tile 16px · Top-down',
    perspective: 'top-down' as const,
    tileSize: 16,
    ppu: 16,
    swatches: ['#1F2430', '#4A6B53', '#8AB060', '#D9A760', '#E8E3D5']
  },
  {
    id: 'indie_side',
    title: 'Hành động Side-view',
    subtitle: 'Tile 32px · Side-view',
    perspective: 'side-view' as const,
    tileSize: 32,
    ppu: 32,
    swatches: ['#181B28', '#3B4266', '#7A68A6', '#E07A5F', '#F2CC8F']
  }
]

export const ProjectHub: React.FC = () => {
  const {
    settings,
    providerKeys,
    sampleWorkshopAvailable,
    setProjectState,
    setActiveModal,
    setErrorBanner,
    bootstrap
  } = useStudioStore()

  const [newName, setNewName] = useState('Dự án Pixel Mới')
  const [newDir, setNewDir] = useState('')
  const [selectedStyleId, setSelectedStyleId] = useState('cozy_34')
  const [tileSize, setTileSize] = useState(32)
  const [ppu, setPpu] = useState(32)
  const [perspective, setPerspective] = useState<'top-down' | '3/4' | 'side-view'>('3/4')
  const [busy, setBusy] = useState(false)

  const handleSelectStyle = (p: (typeof STYLE_PRESETS)[number]) => {
    setSelectedStyleId(p.id)
    setPerspective(p.perspective)
    setTileSize(p.tileSize)
    setPpu(p.ppu)
  }

  const handlePickDir = async () => {
    const dir = await window.pixelStudio.pickDirectory('Chọn thư mục lưu dự án')
    if (dir) setNewDir(dir)
  }

  const handleCreate = async () => {
    if (!newName.trim() || !newDir.trim()) {
      setErrorBanner({
        title: 'Thiếu thông tin tạo dự án',
        reason: 'Vui lòng nhập tên dự án và chọn thư mục lưu.',
        preserved: 'Chưa ghi tệp nào.'
      })
      return
    }
    setBusy(true)
    try {
      const state = (await window.pixelStudio.createProject({
        name: newName.trim(),
        rootDir: newDir.trim(),
        tileSizePx: tileSize,
        pixelsPerUnit: ppu,
        defaultPerspective: perspective
      })) as ProjectFullState
      setProjectState(state)
    } catch (err) {
      setErrorBanner({
        title: 'Không thể tạo dự án',
        reason: err instanceof Error ? err.message : String(err),
        preserved: 'Thư mục không bị thay đổi.'
      })
    } finally {
      setBusy(false)
    }
  }

  const handleOpenExisting = async (dirPath?: string) => {
    const chosen = dirPath || (await window.pixelStudio.pickDirectory('Chọn thư mục dự án'))
    if (!chosen) return
    setBusy(true)
    try {
      const state = (await window.pixelStudio.openProject(chosen)) as ProjectFullState
      setProjectState(state)
    } catch (err) {
      setErrorBanner({
        title: 'Không thể mở dự án',
        reason: err instanceof Error ? err.message : String(err),
        preserved: 'Dữ liệu dự án giữ nguyên.'
      })
    } finally {
      setBusy(false)
    }
  }

  const handleOpenSample = async () => {
    const targetDir = await window.pixelStudio.pickDirectory(
      'Chọn thư mục để sao chép Dự án mẫu Xưởng mộc thành bản làm việc'
    )
    if (!targetDir) return
    setBusy(true)
    try {
      const state = (await window.pixelStudio.openSampleWorkshop(targetDir)) as ProjectFullState
      setProjectState(state)
    } catch (err) {
      setErrorBanner({
        title: 'Không thể mở dự án mẫu',
        reason: err instanceof Error ? err.message : String(err),
        preserved: 'Bản gốc dự án mẫu nguyên vẹn.'
      })
    } finally {
      setBusy(false)
    }
  }

  const handleRestoreBackup = async () => {
    const zip = await window.pixelStudio.pickFile('Chọn tệp sao lưu .zip', [
      { name: 'ZIP', extensions: ['zip'] }
    ])
    if (!zip) return
    const targetDir = await window.pixelStudio.pickDirectory('Chọn thư mục khôi phục dự án')
    if (!targetDir) return
    setBusy(true)
    try {
      const state = (await window.pixelStudio.restoreProject(zip, targetDir)) as ProjectFullState
      setProjectState(state)
    } catch (err) {
      setErrorBanner({
        title: 'Khôi phục sao lưu thất bại',
        reason: err instanceof Error ? err.message : String(err),
        preserved: 'Kiểm tra lại checksum tệp .zip.'
      })
    } finally {
      setBusy(false)
    }
  }

  const handleOfflineMode = async () => {
    await window.pixelStudio.updateAppSettings({ offlineMode: true })
    await bootstrap()
  }

  const openaiConfigured = providerKeys.openai?.configured

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        background: 'var(--bg-app)'
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: '0 auto',
          padding: '28px 32px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20
        }}
      >
        {/* Top Studio Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            paddingBottom: 16,
            borderBottom: '1px solid var(--border-divider)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-divider)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Grid3x3 size={18} strokeWidth={1.75} color="var(--accent)" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.015em' }}>
                AI Pixel Studio
              </h1>
              <p style={{ margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: 12.5 }}>
                Sản xuất tài nguyên 2D pixel art cục bộ, lưu lịch sử phiên bản và xuất gói kiểm chứng sang Unity.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setActiveModal('settings')}>
              <KeyRound size={14} strokeWidth={1.75} color="var(--accent)" />
              {openaiConfigured ? `OpenAI (${providerKeys.openai.maskedKey})` : 'Cấu hình Provider & API Key'}
            </button>
            <button className="ghost" onClick={handleOfflineMode}>
              <WifiOff size={14} strokeWidth={1.75} />
              Ngoại tuyến
            </button>
          </div>
        </div>

        {/* Sample Workshop Banner (Flat, clean, single primary CTA) */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-divider)',
            borderLeft: '3px solid var(--accent)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 20
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Hammer size={16} strokeWidth={1.75} color="var(--accent)" />
              <strong style={{ fontSize: 15 }}>Xưởng mộc — Dự án mẫu hoàn chỉnh</strong>
              <span style={{ fontSize: 11.5, color: 'var(--status-success)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="status-dot" style={{ background: 'var(--status-success)' }} />
                Sẵn sàng ngoại tuyến
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Gồm NPC Thợ mộc 4 hướng (24 frame), tủ gỗ 2×1 có clip mở 6 frame, tileset 32×32, bản đồ 10×8, hội thoại và nhiệm vụ giao búa.
            </div>
          </div>

          <button
            className="primary"
            style={{ padding: '8px 16px', fontSize: 13, flexShrink: 0 }}
            disabled={!sampleWorkshopAvailable || busy}
            onClick={handleOpenSample}
            data-testid="btn-open-sample-workshop"
          >
            Mở dự án mẫu
            <ArrowRight size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Main 2-Column Workspace Launcher */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 16, alignItems: 'stretch' }}>
          {/* Create Project Panel */}
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-divider)',
              borderRadius: 'var(--radius-lg)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 14
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FolderPlus size={15} strokeWidth={1.75} color="var(--accent)" />
                Tạo dự án cục bộ mới
              </h2>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>SQLite WAL · Blobs cục bộ</span>
            </div>

            {/* Visual Style Presets */}
            <div>
              <div className="section-title">Phong cách khởi đầu</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {STYLE_PRESETS.map((p) => {
                  const active = selectedStyleId === p.id
                  return (
                    <div
                      key={p.id}
                      onClick={() => handleSelectStyle(p)}
                      style={{
                        background: active ? 'var(--accent-soft)' : 'var(--bg-input)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-divider)'}`,
                        borderRadius: 'var(--radius-sm)',
                        padding: 8,
                        cursor: 'pointer',
                        transition: 'border-color 0.12s ease, background 0.12s ease'
                      }}
                    >
                      <div style={{ display: 'flex', height: 6, borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                        {p.swatches.map((hex) => (
                          <div key={hex} style={{ flex: 1, background: hex }} />
                        ))}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--text-primary)' }}>
                        {p.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.subtitle}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Tên dự án</div>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  data-testid="input-project-name"
                />
              </label>

              <label>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Thư mục lưu (hỗ trợ dấu tiếng Việt & khoảng trắng)
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={newDir}
                    onChange={(e) => setNewDir(e.target.value)}
                    placeholder="VD: C:\Users\...\Documents\Dự án Xưởng Mộc"
                    data-testid="input-project-dir"
                  />
                  <button onClick={handlePickDir}>Chọn...</button>
                </div>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Tile (px)</div>
                  <input
                    type="number"
                    value={tileSize}
                    min={8}
                    max={256}
                    className="mono"
                    onChange={(e) => setTileSize(Number(e.target.value) || 32)}
                  />
                </label>
                <label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Pixels / Unit</div>
                  <input
                    type="number"
                    value={ppu}
                    min={1}
                    max={512}
                    className="mono"
                    onChange={(e) => setPpu(Number(e.target.value) || 32)}
                  />
                </label>
                <label>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Góc nhìn</div>
                  <select
                    value={perspective}
                    onChange={(e) => setPerspective(e.target.value as 'top-down' | '3/4' | 'side-view')}
                  >
                    <option value="3/4">3/4 RPG</option>
                    <option value="top-down">Top-down</option>
                    <option value="side-view">Side-view</option>
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 2 }}>
              <button
                className="secondary-cta"
                style={{ padding: '8px 16px', fontSize: 12.5 }}
                disabled={busy}
                onClick={handleCreate}
                data-testid="btn-create-project"
              >
                <FolderPlus size={14} strokeWidth={1.75} color="var(--accent)" />
                Tạo & mở dự án
              </button>
            </div>
          </div>

          {/* Open Recent & Backup Panel */}
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-divider)',
              borderRadius: 'var(--radius-lg)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FolderOpen size={15} strokeWidth={1.75} color="var(--accent)" />
                Dự án gần đây
              </h2>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleOpenExisting()} disabled={busy}>
                  Mở thư mục...
                </button>
                <button className="ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={handleRestoreBackup} disabled={busy}>
                  <ArchiveRestore size={13} strokeWidth={1.75} />
                  Khôi phục ZIP
                </button>
              </div>
            </div>

            {!settings?.recentProjects.length ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: 'var(--text-muted)',
                  border: '1px dashed var(--border-divider)',
                  background: 'var(--bg-input)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 24,
                  textAlign: 'center'
                }}
              >
                <FolderOpen size={24} strokeWidth={1.5} color="var(--text-muted)" />
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Chưa có dự án mở gần đây</div>
                <div style={{ fontSize: 12, maxWidth: 260 }}>
                  Tạo dự án mới bên trái, mở thư mục có sẵn hoặc bắt đầu với dự án mẫu Xưởng mộc.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
                {settings.recentProjects.map((r) => (
                  <div
                    key={r.rootDir}
                    onClick={() => r.exists && !busy && handleOpenExisting(r.rootDir)}
                    style={{
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-divider)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10,
                      cursor: r.exists ? 'pointer' : 'default'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5 }}>{r.name}</div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {r.rootDir}
                      </div>
                    </div>
                    {r.exists ? (
                      <button
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOpenExisting(r.rootDir)
                        }}
                        disabled={busy}
                      >
                        Mở
                      </button>
                    ) : (
                      <span className="badge error">Không tồn tại</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
