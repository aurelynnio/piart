import React, { useEffect, useMemo, useState } from 'react'
import {
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Footprints,
  Plus,
  Layers,
  Eye,
  GitBranch,
  Backpack,
  Flag
} from 'lucide-react'
import { getSelectedAsset, useStudioStore } from '../store/useStudioStore'
import {
  createSimulationState,
  getAvailableEdges,
  stepSimulation,
  validateDataTable,
  validateDialogueGraph,
  validateQuest
} from '@domain/validators/gameplayValidator'
import { validateSceneAndGameplay } from '@domain/validators/assetValidator'
import type { ProjectFullState } from '../../../main/db/projectStore'

export const WorldAndGameplayEditors: React.FC = () => {
  const state = useStudioStore()
  const { project, blobCache, loadBlobDataUrl, setProjectState, setFeedback } = state
  const asset = getSelectedAsset(state)

  const [activeTileId, setActiveTileId] = useState<string>('')
  const [showFootprints, setShowFootprints] = useState(true)
  const [playtestPos, setPlaytestPos] = useState<{ x: number; y: number } | null>(null)
  const [playtestLog, setPlaytestLog] = useState<string>('')

  const [simHasHammer, setSimHasHammer] = useState(false)
  const [simState, setSimState] = useState<ReturnType<typeof createSimulationState> | null>(null)
  const [uiPreviewState, setUiPreviewState] = useState<'normal' | 'pressed' | 'disabled'>('normal')
  const [shotIdx, setShotIdx] = useState(0)

  const scene = useMemo(
    () => (project && asset?.type === 'map' ? project.scenes.find((s) => s.assetId === asset.assetId) ?? null : null),
    [project, asset]
  )
  const tileset = useMemo(() => {
    if (!project || !asset) return null
    if (asset.type === 'tileset') return project.tilesets.find((t) => t.assetId === asset.assetId) ?? null
    if (scene?.tilesetId) return project.tilesets.find((t) => t.tilesetId === scene.tilesetId) ?? null
    return null
  }, [project, asset, scene])
  const dialogue = useMemo(
    () => (project && asset?.type === 'dialogue' ? project.dialogues.find((d) => d.assetId === asset.assetId) ?? null : null),
    [project, asset]
  )
  const quest = useMemo(
    () => (project && asset?.type === 'quest' ? project.quests.find((q) => q.assetId === asset.assetId) ?? null : null),
    [project, asset]
  )
  const dataTable = useMemo(
    () => (project && asset?.type === 'data_table' ? project.dataTables.find((t) => t.assetId === asset.assetId) ?? null : null),
    [project, asset]
  )
  const uiScreen = useMemo(
    () => (project && asset?.type === 'ui_screen' ? project.uiScreens.find((u) => u.assetId === asset.assetId) ?? null : null),
    [project, asset]
  )
  const cutscene = useMemo(
    () => (project && asset?.type === 'cutscene' ? project.cutscenes.find((c) => c.assetId === asset.assetId) ?? null : null),
    [project, asset]
  )

  // Load tileset tile blobs AND placed sprite blobs for real pixel-art rendering on the map!
  useEffect(() => {
    if (!project) return
    if (tileset) {
      if (!activeTileId && tileset.tiles[0]) setActiveTileId(tileset.tiles[0].tileId)
      for (const t of tileset.tiles) {
        if (!blobCache[t.blobHash]) loadBlobDataUrl(t.blobHash)
      }
    }
    if (scene) {
      const revMap = new Map(project.revisions.map((r) => [r.revisionId, r]))
      for (const p of scene.placements) {
        const placedAsset = project.assets.find((a) => a.assetId === p.assetId)
        const revId = p.revisionId ?? placedAsset?.approvedRevisionId ?? placedAsset?.latestRevisionId
        const hash = revId ? revMap.get(revId)?.normalizedBlobHash : null
        if (hash && !blobCache[hash]) loadBlobDataUrl(hash)
      }
    }
  }, [project, tileset, scene, activeTileId, blobCache, loadBlobDataUrl])

  useEffect(() => {
    if (!dialogue || !project) return
    const flags: Record<string, boolean | number | string> = {}
    for (const f of project.stateFlags) flags[f.key] = f.defaultValue
    setSimState(createSimulationState(dialogue, flags, simHasHammer ? { item_hammer: 1 } : {}))
  }, [dialogue, simHasHammer, project])

  useEffect(() => {
    if (!playtestPos || !scene) return
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      let dx = 0
      let dy = 0
      if (k === 'w' || k === 'arrowup') dy = -1
      else if (k === 's' || k === 'arrowdown') dy = 1
      else if (k === 'a' || k === 'arrowleft') dx = -1
      else if (k === 'd' || k === 'arrowright') dx = 1
      else return
      e.preventDefault()

      const nx = playtestPos.x + dx
      const ny = playtestPos.y + dy
      if (nx < 0 || ny < 0 || nx >= scene.cols || ny >= scene.rows) {
        setPlaytestLog(`Bị chặn bởi biên bản đồ (${nx}, ${ny})`)
        return
      }
      const ground = scene.layers.find((l) => l.kind === 'ground')
      const tid = ground?.cells[`${nx},${ny}`]
      const tile = tileset?.tiles.find((t) => t.tileId === tid)
      if (tile && !tile.walkable) {
        setPlaytestLog(`Va chạm tường/vật cản "${tile.name}" tại (${nx}, ${ny})`)
        return
      }
      const hitObj = scene.placements.find(
        (p) =>
          p.blocksMovement &&
          nx >= p.gridX &&
          nx < p.gridX + p.footprint.w &&
          ny >= p.gridY &&
          ny < p.gridY + p.footprint.h
      )
      if (hitObj) {
        setPlaytestLog(`Va chạm footprint "${hitObj.name}" tại (${nx}, ${ny})`)
        return
      }
      setPlaytestPos({ x: nx, y: ny })
      const trig = scene.markers.find(
        (m) =>
          nx >= m.gridX &&
          nx < m.gridX + m.widthTiles &&
          ny >= m.gridY &&
          ny < m.gridY + m.heightTiles
      )
      setPlaytestLog(
        trig ? `Đi tới (${nx}, ${ny}) — Kích hoạt ${trig.kind}: "${trig.name}"` : `Đi tới (${nx}, ${ny})`
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playtestPos, scene, tileset])

  if (!project || !asset) return null

  const revMap = new Map(project.revisions.map((r) => [r.revisionId, r]))
  const getAssetSpriteUrl = (assetId: string, revisionId?: string | null) => {
    const a = project.assets.find((x) => x.assetId === assetId)
    const rid = revisionId ?? a?.approvedRevisionId ?? a?.latestRevisionId
    const hash = rid ? revMap.get(rid)?.normalizedBlobHash : null
    return hash ? blobCache[hash] ?? null : null
  }

  // ---- TILESET EDITOR (F064 - F068) ----
  if (asset.type === 'tileset' && tileset) {
    const selectedTile = tileset.tiles.find((t) => t.tileId === activeTileId) ?? tileset.tiles[0]
    const toggleWalkable = async (tileId: string) => {
      const next = {
        ...tileset,
        tiles: tileset.tiles.map((t) =>
          t.tileId === tileId
            ? { ...t, walkable: !t.walkable, collisionShape: !t.walkable ? 'none' : 'full' }
            : t
        ),
        updatedAt: new Date().toISOString()
      }
      const s = (await window.pixelStudio.upsertEntity('tileset', tileset.tilesetId, next)) as ProjectFullState
      setProjectState(s)
    }

    return (
      <div className="studio-viewport-bg" style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 310px', gap: 22 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 17 }}>{tileset.name}</h3>
            <span className="badge info mono">{tileset.tileSizePx}×{tileset.tileSizePx} px · padding {tileset.paddingPx} px</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 12 }}>
            {tileset.tiles.map((t) => {
              const active = t.tileId === selectedTile?.tileId
              return (
                <div
                  key={t.tileId}
                  onClick={() => setActiveTileId(t.tileId)}
                  style={{
                    background: 'var(--bg-panel)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-divider)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: 12,
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {blobCache[t.blobHash] && (
                      <img src={blobCache[t.blobHash]} alt={t.name} className="pixelated" style={{ width: 48, height: 48, borderRadius: 6, border: '1px solid var(--border-subtle)' }} />
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tag: {t.terrainTag}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={`badge ${t.walkable ? 'approved' : 'warning'}`}>
                      {t.walkable ? 'Đi được' : 'Vật cản'}
                    </span>
                    <button className="ghost" style={{ padding: '2px 6px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); toggleWalkable(t.tileId) }}>
                      Đổi
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <h4 style={{ marginTop: 22, marginBottom: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
            Quy tắc Auto-Tile ({tileset.autoTileRules.length})
          </h4>
          {tileset.autoTileRules.map((r) => (
            <div key={r.ruleId} style={{ background: 'var(--bg-panel)', padding: '10px 14px', borderRadius: 9, border: '1px solid var(--border-subtle)', fontSize: 12.5, display: 'flex', justifyContent: 'space-between' }}>
              <strong>{r.name}</strong>
              <span className="mono" style={{ color: 'var(--accent)' }}>{r.mode} · mask {r.bitmask} → {r.tileId}</span>
            </div>
          ))}
        </div>

        {/* 3x3 Seamless Repeat Preview */}
        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-divider)', borderRadius: 'var(--radius-lg)', padding: 16, alignSelf: 'start' }}>
          <div className="section-title">Xem lặp 3×3 (Kiểm tra đường nối)</div>
          {selectedTile && blobCache[selectedTile.blobHash] && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', width: 216, margin: '14px auto', borderRadius: 6, overflow: 'hidden', boxShadow: 'var(--shadow-canvas)' }}>
              {Array.from({ length: 9 }).map((_, idx) => (
                <img key={idx} src={blobCache[selectedTile.blobHash]} alt="rep" className="pixelated" style={{ width: 72, height: 72, display: 'block' }} />
              ))}
            </div>
          )}
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', textAlign: 'center' }}>
            Đang kiểm tra: <strong style={{ color: 'var(--text-primary)' }}>{selectedTile?.name}</strong>
          </div>
        </div>
      </div>
    )
  }

  // ---- MAP / SCENE EDITOR WITH REAL PIXEL-ART SPRITES (F069 - F076) ----
  if (asset.type === 'map' && scene) {
    const CELL = 56
    const groundLayer = scene.layers.find((l) => l.kind === 'ground')
    const sceneIssues = validateSceneAndGameplay({
      scene,
      tilesets: project.tilesets,
      assets: project.assets,
      dialogues: project.dialogues,
      quests: project.quests,
      flags: project.stateFlags
    })

    const paintCell = async (col: number, row: number) => {
      if (!groundLayer || !activeTileId || playtestPos) return
      const next = {
        ...scene,
        layers: scene.layers.map((l) =>
          l.layerId === groundLayer.layerId
            ? { ...l, cells: { ...l.cells, [`${col},${row}`]: activeTileId } }
            : l
        ),
        updatedAt: new Date().toISOString()
      }
      const s = (await window.pixelStudio.upsertEntity('scene', scene.sceneId, next)) as ProjectFullState
      setProjectState(s)
    }

    const startPlaytest = () => {
      const sp = scene.markers.find((m) => m.kind === 'spawn')
      setPlaytestPos(sp ? { x: sp.gridX, y: sp.gridY } : { x: 1, y: 1 })
      setPlaytestLog('Dùng phím WASD hoặc mũi tên để đi thử từ điểm xuất hiện!')
    }

    return (
      <div className="studio-viewport-bg" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Clean Single-Row Top Map Bar */}
        <div
          style={{
            padding: '6px 12px',
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-divider)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'nowrap',
            overflowX: 'auto'
          }}
        >
          <strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{scene.name}</strong>

          {tileset && (
            <div className="segmented" style={{ padding: 2 }}>
              {tileset.tiles.map((t) => (
                <button
                  key={t.tileId}
                  className={activeTileId === t.tileId ? 'seg-active-accent' : ''}
                  style={{ padding: '3px 7px', fontSize: 11 }}
                  onClick={() => setActiveTileId(t.tileId)}
                >
                  {blobCache[t.blobHash] && (
                    <img src={blobCache[t.blobHash]} alt="" className="pixelated" style={{ width: 14, height: 14, borderRadius: 2 }} />
                  )}
                  {t.name}
                </button>
              ))}
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              className={showFootprints ? 'active' : 'ghost'}
              style={{ padding: '4px 8px', fontSize: 11.5 }}
              onClick={() => setShowFootprints(!showFootprints)}
            >
              <Eye size={13} /> Footprint
            </button>
            {playtestPos ? (
              <button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setPlaytestPos(null)}>Dừng chơi thử</button>
            ) : (
              <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={startPlaytest}>
                <Footprints size={13} /> Chơi thử
              </button>
            )}
          </div>
        </div>

        {/* Map Canvas + Side Inspector */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 24 }}>
          <div>
            {playtestPos && (
              <div className="badge approved" style={{ marginBottom: 10, padding: '5px 12px', fontSize: 12 }}>
                <Footprints size={13} /> {playtestLog}
              </div>
            )}
            <div
              style={{
                position: 'relative',
                display: 'grid',
                gridTemplateColumns: `repeat(${scene.cols}, ${CELL}px)`,
                gridTemplateRows: `repeat(${scene.rows}, ${CELL}px)`,
                borderRadius: 6,
                overflow: 'hidden',
                boxShadow: 'var(--shadow-canvas)',
                width: scene.cols * CELL,
                height: scene.rows * CELL
              }}
            >
              {Array.from({ length: scene.rows }).map((_, r) =>
                Array.from({ length: scene.cols }).map((__, c) => {
                  const tid = groundLayer?.cells[`${c},${r}`]
                  const tile = tileset?.tiles.find((t) => t.tileId === tid)
                  const marker = scene.markers.find((m) => m.gridX === c && m.gridY === r)
                  const isPlayer = playtestPos?.x === c && playtestPos?.y === r
                  return (
                    <div
                      key={`${c},${r}`}
                      onClick={() => paintCell(c, r)}
                      title={`(${c}, ${r}) ${tile?.name ?? ''}`}
                      style={{
                        width: CELL,
                        height: CELL,
                        position: 'relative',
                        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.035)',
                        cursor: playtestPos ? 'default' : 'pointer',
                        background: '#1E1E1B'
                      }}
                    >
                      {tile && blobCache[tile.blobHash] && (
                        <img
                          src={blobCache[tile.blobHash]}
                          alt={tile.name}
                          className="pixelated"
                          style={{ width: CELL, height: CELL, display: 'block' }}
                        />
                      )}
                      {marker && (
                        <span
                          style={{
                            position: 'absolute',
                            inset: 4,
                            borderRadius: 4,
                            border: '1.5px dashed var(--accent)',
                            fontSize: 9.5,
                            letterSpacing: '0.05em',
                            background: 'rgba(24, 24, 22, 0.78)',
                            color: 'var(--accent)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700
                          }}
                        >
                          {marker.kind.toUpperCase()}
                        </span>
                      )}
                      {isPlayer && (
                        <span
                          style={{
                            position: 'absolute',
                            inset: 10,
                            borderRadius: '50%',
                            background: 'var(--accent)',
                            color: 'var(--accent-ink)',
                            fontWeight: 800,
                            fontSize: 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          P
                        </span>
                      )}
                    </div>
                  )
                })
              )}

              {/* Real Pixel-Art Sprite Placements rendered on the Map Grid! */}
              {[...scene.placements]
                .sort((a, b) => a.gridY - b.gridY)
                .map((p) => {
                  const spriteUrl = getAssetSpriteUrl(p.assetId, p.revisionId)
                  return (
                    <div
                      key={p.placementId}
                      style={{
                        position: 'absolute',
                        left: p.gridX * CELL,
                        top: p.gridY * CELL,
                        width: p.footprint.w * CELL,
                        height: p.footprint.h * CELL,
                        pointerEvents: 'none',
                        zIndex: 5 + p.gridY
                      }}
                    >
                      {showFootprints && (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 2,
                            borderRadius: 5,
                            border: '1.5px dashed rgba(242, 188, 94, 0.72)',
                            background: 'rgba(242, 188, 94, 0.14)'
                          }}
                        />
                      )}
                      {spriteUrl && (
                        <img
                          src={spriteUrl}
                          alt={p.name}
                          className="pixelated"
                          style={{
                            position: 'absolute',
                            left: '50%',
                            bottom: 2,
                            transform: 'translateX(-50%)',
                            width: p.footprint.w * CELL * 0.94,
                            height: 'auto',
                            maxHeight: CELL * 1.48,
                            objectFit: 'contain',
                            filter: 'drop-shadow(0 4px 5px rgba(0,0,0,0.48))'
                          }}
                        />
                      )}
                      <span
                        style={{
                          position: 'absolute',
                          left: '50%',
                          bottom: -10,
                          transform: 'translateX(-50%)',
                          background: 'rgba(18, 21, 26, 0.86)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 999,
                          padding: '1px 7px',
                          fontSize: 9.5,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          color: '#ECEFF4'
                        }}
                      >
                        {p.name}
                      </span>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Right Map Diagnostics & Layers */}
          <div style={{ width: 256, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'var(--bg-panel)', padding: 12, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-divider)' }}>
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={12} color="var(--accent)" /> Lớp bản đồ ({scene.layers.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {scene.layers.map((l) => (
                  <div
                    key={l.layerId}
                    style={{
                      fontSize: 12,
                      padding: '5px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-input)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <span>{l.name}</span>
                    <span className="badge" style={{ fontSize: 10 }}>{l.kind}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: 'var(--bg-panel)', padding: 12, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-divider)' }}>
              <div className="section-title">Kiểm tra liên kết & Footprint</div>
              {sceneIssues.length === 0 ? (
                <div style={{ color: 'var(--status-success)', fontSize: 12.5, display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                  <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>Không có lỗi chồng lấn footprint, vượt biên hay liên kết hỏng.</span>
                </div>
              ) : (
                sceneIssues.map((iss, i) => (
                  <div key={i} style={{ fontSize: 12, color: iss.severity === 'error' ? 'var(--status-error)' : 'var(--status-warning)', marginBottom: 5 }}>
                    • {iss.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- VISUAL DIALOGUE NODE FLOW & INTERACTIVE BRANCH SIMULATOR (A07) ----
  if (asset.type === 'dialogue' && dialogue) {
    const issues = validateDialogueGraph(dialogue, {
      assetIds: new Set(project.assets.filter((a) => !a.trashedAt).map((a) => a.assetId)),
      flags: project.stateFlags,
      quests: project.quests
    })
    const curNode = simState ? dialogue.nodes.find((n) => n.nodeId === simState.currentNodeId) : null
    const availEdges = simState ? getAvailableEdges(dialogue, simState) : []

    const resetSim = (hasHammer: boolean) => {
      setSimHasHammer(hasHammer)
      const flags: Record<string, boolean | number | string> = {}
      for (const f of project.stateFlags) flags[f.key] = f.defaultValue
      setSimState(createSimulationState(dialogue, flags, hasHammer ? { item_hammer: 1 } : {}))
    }

    const startNode = dialogue.nodes.find((n) => n.nodeId === dialogue.startNodeId)
    const middleNodes = dialogue.nodes.filter((n) => n.nodeId !== dialogue.startNodeId && n.kind !== 'end')
    const endNodes = dialogue.nodes.filter((n) => n.kind === 'end')

    const renderNodeCard = (node: (typeof dialogue.nodes)[number], accentColor: string, roleLabel: string) => {
      const isCurrent = simState?.currentNodeId === node.nodeId
      const outs = dialogue.edges.filter((e) => e.fromNodeId === node.nodeId)
      return (
        <div
          key={node.nodeId}
          style={{
            background: 'var(--bg-panel)',
            border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border-divider)'}`,
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            transition: 'border-color 0.12s ease'
          }}
        >
          <div
            style={{
              padding: '7px 12px',
              background: 'rgba(0,0,0,0.2)',
              borderBottom: '1px solid var(--border-hairline)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 6
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span className="status-dot" style={{ background: accentColor }} />
              <strong className="mono" style={{ fontSize: 11.5 }}>{node.nodeId}</strong>
              <span className="badge" style={{ fontSize: 10 }}>{roleLabel}</span>
            </div>
            {node.speakerName && <span className="badge info" style={{ fontSize: 10 }}>{node.speakerName}</span>}
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {node.text ? (
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                “{node.text}”
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Điểm kết thúc hội thoại
              </div>
            )}
            {node.effects.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {node.effects.map((ef, idx) => (
                  <span
                    key={idx}
                    className="badge approved mono"
                    style={{ fontSize: 10, whiteSpace: 'normal', wordBreak: 'break-word', borderRadius: 6 }}
                  >
                    {ef.kind}: {ef.key}={String(ef.value)}
                  </span>
                ))}
              </div>
            )}
            {outs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingTop: 4, borderTop: '1px solid var(--border-hairline)' }}>
                {outs.map((e) => (
                  <span key={e.edgeId} className="badge" style={{ fontSize: 10.5 }}>
                    <GitBranch size={10} color="var(--accent)" /> {e.label || 'Tiếp'} → <span className="mono">{e.toNodeId}</span>
                    {e.condition && <span style={{ color: 'var(--status-warning)' }}> [{e.condition.key}]</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="studio-viewport-bg" style={{ flex: 1, padding: 22, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 330px', gap: 22 }}>
        {/* Visual Tiered Node Graph */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 17 }}>{dialogue.name}</h3>
            <span className={`badge ${issues.length === 0 ? 'approved' : 'error'}`}>
              {issues.length === 0 ? (
                <>
                  <CheckCircle2 size={12} /> 0 lỗi cấu trúc · {dialogue.nodes.length} nodes
                </>
              ) : (
                <>
                  <AlertTriangle size={12} /> {issues.length} lỗi đồ thị
                </>
              )}
            </span>
          </div>

          {startNode && renderNodeCard(startNode, 'var(--accent)', 'Bắt đầu')}

          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            ↓ phân nhánh theo điều kiện túi đồ / cờ trạng thái ↓
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, middleNodes.length)}, 1fr)`, gap: 12 }}>
            {middleNodes.map((n) =>
              renderNodeCard(
                n,
                n.effects.length > 0 ? 'var(--status-success)' : 'var(--status-warning)',
                n.effects.length > 0 ? 'Nhánh hoàn thành' : 'Nhánh nhắc nhở'
              )
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            ↓ hội tụ kết thúc ↓
          </div>

          {endNodes.map((n) => renderNodeCard(n, 'var(--status-info)', 'Kết thúc'))}
        </div>

        {/* Interactive Branch Simulator */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              background: 'var(--bg-panel)',
              padding: 14,
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-divider)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
            data-testid="dialogue-simulator"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 13.5 }}>Mô phỏng nhánh hội thoại</strong>
              <button className="ghost" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => resetSim(simHasHammer)} data-testid="btn-sim-reset">
                <RotateCcw size={12} /> Đặt lại
              </button>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--bg-input)',
                border: '1px solid var(--border-hairline)',
                cursor: 'pointer'
              }}
            >
              <input
                type="checkbox"
                checked={simHasHammer}
                onChange={(e) => resetSim(e.target.checked)}
                data-testid="checkbox-sim-hammer"
              />
              <span>
                Túi đồ có: <strong>Búa thợ mộc</strong> <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>(item_hammer)</span>
              </span>
            </label>

            {/* In-Game Dialogue Speech Bubble */}
            {curNode && simState && (
              <div
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {curNode.speakerName || (simState.finished ? 'Hoàn tất' : curNode.kind)}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }} data-testid="sim-current-text">
                  {curNode.text || (simState.finished ? '— Hội thoại đã kết thúc —' : '')}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {availEdges.map((edge) => (
                <button
                  key={edge.edgeId}
                  className="primary"
                  style={{ padding: '7px 12px', justifyContent: 'flex-start' }}
                  data-testid={`sim-edge-${edge.edgeId}`}
                  onClick={() => simState && setSimState(stepSimulation(dialogue, simState, edge.edgeId))}
                >
                  <Play size={12} /> {edge.label || `Đi tới ${edge.toNodeId}`}
                </button>
              ))}
            </div>

            {/* Structured Tags for Flags & Inventory */}
            {simState && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border-hairline)' }}>
                <div>
                  <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                    <Flag size={11} color="var(--accent)" /> Cờ trạng thái
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {Object.entries(simState.flags).map(([k, v]) => (
                      <span key={k} className={`badge mono ${v === true ? 'approved' : ''}`}>
                        {k}: {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                    <Backpack size={11} color="var(--status-warning)" /> Túi đồ & Nhiệm vụ
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {Object.entries(simState.inventory).length === 0 ? (
                      <span className="badge">Túi trống</span>
                    ) : (
                      Object.entries(simState.inventory).map(([k, qty]) => (
                        <span key={k} className="badge warning mono">{k} ×{qty}</span>
                      ))
                    )}
                    {Object.entries(simState.questStatus).map(([k, st]) => (
                      <span key={k} className={`badge ${st === 'completed' ? 'approved' : 'info'}`}>
                        {k}: {st}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ---- QUEST & STATE FLAGS EDITOR ----
  if (asset.type === 'quest' && quest) {
    const issues = validateQuest(quest, {
      assetIds: new Set(project.assets.filter((a) => !a.trashedAt).map((a) => a.assetId)),
      flags: project.stateFlags,
      quests: project.quests
    })
    return (
      <div className="studio-viewport-bg" style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18 }}>{quest.name}</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)' }}>{quest.description}</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: 'var(--bg-panel)', padding: 16, borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div className="section-title">Mục tiêu & Phần thưởng</div>
            {quest.objectives.map((o) => (
              <div key={o.objectiveId} style={{ fontSize: 13, marginBottom: 8 }}>
                • {o.description} (<span className="mono" style={{ color: 'var(--accent)' }}>{o.condition.kind}: {o.condition.key}</span>)
              </div>
            ))}
            <div className="section-title" style={{ marginTop: 14 }}>Phần thưởng</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {quest.rewards.map((r, i) => (
                <span key={i} className="badge warning mono">+{r.quantity} {r.itemKey}</span>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 12 }}>
              Cờ hoàn thành: <span className="badge approved mono">{quest.completionFlagKey}</span>
            </div>
          </div>
          <div style={{ background: 'var(--bg-panel)', padding: 16, borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            <div className="section-title">Cờ trạng thái dự án ({project.stateFlags.length})</div>
            {project.stateFlags.map((f) => (
              <div key={f.flagId} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-hairline)' }}>
                <span className="mono">{f.key}</span>
                <span className="badge">{f.type} = {String(f.defaultValue)}</span>
              </div>
            ))}
            <div style={{ marginTop: 12, fontSize: 12, color: issues.length === 0 ? 'var(--status-success)' : 'var(--status-error)' }}>
              {issues.length === 0 ? 'Nhiệm vụ hợp lệ 100%.' : issues.map((x) => x.message).join(' | ')}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- DATA TABLE EDITOR ----
  if (asset.type === 'data_table' && dataTable) {
    const issues = validateDataTable(
      dataTable,
      new Set(project.assets.filter((a) => !a.trashedAt).map((a) => a.assetId))
    )
    const addRow = async () => {
      const newRow: Record<string, unknown> = {}
      for (const c of dataTable.columns) {
        newRow[c.name] = c.type === 'int' || c.type === 'float' ? c.min ?? 0 : c.type === 'bool' ? false : c.enumValues?.[0] ?? 'new_item'
      }
      const next = { ...dataTable, rows: [...dataTable.rows, newRow], updatedAt: new Date().toISOString() }
      const s = (await window.pixelStudio.upsertEntity('data_table', dataTable.tableId, next)) as ProjectFullState
      setProjectState(s)
      setFeedback('draft_ready', 'Đã thêm dòng vào bảng chỉ số')
    }

    return (
      <div className="studio-viewport-bg" style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>{dataTable.name}</h3>
          <button className="primary" onClick={addRow}><Plus size={14} /> Thêm dòng</button>
        </div>
        <div style={{ borderRadius: 11, overflow: 'hidden', border: '1px solid var(--border-subtle)', background: 'var(--bg-panel)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.22)' }}>
                {dataTable.columns.map((c) => (
                  <th key={c.colId} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                    {c.name} <span className="badge" style={{ marginLeft: 4 }}>{c.type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataTable.rows.map((row, idx) => (
                <tr key={idx}>
                  {dataTable.columns.map((c) => (
                    <td key={c.colId} className="mono" style={{ padding: '9px 12px', borderBottom: '1px solid var(--border-hairline)' }}>
                      {String(row[c.name] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {issues.length > 0 && (
          <div style={{ marginTop: 10, color: 'var(--status-error)', fontSize: 12 }}>
            {issues.map((i, idx) => <div key={idx}>• {i.message}</div>)}
          </div>
        )}
      </div>
    )
  }

  // ---- UI SCREEN & 9-SLICE PREVIEW ----
  if (asset.type === 'ui_screen' && uiScreen) {
    return (
      <div className="studio-viewport-bg" style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h3 style={{ margin: 0 }}>{uiScreen.name}</h3>
            <span className="badge info mono">{uiScreen.resolutionPx.w}×{uiScreen.resolutionPx.h}</span>
          </div>
          <div className="segmented">
            {(['normal', 'pressed', 'disabled'] as const).map((st) => (
              <button key={st} className={uiPreviewState === st ? 'seg-active-accent' : ''} onClick={() => setUiPreviewState(st)}>
                {st}
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            position: 'relative',
            width: uiScreen.resolutionPx.w,
            height: uiScreen.resolutionPx.h,
            background: '#1B1B19',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-canvas)'
          }}
        >
          {uiScreen.elements.map((el) => (
            <div
              key={el.elementId}
              style={{
                position: 'absolute',
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                border: '2px solid var(--accent)',
                borderRadius: 4,
                background:
                  el.kind === 'button'
                    ? uiPreviewState === 'pressed'
                      ? '#6E4730'
                      : uiPreviewState === 'disabled'
                        ? '#4F6D8A'
                        : 'var(--accent)'
                    : 'rgba(232, 198, 155, 0.16)',
                color: el.kind === 'button' && uiPreviewState === 'normal' ? 'var(--accent-ink)' : 'var(--text-primary)',
                padding: 6,
                fontSize: 12,
                fontWeight: 600
              }}
            >
              {el.text || el.name}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ---- CUTSCENE / STORYBOARD TIMELINE ----
  if (asset.type === 'cutscene' && cutscene) {
    const activeShot = cutscene.shots[shotIdx] ?? cutscene.shots[0]
    return (
      <div className="studio-viewport-bg" style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={{ margin: 0 }}>{cutscene.name} ({cutscene.shots.length} cảnh)</h3>
        {activeShot && (
          <div style={{ background: 'var(--bg-panel)', padding: 18, borderRadius: 'var(--radius-lg)', border: '1px solid var(--accent-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <strong style={{ fontSize: 15 }}>{activeShot.title}</strong>
              <span className="badge info mono">{activeShot.durationMs} ms · {activeShot.transitionCue}</span>
            </div>
            <p style={{ margin: '8px 0', fontSize: 16, lineHeight: 1.5 }}>“{activeShot.dialogueText}”</p>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Ghi chú camera: {activeShot.cameraNotes}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          {cutscene.shots.map((sh, i) => (
            <button key={sh.shotId} className={i === shotIdx ? 'primary' : ''} onClick={() => setShotIdx(i)}>
              #{i + 1} {sh.title} ({sh.durationMs}ms)
            </button>
          ))}
        </div>
      </div>
    )
  }

  return null
}
