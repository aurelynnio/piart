import React, { useEffect, useMemo, useState } from 'react'
import {
  Search,
  FolderPlus,
  ImagePlus,
  Copy,
  Trash2,
  RotateCcw,
  Film,
  Map as MapIcon,
  MessageSquare,
  Box,
  User,
  Layout,
  Sparkles,
  Table2,
  Clapperboard,
  CheckSquare
} from 'lucide-react'
import { useStudioStore } from '../store/useStudioStore'
import type { Asset, AssetType } from '@domain/schemas/types'
import type { ProjectFullState } from '../../../main/db/projectStore'

const TYPE_LABELS: Record<AssetType, string> = {
  character: 'Nhân vật',
  portrait: 'Chân dung',
  outfit: 'Trang phục',
  furniture: 'Nội thất',
  item: 'Vật phẩm',
  icon: 'Biểu tượng',
  tileset: 'Tileset',
  map: 'Bản đồ',
  ui_element: 'Thành phần UI',
  ui_screen: 'Màn hình UI',
  vfx: 'Hiệu ứng VFX',
  cutscene: 'Cutscene',
  dialogue: 'Hội thoại',
  quest: 'Nhiệm vụ',
  data_table: 'Bảng dữ liệu'
}

function iconForType(type: AssetType) {
  switch (type) {
    case 'character':
    case 'portrait':
    case 'outfit':
      return <User size={13} strokeWidth={1.75} />
    case 'furniture':
    case 'item':
    case 'icon':
      return <Box size={13} strokeWidth={1.75} />
    case 'tileset':
    case 'map':
      return <MapIcon size={13} strokeWidth={1.75} />
    case 'ui_element':
    case 'ui_screen':
      return <Layout size={13} strokeWidth={1.75} />
    case 'vfx':
      return <Sparkles size={13} strokeWidth={1.75} />
    case 'cutscene':
      return <Clapperboard size={13} strokeWidth={1.75} />
    case 'dialogue':
    case 'quest':
      return <MessageSquare size={13} strokeWidth={1.75} />
    case 'data_table':
      return <Table2 size={13} strokeWidth={1.75} />
  }
}

