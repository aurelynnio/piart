import React, { useState } from 'react'
import { X, CheckCircle2, AlertTriangle, RefreshCw, Ban, FolderOpen, Download, KeyRound } from 'lucide-react'
import { useStudioStore } from '../store/useStudioStore'
import type { ConnectionCheckResult } from '../../../main/providers/adapter'
import type { ExportExecutionResult, ExportPreflightReport } from '../../../main/exporter/unityExporter'
import type { ProjectFullState } from '../../../main/db/projectStore'

export const SettingsQueueExportModals: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    settings,
    providerKeys,
    capabilities,
    project,
    bootstrap,
    setProjectState,
    setFeedback,
    setErrorBanner
  } = useStudioStore()

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [connResult, setConnResult] = useState<ConnectionCheckResult | null>(null)
  const [diagJson, setDiagJson] = useState<string>('')

  // Export modal state
  const [exportScope, setExportScope] = useState<'project' | 'scene' | 'asset' | 'collection'>('project')
  const [exportTargetDir, setExportTargetDir] = useState('')
  const [atlasPadding, setAtlasPadding] = useState(2)
  const [preflight, setPreflight] = useState<ExportPreflightReport | null>(null)
  const [exportResult, setExportResult] = useState<ExportExecutionResult | null>(null)
  const [busy, setBusy] = useState(false)

  if (!activeModal) return null

  const close = () => {
    setActiveModal(null)
    setConnResult(null)
    setExportResult(null)
  }

  // ---- SETTINGS MODAL (F101 - F103) ----
  if (activeModal === 'settings') {
    const activeProv = settings?.activeProviderId ?? 'mock'
    const caps = capabilities[activeProv] ?? []
    const keyMeta = providerKeys[activeProv]

    return (
      <div className="modal-backdrop" onClick={close}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <KeyRound size={15} color="var(--accent)" /> Cài đặt Provider, API Key & Model
            </strong>
            <button className="ghost icon-btn" onClick={close}><X size={15} /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="section-title">Chọn Provider hoạt động</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={activeProv === 'openai' ? 'active' : ''}
                  onClick={async () => {
                    await window.pixelStudio.updateAppSettings({ activeProviderId: 'openai' })
                    await bootstrap()
                  }}
                >
                  OpenAI (API thật)
                </button>
                <button
                  className={activeProv === 'mock' ? 'active' : ''}
                  onClick={async () => {
                    await window.pixelStudio.updateAppSettings({ activeProviderId: 'mock' })
                    await bootstrap()
                  }}
                >
                  MockTestAdapter (Kiểm thử cục bộ)
                </button>
              </div>
            </div>

            <div style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-divider)', padding: 12, borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>API Key ({activeProv})</strong>
                <span className={`badge ${keyMeta?.configured ? 'approved' : 'warning'}`} data-testid="masked-key-badge">
                  {keyMeta?.configured ? `Đã lưu (${keyMeta.maskedKey}) · ${keyMeta.storageBackend}` : 'Chưa cấu hình'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="password"
                  placeholder="Nhập API key mới (lưu mã hóa DPAPI, không hiển thị lại nguyên bản)..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  data-testid="input-api-key"
                />
                <button
                  className="primary"
                  disabled={!apiKeyInput.trim()}
                  onClick={async () => {
                    await window.pixelStudio.setApiKey(activeProv, apiKeyInput)
                    setApiKeyInput('')
                    await bootstrap()
                  }}
                  data-testid="btn-save-api-key"
                >
                  Lưu an toàn
                </button>
                {keyMeta?.configured && (
                  <button
                    className="danger"
                    onClick={async () => {
                      await window.pixelStudio.deleteApiKey(activeProv)
                      await bootstrap()
                    }}
                  >
                    Xóa key
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={async () => {
                    const res = (await window.pixelStudio.testConnection(activeProv)) as ConnectionCheckResult
                    setConnResult(res)
                    await bootstrap()
                  }}
                >
                  Kiểm tra kết nối & năng lực
                </button>
                {connResult && (
                  <span className={`badge ${connResult.ok ? 'approved' : 'error'}`}>
                    {connResult.message}
                  </span>
                )}
              </div>
            </div>

            {/* Model selection & Capability matrix */}
            <div>
              <div className="section-title">Ma trận năng lực & chọn model theo tác vụ</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                <label>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Lập kế hoạch JSON</div>
                  <select
                    value={settings?.models.planner}
                    onChange={async (e) => {
                      await window.pixelStudio.updateAppSettings({ models: { ...settings!.models, planner: e.target.value } })
                      await bootstrap()
                    }}
                  >
                    {caps.filter((c) => c.supportsPlanning).map((c) => (
                      <option key={c.modelId} value={c.modelId}>{c.modelId}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Sinh ảnh mới</div>
                  <select
                    value={settings?.models.imageGenerate}
                    onChange={async (e) => {
                      await window.pixelStudio.updateAppSettings({ models: { ...settings!.models, imageGenerate: e.target.value } })
                      await bootstrap()
                    }}
                  >
                    {caps.filter((c) => c.supportsImageGenerate).map((c) => (
                      <option key={c.modelId} value={c.modelId}>{c.modelId}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Chỉnh ảnh theo Mask</div>
                  <select
                    value={settings?.models.imageEdit}
                    onChange={async (e) => {
                      await window.pixelStudio.updateAppSettings({ models: { ...settings!.models, imageEdit: e.target.value } })
                      await bootstrap()
                    }}
                  >
                    {caps.filter((c) => c.supportsImageGenerate).map((c) => (
                      <option key={c.modelId} value={c.modelId}>
                        {c.modelId}{!c.supportsImageEditWithMask ? ' (Không hỗ trợ mask)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {caps.map((c) => (
                  <div key={c.modelId} style={{ fontSize: 12, padding: '6px 8px', background: 'var(--bg-canvas)', borderRadius: 6, display: 'flex', justifyContent: 'space-between' }}>
                    <span><strong>{c.displayName}</strong></span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      {c.supportsPlanning && <span className="badge info">Plan</span>}
                      {c.supportsImageGenerate && <span className="badge approved">Sinh ảnh</span>}
                      {c.supportsImageEditWithMask && <span className="badge approved">Mask Edit</span>}
                      {c.supportsTransparentBackground && <span className="badge">Alpha</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button onClick={close}>Đóng</button>
          </div>
        </div>
      </div>
    )
  }

  // ---- QUEUE, USAGE LEDGER & DIAGNOSTICS MODAL (F104 - F109) ----
  if (activeModal === 'queue' && project) {
    return (
      <div className="modal-backdrop" onClick={close}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <strong>Hàng đợi tác vụ, Lịch sử sử dụng & Chẩn đoán</strong>
            <button className="ghost" onClick={close}><X size={16} /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  const s = (await window.pixelStudio.resumeJobs()) as ProjectFullState
                  setProjectState(s)
                }}
              >
                <RefreshCw size={14} /> Tiếp tục từ checkpoint
              </button>
              <button
                onClick={async () => {
                  const diag = await window.pixelStudio.generateDiagnostics()
                  setDiagJson(JSON.stringify(diag, null, 2))
                }}
              >
                <Download size={14} /> Tạo báo cáo chẩn đoán đã lọc bí mật
              </button>
            </div>

            <div>
              <div className="section-title">Tác vụ ({project.jobs.length})</div>
              {project.jobs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Chưa có tác vụ nào trong dự án.</div>
              ) : (
                project.jobs.map((job) => (
                  <div key={job.jobId} style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 8, marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong className="mono">{job.jobId}</strong> · {job.snapshot.promptText.slice(0, 60)}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className={`badge ${job.status === 'succeeded' ? 'approved' : job.status === 'failed' ? 'error' : 'info'}`}>
                          {job.status}
                        </span>
                        {(job.status === 'running' || job.status === 'queued') && (
                          <button
                            className="danger"
                            style={{ padding: '2px 6px', fontSize: 11 }}
                            onClick={async () => {
                              const s = (await window.pixelStudio.cancelJob(job.jobId)) as ProjectFullState
                              setProjectState(s)
                            }}
                          >
                            <Ban size={11} /> Hủy
                          </button>
                        )}
                        {(job.status === 'failed' || job.status === 'cancelled' || job.status === 'ambiguous') && (
                          <button
                            style={{ padding: '2px 6px', fontSize: 11 }}
                            onClick={async () => {
                              const res = (await window.pixelStudio.retryJob(job.jobId)) as { state: ProjectFullState }
                              setProjectState(res.state)
                            }}
                          >
                            <RefreshCw size={11} /> Thử lại bước lỗi
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {job.steps.map((st) => (
                        <div key={st.stepId} style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                          <span>• {st.stepId} ({st.operation})</span>
                          <span>{st.status}{st.errorMessage ? ` — ${st.errorMessage}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div>
              <div className="section-title">Lịch sử sử dụng ({project.usageLedger.length} lượt gọi)</div>
              {project.usageLedger.slice(0, 12).map((u) => (
                <div key={u.usageId} className="mono" style={{ fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{u.providerId}/{u.modelId} · {u.operation}</span>
                  <span>
                    imgs={u.imageCount} tok={u.inputTokens + u.outputTokens}{' '}
                    {u.isEstimated ? <span className="badge warning">Ước tính</span> : <span className="badge approved">Thực tế</span>}
                  </span>
                </div>
              ))}
            </div>

            {diagJson && (
              <div>
                <div className="section-title">Báo cáo chẩn đoán (đã lọc API key & thông tin nhạy cảm)</div>
                <pre className="mono" style={{ fontSize: 11, maxHeight: 200, overflow: 'auto', background: 'var(--bg-canvas-well)', padding: 8, borderRadius: 4 }}>
                  {diagJson}
                </pre>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button onClick={close}>Đóng</button>
          </div>
        </div>
      </div>
    )
  }

  // ---- PROJECT STYLE / PALETTE / PRESET SETTINGS (F005 - F008) ----
  if (activeModal === 'project_settings' && project) {
    return (
      <div className="modal-backdrop" onClick={close}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <strong>Cấu hình dự án, Bảng màu & StylePreset</strong>
            <button className="ghost" onClick={close}><X size={16} /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <label>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Tile Grid (px)</div>
                <input
                  type="number"
                  value={project.config.tileSizePx}
                  onChange={async (e) => {
                    const s = (await window.pixelStudio.updateProjectConfig({ tileSizePx: Number(e.target.value) || 32 })) as ProjectFullState
                    setProjectState(s)
                  }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Pixels Per Unit</div>
                <input
                  type="number"
                  value={project.config.pixelsPerUnit}
                  onChange={async (e) => {
                    const s = (await window.pixelStudio.updateProjectConfig({ pixelsPerUnit: Number(e.target.value) || 32 })) as ProjectFullState
                    setProjectState(s)
                  }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Góc nhìn mặc định</div>
                <select
                  value={project.config.defaultPerspective}
                  onChange={async (e) => {
                    const s = (await window.pixelStudio.updateProjectConfig({ defaultPerspective: e.target.value })) as ProjectFullState
                    setProjectState(s)
                  }}
                >
                  <option value="3/4">3/4 RPG</option>
                  <option value="top-down">Top-down</option>
                  <option value="side-view">Side-view</option>
                </select>
              </label>
            </div>

            <div>
              <div className="section-title">Bảng màu ({project.palettes.length})</div>
              {project.palettes.map((p) => (
                <div key={p.id} style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <strong>{p.name}</strong>
                    {project.config.activePaletteId === p.id && <span className="badge approved">Đang dùng</span>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {p.colors.map((c, idx) => (
                      <span key={idx} title={c.hex} style={{ width: 22, height: 22, background: c.hex, borderRadius: 4, border: '1px solid #000' }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="section-title">StylePreset ({project.presets.length})</div>
              {project.presets.map((pr) => (
                <div key={pr.id} style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 8, fontSize: 12 }}>
                  <strong>{pr.name}</strong> (v{pr.version}) · {pr.perspective} · canvas mặc định {pr.defaultCanvasPx.w}×{pr.defaultCanvasPx.h}
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button onClick={close}>Đóng</button>
          </div>
        </div>
      </div>
    )
  }

  // ---- UNITY EXPORT PREFLIGHT MODAL (F110 - F117) ----
  if (activeModal === 'export' && project) {
    const runPreflight = async () => {
      const rootIds =
        exportScope === 'scene'
          ? project.scenes.slice(0, 1).map((s) => s.sceneId)
          : exportScope === 'asset'
            ? project.assets.filter((a) => !a.trashedAt).slice(0, 1).map((a) => a.assetId)
            : []
      const rep = (await window.pixelStudio.preflightExport(exportScope, rootIds)) as ExportPreflightReport
      setPreflight(rep)
    }

    const doExport = async () => {
      if (!exportTargetDir.trim()) {
        setErrorBanner({
          title: 'Chưa chọn thư mục xuất',
          reason: 'Vui lòng chọn thư mục đích để xuất gói Unity.',
          preserved: 'Chưa ghi file nào.'
        })
        return
      }
      setBusy(true)
      try {
        const rootIds =
          exportScope === 'scene'
            ? project.scenes.slice(0, 1).map((s) => s.sceneId)
            : exportScope === 'asset'
              ? project.assets.filter((a) => !a.trashedAt).slice(0, 1).map((a) => a.assetId)
              : []
        const res = (await window.pixelStudio.exportToUnity({
          scopeKind: exportScope,
          rootIds,
          targetDir: exportTargetDir.trim(),
          includeAtlas: true,
          atlasPaddingPx: atlasPadding
        })) as { result: ExportExecutionResult; state: ProjectFullState }
        setProjectState(res.state)
        setExportResult(res.result)
        setPreflight(res.result.preflight)
        setFeedback('exported', `Đã xuất ${res.result.filesWritten} tệp sang Unity`)
      } catch (err) {
        setErrorBanner({
          title: 'Xuất gói Unity thất bại',
          reason: err instanceof Error ? err.message : String(err),
          preserved: 'Thư mục đích không bị ghi dở dang.'
        })
      } finally {
        setBusy(false)
      }
    }

    return (
      <div className="modal-backdrop" onClick={close}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <strong>Xuất gói tài nguyên sang Unity (Manifest v1 + Checksum SHA-256)</strong>
            <button className="ghost" onClick={close}><X size={16} /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Phạm vi xuất</div>
                <select value={exportScope} onChange={(e) => setExportScope(e.target.value as any)}>
                  <option value="project">Toàn bộ dự án</option>
                  <option value="scene">Scene đang chọn + phụ thuộc</option>
                  <option value="asset">Asset đơn lẻ + clip</option>
                </select>
              </label>
              <label>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Padding Atlas (px, chống rò viền)</div>
                <input type="number" value={atlasPadding} min={2} max={16} onChange={(e) => setAtlasPadding(Number(e.target.value) || 2)} />
              </label>
            </div>

            <label>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Thư mục đích lưu gói xuất</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={exportTargetDir}
                  onChange={(e) => setExportTargetDir(e.target.value)}
                  placeholder="Chọn thư mục xuất gói..."
                  data-testid="input-export-dir"
                />
                <button
                  onClick={async () => {
                    const d = await window.pixelStudio.pickDirectory('Chọn thư mục xuất gói Unity')
                    if (d) setExportTargetDir(d)
                  }}
                >
                  Chọn...
                </button>
              </div>
            </label>

            <div>
              <button onClick={runPreflight} data-testid="btn-run-preflight">Kiểm tra tiền xuất & phụ thuộc</button>
            </div>

            {preflight && (
              <div style={{ background: 'var(--bg-panel-subtle)', border: '1px solid var(--border-divider)', padding: 12, borderRadius: 'var(--radius-md)', fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {preflight.ok ? (
                    <CheckCircle2 size={16} color="var(--status-success)" />
                  ) : (
                    <AlertTriangle size={16} color="var(--status-error)" />
                  )}
                  <strong>
                    {preflight.ok ? 'Đủ điều kiện xuất sang Unity' : `Có ${preflight.errorCount} lỗi chặn`}
                  </strong>
                  <span className="badge info mono">
                    {preflight.resolvedAssetIds.length} asset · {preflight.resolvedClipIds.length} clip · {preflight.resolvedSceneIds.length} scene
                  </span>
                </div>
                {preflight.issues.map((i, idx) => (
                  <div key={idx} style={{ color: i.severity === 'error' ? 'var(--status-error)' : 'var(--status-warning)' }}>
                    • [{i.code}] {i.message}
                  </div>
                ))}
              </div>
            )}

            {exportResult && (
              <div
                style={{ background: 'rgba(107, 196, 141, 0.12)', border: '1px solid var(--status-success)', padding: 12, borderRadius: 'var(--radius-md)', fontSize: 13 }}
                data-testid="export-success-box"
              >
                <strong>Xuất gói thành công!</strong> ({exportResult.filesWritten} tệp · {exportResult.manifest.entries.length} mục manifest)
                <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>{exportResult.manifestPath}</div>
                <button style={{ marginTop: 8 }} onClick={() => window.pixelStudio.openPathInExplorer(exportResult.targetDir)}>
                  <FolderOpen size={14} /> Mở thư mục gói xuất
                </button>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button onClick={close}>Đóng</button>
            <button className="primary" disabled={busy} onClick={doExport} data-testid="btn-confirm-export">
              {busy ? 'Đang xuất...' : 'Xuất gói Unity ngay'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