export const ExplorerSidebar: React.FC = () => {
  const {
    project,
    selectedAssetId,
    selectedClipId,
    blobCache,
    loadBlobDataUrl,
    selectAsset,
    selectClip,
    setProjectState,
    setFeedback,
    setErrorBanner
  } = useStudioStore()

  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'approved' | 'draft' | 'trash'>('active')
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all')
  const [selectMode, setSelectMode] = useState(false)
  const [multiIds, setMultiIds] = useState<string[]>([])
  const [bulkTag, setBulkTag] = useState('')

  useEffect(() => {
    if (!project) return
    const revMap = new Map(project.revisions.map((r) => [r.revisionId, r]))
    for (const a of project.assets) {
      const revId = a.approvedRevisionId ?? a.latestRevisionId
      const hash = revId ? revMap.get(revId)?.normalizedBlobHash : null
      if (hash && !blobCache[hash]) {
        loadBlobDataUrl(hash)
      }
    }
  }, [project, blobCache, loadBlobDataUrl])

  const revById = useMemo(() => {
    if (!project) return new Map()
    return new Map(project.revisions.map((r) => [r.revisionId, r]))
  }, [project])

  const filteredAssets = useMemo(() => {
    if (!project) return []
    return project.assets.filter((a) => {
      if (statusFilter === 'trash') return Boolean(a.trashedAt)
      if (a.trashedAt) return false
      if (statusFilter === 'approved' && !a.approvedRevisionId) return false
      if (statusFilter === 'draft' && a.approvedRevisionId) return false
      if (typeFilter !== 'all' && a.type !== typeFilter) return false
      if (selectedFolderId !== 'all' && (a.folderId ?? 'root') !== selectedFolderId) return false
      if (query.trim()) {
        const q = query.toLowerCase()
        return (
          a.name.toLowerCase().includes(q) ||
          a.assetId.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q))
        )
      }
      return true
    })
  }, [project, query, typeFilter, statusFilter, selectedFolderId])

  if (!project) return null

  const handleImportPng = async () => {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/png'
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0]
      if (!f) return
      const buf = await f.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const b64 = btoa(binary)
      try {
        const res = (await window.pixelStudio.importPngAsSprite({
          name: f.name.replace(/\.png$/i, ''),
          pngBase64: b64,
          assetType: 'character'
        })) as { asset: Asset; state: ProjectFullState }
        setProjectState(res.state)
        selectAsset(res.asset.assetId)
        setFeedback('approved', `Đã nhập PNG "${res.asset.name}"`)
      } catch (err) {
        setErrorBanner({
          title: 'Nhập PNG thất bại',
          reason: err instanceof Error ? err.message : String(err),
          preserved: 'Dự án giữ nguyên.'
        })
      }
    }
    fileInput.click()
  }

  const handleCreateFolder = async () => {
    const name = window.prompt('Tên thư mục mới:')
    if (!name?.trim()) return
    const id = `fld_${Date.now()}`
    const state = (await window.pixelStudio.upsertEntity('folder', id, {
      id,
      name: name.trim(),
      parentId: null,
      kind: 'folder',
      createdAt: new Date().toISOString()
    })) as ProjectFullState
    setProjectState(state)
  }

  const handleBulkAddTag = async () => {
    if (!bulkTag.trim() || multiIds.length === 0) return
    const state = (await window.pixelStudio.bulkEditAssets({
      assetIds: multiIds,
      addTags: [bulkTag.trim()]
    })) as ProjectFullState
    setProjectState(state)
    setBulkTag('')
    setFeedback('draft_ready', `Đã gắn tag cho ${multiIds.length} asset`)
  }

  const handleDuplicate = async (assetId: string) => {
    const res = (await window.pixelStudio.duplicateAsset(assetId)) as {
      asset: Asset
      state: ProjectFullState
    }
    setProjectState(res.state)
    selectAsset(res.asset.assetId)
  }

  const handleTrash = async (assetId: string) => {
    const res = (await window.pixelStudio.trashAsset(assetId)) as {
      referencingIds: string[]
      state: ProjectFullState
    }
    setProjectState(res.state)
    setFeedback(
      'draft_ready',
      res.referencingIds.length > 0
        ? `Đã chuyển vào thùng rác (đang có ${res.referencingIds.length} tham chiếu)`
        : 'Đã chuyển vào thùng rác'
    )
  }

  const handleRestore = async (assetId: string) => {
    const state = (await window.pixelStudio.restoreTrashedAsset(assetId)) as ProjectFullState
    setProjectState(state)
    setFeedback('approved', 'Đã khôi phục asset từ thùng rác')
  }

  const toggleMulti = (id: string) => {
    setMultiIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const hasActiveFilter = Boolean(query || typeFilter !== 'all' || selectedFolderId !== 'all')

  return (
    <aside
      style={{
        height: '100%',
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-divider)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Aligned Header + Search + Filters (12px grid) */}
      <div
        style={{
          padding: '8px 12px 10px',
          borderBottom: '1px solid var(--border-divider)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0
        }}
      >
        {/* Row 1: Title + Count + Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="section-title" style={{ margin: 0, color: 'var(--text-secondary)' }}>
              Tài nguyên
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {filteredAssets.length}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {hasActiveFilter && (
              <button
                className="ghost"
                style={{ padding: '2px 5px', fontSize: 11 }}
                onClick={() => {
                  setQuery('')
                  setTypeFilter('all')
                  setSelectedFolderId('all')
                }}
                title="Xóa bộ lọc"
              >
                Đặt lại
              </button>
            )}
            <button className="ghost icon-btn" style={{ width: 24, height: 24 }} onClick={handleImportPng} title="Nhập tệp PNG thành sprite">
              <ImagePlus size={13} strokeWidth={1.75} />
            </button>
            <button className="ghost icon-btn" style={{ width: 24, height: 24 }} onClick={handleCreateFolder} title="Tạo thư mục mới">
              <FolderPlus size={13} strokeWidth={1.75} />
            </button>
            <button
              className={selectMode ? 'active icon-btn' : 'ghost icon-btn'}
              style={{ width: 24, height: 24 }}
              onClick={() => {
                setSelectMode(!selectMode)
                if (selectMode) setMultiIds([])
              }}
              title="Chọn nhiều để gắn tag hàng loạt"
            >
              <CheckSquare size={13} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Row 2: Full-width Search Input (no squishing) */}
        <div style={{ position: 'relative' }}>
          <Search
            size={13}
            strokeWidth={1.75}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
          />
          <input
            type="text"
            placeholder="Tìm tên, ID, tag..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 26, paddingTop: 5, paddingBottom: 5, fontSize: 12 }}
            data-testid="input-explorer-search"
          />
        </div>

        {/* Row 3: Status Filter */}
        <div className="segmented" style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {(
            [
              ['active', 'Tất cả'],
              ['approved', 'Duyệt'],
              ['draft', 'Nháp'],
              ['trash', 'Rác']
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={statusFilter === key ? 'seg-active' : ''}
              style={{ padding: '3px 2px', fontSize: 11 }}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Row 4: Type & Folder Selects */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Lọc loại asset"
            style={{ padding: '4px 20px 4px 7px', fontSize: 11.5 }}
          >
            <option value="all">Mọi loại</option>
            <option value="character">Nhân vật</option>
            <option value="portrait">Chân dung</option>
            <option value="outfit">Trang phục</option>
            <option value="furniture">Nội thất</option>
            <option value="item">Vật phẩm</option>
            <option value="icon">Biểu tượng</option>
            <option value="tileset">Tileset</option>
            <option value="map">Bản đồ</option>
            <option value="ui_element">UI Element</option>
            <option value="ui_screen">UI Screen</option>
            <option value="vfx">VFX</option>
            <option value="cutscene">Cutscene</option>
            <option value="dialogue">Hội thoại</option>
            <option value="quest">Nhiệm vụ</option>
            <option value="data_table">Bảng dữ liệu</option>
          </select>
          <select
            value={selectedFolderId}
            onChange={(e) => setSelectedFolderId(e.target.value)}
            aria-label="Lọc thư mục"
            style={{ padding: '4px 18px 4px 7px', fontSize: 11.5 }}
          >
            <option value="all">Thư mục</option>
            <option value="root">Gốc</option>
            {project.folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        {selectMode && multiIds.length > 0 && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="text"
              placeholder={`Gắn tag (${multiIds.length})...`}
              value={bulkTag}
              onChange={(e) => setBulkTag(e.target.value)}
              style={{ padding: '4px 7px', fontSize: 11.5 }}
            />
            <button className="primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={handleBulkAddTag}>
              Áp
            </button>
          </div>
        )}
      </div>

      {/* Compact Asset Rows */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filteredAssets.map((asset) => {
          const isSelected = asset.assetId === selectedAssetId
          const relatedClips = project.clips.filter((c) => c.assetId === asset.assetId)
          const revId = asset.approvedRevisionId ?? asset.latestRevisionId
          const thumbHash = revId ? revById.get(revId)?.normalizedBlobHash : null
          const thumbUrl = thumbHash ? blobCache[thumbHash] : null

          return (
            <div key={asset.assetId} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div
                onClick={() => selectAsset(asset.assetId)}
                data-testid={`asset-item-${asset.assetId}`}
                className={`explorer-row ${isSelected ? 'selected' : ''}`}
                style={{
                  padding: '5px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={multiIds.includes(asset.assetId)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleMulti(asset.assetId)}
                    />
                  )}

                  {/* Crisp 28px Pixel Thumbnail */}
                  <div
                    className={thumbUrl ? 'checkerboard' : ''}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${isSelected ? 'var(--accent-border)' : 'var(--border-divider)'}`,
                      background: thumbUrl ? undefined : 'var(--bg-input)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      overflow: 'hidden',
                      color: isSelected ? 'var(--accent)' : 'var(--text-secondary)'
                    }}
                  >
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt=""
                        className="pixelated"
                        style={{ maxWidth: 24, maxHeight: 24, display: 'block' }}
                      />
                    ) : (
                      iconForType(asset.type)
                    )}
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: isSelected ? 600 : 500,
                        color: isSelected ? 'var(--text-primary)' : '#DDD9CF',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.3
                      }}
                    >
                      {asset.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        lineHeight: 1.3,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden'
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {TYPE_LABELS[asset.type] ?? asset.type}
                      </span>
                      {asset.approvedRevisionId ? (
                        <span
                          className="status-dot"
                          title="Đã duyệt"
                          style={{ width: 5, height: 5, background: 'var(--status-success)' }}
                        />
                      ) : asset.latestRevisionId ? (
                        <span style={{ color: 'var(--status-draft)', flexShrink: 0 }}>· Nháp</span>
                      ) : null}
                      {relatedClips.length > 0 && (
                        <span
                          className="mono"
                          title={`${relatedClips.length} animation clips`}
                          style={{
                            fontSize: 10,
                            color: 'var(--text-secondary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            marginLeft: 2,
                            flexShrink: 0
                          }}
                        >
                          <Film size={10} strokeWidth={1.75} />
                          {relatedClips.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Hover / Selected Row Actions */}
                <div className="row-actions" style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                  {statusFilter === 'trash' ? (
                    <button className="ghost" style={{ padding: 3 }} onClick={() => handleRestore(asset.assetId)} title="Khôi phục">
                      <RotateCcw size={12} />
                    </button>
                  ) : (
                    <>
                      <button className="ghost" style={{ padding: 3 }} onClick={() => handleDuplicate(asset.assetId)} title="Nhân bản">
                        <Copy size={12} />
                      </button>
                      <button className="ghost" style={{ padding: 3 }} onClick={() => handleTrash(asset.assetId)} title="Chuyển vào thùng rác">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Indented Nested Animation Clips */}
              {relatedClips.length > 0 && isSelected && (
                <div
                  style={{
                    marginLeft: 18,
                    paddingLeft: 8,
                    borderLeft: '1px solid var(--border-divider)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    marginBottom: 4
                  }}
                >
                  {relatedClips.map((clip) => {
                    const clipActive = clip.clipId === selectedClipId
                    return (
                      <div
                        key={clip.clipId}
                        onClick={() => selectClip(clip.clipId, 0)}
                        data-testid={`clip-item-${clip.clipId}`}
                        className={`clip-row ${clipActive ? 'selected' : ''}`}
                        style={{
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: 12,
                          color: clipActive ? 'var(--accent)' : 'var(--text-secondary)',
                          fontWeight: clipActive ? 600 : 400,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <Film size={11} strokeWidth={1.75} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {clip.action} ({clip.direction})
                          </span>
                        </span>
                        <span className="mono" style={{ fontSize: 10.5, opacity: 0.78, flexShrink: 0 }}>
                          {clip.frames.length}f
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
