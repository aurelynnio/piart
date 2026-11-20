import fs from 'node:fs'
import path from 'node:path'
import {
  MANIFEST_SCHEMA_VERSION,
  MIN_IMPORTER_VERSION,
  PINNED_UNITY_VERSION,
  type Asset,
  type AssetRevision,
  type Clip,
  type Cutscene,
  type DataTable,
  type DialogueGraph,
  type ExportManifest,
  type ExportManifestEntry,
  type Palette,
  type Quest,
  type Scene,
  type StateFlag,
  type TileSet,
  type UIScreen,
  type ValidationIssue,
  type VFXConfig
} from '@domain/schemas/types'
import {
  buildUnityClipName,
  clipFramesToUnityKeyframes,
  slugifyAscii,
  studioNineSliceToUnityBorder,
  studioPivotToUnityPivot,
  studioRectToUnityRect,
  studioTileToUnityCell
} from '@domain/rules/unityMath'
import {
  validateClip,
  validateManifestObject,
  validateSceneAndGameplay,
  validateSprite
} from '@domain/validators/assetValidator'
import { redactDeep } from '@domain/security/redactor'
import { ProjectStore, makeId } from '../db/projectStore'
import {
  analyzeSpriteMetrics,
  computeSha256,
  decodePng,
  encodePng,
  packHorizontalStrip,
  packTextureAtlas
} from '../imaging/pixelEngine'

export interface ExportRequest {
  scopeKind: 'asset' | 'collection' | 'scene' | 'project'
  rootIds: string[]
  targetDir: string
  includeAtlas?: boolean
  atlasPaddingPx?: number
  includeSpriteSheets?: boolean
  extraSecretsToRedact?: string[]
}

export interface ExportPreflightReport {
  ok: boolean
  scopeKind: ExportRequest['scopeKind']
  rootIds: string[]
  resolvedAssetIds: string[]
  resolvedClipIds: string[]
  resolvedSceneIds: string[]
  resolvedTilesetIds: string[]
  resolvedDialogueIds: string[]
  resolvedQuestIds: string[]
  issues: ValidationIssue[]
  errorCount: number
  warningCount: number
}

export interface ExportExecutionResult {
  exportRunId: string
  targetDir: string
  manifestPath: string
  manifest: ExportManifest
  preflight: ExportPreflightReport
  filesWritten: number
}

function resolveScopeDependencies(
  store: ProjectStore,
  scopeKind: ExportRequest['scopeKind'],
  rootIds: string[]
) {
  const allAssets = store.listEntities<Asset>('asset').filter((a) => !a.trashedAt)
  const allClips = store.listEntities<Clip>('clip')
  const allScenes = store.listEntities<Scene>('scene')
  const allTilesets = store.listEntities<TileSet>('tileset')
  const allDialogues = store.listEntities<DialogueGraph>('dialogue')
  const allQuests = store.listEntities<Quest>('quest')
  const allUiScreens = store.listEntities<UIScreen>('ui_screen')
  const allVfx = store.listEntities<VFXConfig>('vfx')
  const allCutscenes = store.listEntities<Cutscene>('cutscene')
  const allDataTables = store.listEntities<DataTable>('data_table')

  const assetIds = new Set<string>()
  const clipIds = new Set<string>()
  const sceneIds = new Set<string>()
  const tilesetIds = new Set<string>()
  const dialogueIds = new Set<string>()
  const questIds = new Set<string>()

  const addAsset = (id: string) => {
    const asset = allAssets.find((a) => a.assetId === id)
    if (!asset) return
    assetIds.add(id)
    for (const c of allClips.filter((x) => x.assetId === id)) clipIds.add(c.clipId)
    for (const d of allDialogues.filter((x) => x.npcAssetId === id || x.assetId === id)) {
      dialogueIds.add(d.dialogueId)
    }
    for (const q of allQuests.filter((x) => x.giverNpcAssetId === id || x.assetId === id)) {
      questIds.add(q.questId)
      for (const r of q.rewards) {
        if (r.itemAssetId) assetIds.add(r.itemAssetId)
      }
    }
    const ts = allTilesets.find((t) => t.assetId === id)
    if (ts) tilesetIds.add(ts.tilesetId)
    const sc = allScenes.find((s) => s.assetId === id)
    if (sc) addScene(sc.sceneId)
  }

  const addScene = (sid: string) => {
    const sc = allScenes.find((s) => s.sceneId === sid || s.assetId === sid)
    if (!sc) return
    sceneIds.add(sc.sceneId)
    assetIds.add(sc.assetId)
    if (sc.tilesetId) {
      tilesetIds.add(sc.tilesetId)
      const ts = allTilesets.find((t) => t.tilesetId === sc.tilesetId)
      if (ts) assetIds.add(ts.assetId)
    }
    for (const p of sc.placements) {
      addAsset(p.assetId)
      if (p.linkedDialogueId) dialogueIds.add(p.linkedDialogueId)
      if (p.linkedQuestId) questIds.add(p.linkedQuestId)
    }
    for (const m of sc.markers) {
      if (m.linkedDialogueId) dialogueIds.add(m.linkedDialogueId)
      if (m.linkedQuestId) questIds.add(m.linkedQuestId)
    }
  }

  if (scopeKind === 'project') {
    for (const a of allAssets) assetIds.add(a.assetId)
    for (const c of allClips) clipIds.add(c.clipId)
    for (const s of allScenes) sceneIds.add(s.sceneId)
    for (const t of allTilesets) tilesetIds.add(t.tilesetId)
    for (const d of allDialogues) dialogueIds.add(d.dialogueId)
    for (const q of allQuests) questIds.add(q.questId)
  } else if (scopeKind === 'scene') {
    for (const id of rootIds) addScene(id)
  } else if (scopeKind === 'collection') {
    const rootSet = new Set(rootIds)
    for (const a of allAssets) {
      if ((a.folderId && rootSet.has(a.folderId)) || a.collectionIds.some((c) => rootSet.has(c))) {
        addAsset(a.assetId)
      }
    }
  } else {
    for (const id of rootIds) addAsset(id)
  }

  return {
    assets: allAssets.filter((a) => assetIds.has(a.assetId)),
    clips: allClips.filter((c) => clipIds.has(c.clipId)),
    scenes: allScenes.filter((s) => sceneIds.has(s.sceneId)),
    tilesets: allTilesets.filter((t) => tilesetIds.has(t.tilesetId)),
    dialogues: allDialogues.filter((d) => dialogueIds.has(d.dialogueId)),
    quests: allQuests.filter((q) => questIds.has(q.questId)),
    uiScreens: allUiScreens.filter((u) => scopeKind === 'project' || assetIds.has(u.assetId)),
    vfxConfigs: allVfx.filter((v) => scopeKind === 'project' || assetIds.has(v.assetId)),
    cutscenes: allCutscenes.filter((c) => scopeKind === 'project' || assetIds.has(c.assetId)),
    dataTables: allDataTables.filter((t) => scopeKind === 'project' || assetIds.has(t.assetId)),
    stateFlags: store.listEntities<StateFlag>('state_flag')
  }
}

export function runExportPreflight(
  store: ProjectStore,
  scopeKind: ExportRequest['scopeKind'],
  rootIds: string[]
): ExportPreflightReport {
  const scope = resolveScopeDependencies(store, scopeKind, rootIds)
  const cfg = store.getProjectConfig()
  const activePalette = cfg.activePaletteId
    ? store.getEntity<Palette>('palette', cfg.activePaletteId)
    : null
  const issues: ValidationIssue[] = []
  const existingBlobs = new Set<string>()

  // Validate sprites
  for (const asset of scope.assets) {
    if (['map', 'dialogue', 'quest', 'data_table', 'cutscene', 'ui_screen', 'tileset'].includes(asset.type)) {
      continue
    }
    const revId = asset.approvedRevisionId ?? asset.latestRevisionId
    const rev = revId ? store.getRevision(revId) : null
    if (!rev) {
      if (scope.clips.some((c) => c.assetId === asset.assetId)) continue
      issues.push({
        code: 'ASSET_NO_REVISION',
        severity: 'warning',
        targetId: asset.assetId,
        targetType: 'asset',
        message: `Asset "${asset.name}" chưa có revision ảnh nào.`
      })
      continue
    }
    const exists = Boolean(rev.normalizedBlobHash && store.blobExists(rev.normalizedBlobHash))
    if (exists && rev.normalizedBlobHash) existingBlobs.add(rev.normalizedBlobHash)

    let actualW: number | undefined
    let actualH: number | undefined
    let semi = 0
    let offPal = 0
    if (exists && rev.normalizedBlobHash) {
      const img = decodePng(store.readBlob(rev.normalizedBlobHash))
      const metrics = analyzeSpriteMetrics(img, activePalette?.colors)
      actualW = metrics.width
      actualH = metrics.height
      semi = metrics.semiTransparentPixels
      offPal = metrics.offPaletteColors
    }

    issues.push(
      ...validateSprite({
        asset,
        revision: rev,
        actualWidth: actualW,
        actualHeight: actualH,
        semiTransparentPixelCount: semi,
        offPaletteColorCount: offPal,
        palette: activePalette,
        enforcePalette: false,
        blobExists: exists
      })
    )
  }

  // Validate clips
  for (const clip of scope.clips) {
    for (const f of clip.frames) {
      if (store.blobExists(f.blobHash)) existingBlobs.add(f.blobHash)
    }
    issues.push(...validateClip(clip, existingBlobs))
  }

  // Validate scenes & gameplay links
  const allAssets = store.listEntities<Asset>('asset')
  for (const scene of scope.scenes) {
    issues.push(
      ...validateSceneAndGameplay({
        scene,
        tilesets: scope.tilesets,
        assets: allAssets,
        dialogues: scope.dialogues,
        quests: scope.quests,
        flags: scope.stateFlags
      })
    )
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length

  return {
    ok: errorCount === 0,
    scopeKind,
    rootIds,
    resolvedAssetIds: scope.assets.map((a) => a.assetId),
    resolvedClipIds: scope.clips.map((c) => c.clipId),
    resolvedSceneIds: scope.scenes.map((s) => s.sceneId),
    resolvedTilesetIds: scope.tilesets.map((t) => t.tilesetId),
    resolvedDialogueIds: scope.dialogues.map((d) => d.dialogueId),
    resolvedQuestIds: scope.quests.map((q) => q.questId),
    issues,
    errorCount,
    warningCount
  }
}

export function exportUnityPackage(
  store: ProjectStore,
  req: ExportRequest
): ExportExecutionResult {
  const preflight = runExportPreflight(store, req.scopeKind, req.rootIds)
  if (!preflight.ok) {
    const firstErrors = preflight.issues
      .filter((i) => i.severity === 'error')
      .slice(0, 5)
      .map((i) => i.message)
      .join(' | ')
    throw new Error(`Kiểm tra tiền xuất phát hiện ${preflight.errorCount} lỗi chặn: ${firstErrors}`)
  }

  const cfg = store.getProjectConfig()
  const scope = resolveScopeDependencies(store, req.scopeKind, req.rootIds)
  const exportRunId = makeId('exp')
  const exportedAt = new Date().toISOString()
  const stageDir = path.join(store.rootDir, 'staging', `export_${exportRunId}`)
  fs.mkdirSync(stageDir, { recursive: true })

  const entries: ExportManifestEntry[] = []
  const actualChecksums = new Map<string, string>()

  const writeStageFile = (relPath: string, data: Buffer | string) => {
    const normRel = relPath.replace(/\\/g, '/')
    const full = path.join(stageDir, normRel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data
    fs.writeFileSync(full, buf)
    const sha256 = computeSha256(buf)
    actualChecksums.set(normRel, sha256)
    return { relPath: normRel, sha256, byteSize: buf.byteLength }
  }

  const atlasInputs: Array<{ id: string; image: ReturnType<typeof decodePng> }> = []
  const spriteAssetRevMap = new Map<string, AssetRevision>()

  // 1) Export Sprites (PNG + metadata)
  for (const asset of scope.assets) {
    if (['map', 'dialogue', 'quest', 'data_table', 'cutscene', 'ui_screen', 'tileset'].includes(asset.type)) {
      continue
    }
    const revId = asset.approvedRevisionId ?? asset.latestRevisionId
    const rev = revId ? store.getRevision(revId) : null
    if (!rev || !rev.normalizedBlobHash || !store.blobExists(rev.normalizedBlobHash)) continue

    spriteAssetRevMap.set(asset.assetId, rev)
    const pngBuf = store.readBlob(rev.normalizedBlobHash)
    const baseName = `${slugifyAscii(asset.slug)}_${asset.assetId}`
    const pngWritten = writeStageFile(`textures/${baseName}.png`, pngBuf)
    const unityPivot = studioPivotToUnityPivot(rev.pivotPx, rev.canvasPx)
    const unityBorder = rev.nineSlice ? studioNineSliceToUnityBorder(rev.nineSlice) : null

    const metaJson = redactDeep(
      {
        stableId: asset.assetId,
        revisionId: rev.revisionId,
        name: asset.name,
        slug: asset.slug,
        assetType: asset.type,
        pixelsPerUnit: cfg.pixelsPerUnit,
        canvasPx: rev.canvasPx,
        pivotPx: rev.pivotPx,
        unityPivot,
        footprintTiles: rev.footprintTiles,
        collisionBox: rev.collisionBox,
        nineSlice: rev.nineSlice,
        unityNineSliceBorder: unityBorder,
        attachmentPoints: rev.attachmentPoints,
        textureSettings: {
          filterMode: 'Point',
          compression: 'Uncompressed',
          mipmapEnabled: false,
          alphaIsTransparency: true,
          spriteMeshType: 'FullRect'
        }
      },
      req.extraSecretsToRedact
    )
    const metaWritten = writeStageFile(
      `textures/${baseName}.meta.json`,
      JSON.stringify(metaJson, null, 2)
    )

    entries.push({
      stableId: asset.assetId,
      revisionId: rev.revisionId,
      assetType: asset.type,
      name: asset.name,
      relativePath: pngWritten.relPath,
      metadataPath: metaWritten.relPath,
      sha256: pngWritten.sha256,
      byteSize: pngWritten.byteSize,
      dependencies: []
    })

    if (req.includeAtlas !== false) {
      atlasInputs.push({ id: asset.assetId, image: decodePng(pngBuf) })
    }
  }

  // 2) Export Clips (Spritesheets + stable per-frame PNGs + .clip.json)
  for (const clip of scope.clips) {
    const parentAsset = scope.assets.find((a) => a.assetId === clip.assetId)
    const assetSlug = parentAsset?.slug ?? clip.assetId
    const frameImages = clip.frames.map((f) => decodePng(store.readBlob(f.blobHash)))
    const { sheet, rects } = packHorizontalStrip(frameImages, 0)
    const sheetPng = encodePng(sheet)
    const clipSlug = `${slugifyAscii(assetSlug)}_${slugifyAscii(clip.action)}_${slugifyAscii(clip.direction)}`
    const sheetWritten = writeStageFile(`spritesheets/${clipSlug}_${clip.clipId}.png`, sheetPng)

    // Also export stable individual frame PNGs keyed by frameId so Unity GUIDs stay rock-solid on re-import!
    const frameEntries = clip.frames.map((f, idx) => {
      const fPng = store.readBlob(f.blobHash)
      const fWritten = writeStageFile(
        `textures/frames/${clipSlug}_${f.frameId}.png`,
        fPng
      )
      entries.push({
        stableId: f.frameId,
        revisionId: f.revisionId,
        assetType: 'clip_frame',
        name: `${clip.name} #${idx + 1}`,
        relativePath: fWritten.relPath,
        metadataPath: null,
        sha256: fWritten.sha256,
        byteSize: fWritten.byteSize,
        dependencies: [clip.assetId]
      })
      return {
        frameId: f.frameId,
        slotIndex: f.slotIndex,
        revisionId: f.revisionId,
        durationMs: f.durationMs,
        frameTexturePath: fWritten.relPath,
        studioRect: rects[idx],
        unityRect: studioRectToUnityRect(rects[idx], sheet.height)
      }
    })

    const timing = clipFramesToUnityKeyframes(clip.frames)
    const clipDef = {
      stableId: clip.clipId,
      assetId: clip.assetId,
      assetSlug,
      name: clip.name,
      unityClipName: buildUnityClipName(assetSlug, clip.action, clip.direction),
      action: clip.action,
      direction: clip.direction,
      fps: clip.fps,
      loopMode: clip.loopMode,
      playbackSpeed: clip.playbackSpeed,
      canvasPx: clip.canvasPx,
      anchorPx: clip.anchorPx,
      unityPivot: studioPivotToUnityPivot(clip.anchorPx, clip.canvasPx),
      pixelsPerUnit: cfg.pixelsPerUnit,
      spriteSheetPath: sheetWritten.relPath,
      sheetSizePx: { w: sheet.width, h: sheet.height },
      totalDurationMs: timing.totalDurationMs,
      totalDurationSec: timing.totalDurationSec,
      frames: frameEntries,
      unityKeyframes: timing.keyframes,
      events: clip.events
    }
    const clipWritten = writeStageFile(
      `animations/${clipSlug}_${clip.clipId}.clip.json`,
      JSON.stringify(clipDef, null, 2)
    )

    entries.push({
      stableId: clip.clipId,
      revisionId: clip.frames[0]?.revisionId ?? clip.updatedAt,
      assetType: 'clip',
      name: clip.name,
      relativePath: clipWritten.relPath,
      metadataPath: sheetWritten.relPath,
      sha256: clipWritten.sha256,
      byteSize: clipWritten.byteSize,
      dependencies: [clip.assetId, ...clip.frames.map((f) => f.frameId)]
    })
  }

  // 3) Export Texture Atlas with Padding/Extrusion (F115)
  if (req.includeAtlas !== false && atlasInputs.length > 0) {
    const padding = Math.max(2, req.atlasPaddingPx ?? 2)
    const packed = packTextureAtlas(atlasInputs, { padding, maxWidth: 2048, extrude: true })
    const atlasPng = encodePng(packed.atlas)
    const atlasWritten = writeStageFile('atlases/studio_atlas.png', atlasPng)
    const atlasMeta = {
      stableId: `atlas_${cfg.projectId}`,
      paddingPx: padding,
      extruded: true,
      width: packed.atlas.width,
      height: packed.atlas.height,
      pixelsPerUnit: cfg.pixelsPerUnit,
      sprites: packed.placements.map((p) => {
        const rev = spriteAssetRevMap.get(p.id)
        return {
          stableId: p.id,
          studioRect: p.rect,
          unityRect: studioRectToUnityRect(p.rect, packed.atlas.height),
          unityPivot: rev
            ? studioPivotToUnityPivot(rev.pivotPx, rev.canvasPx)
            : { x: 0.5, y: 0 }
        }
      })
    }
    const atlasMetaWritten = writeStageFile(
      'atlases/studio_atlas.atlas.json',
      JSON.stringify(atlasMeta, null, 2)
    )
    entries.push({
      stableId: atlasMeta.stableId,
      revisionId: exportRunId,
      assetType: 'atlas',
      name: 'Studio Texture Atlas',
      relativePath: atlasWritten.relPath,
      metadataPath: atlasMetaWritten.relPath,
      sha256: atlasWritten.sha256,
      byteSize: atlasWritten.byteSize,
      dependencies: atlasInputs.map((a) => a.id)
    })
  }

  // 4) Export Tilesets (with padding + AutoTileRules)
  for (const ts of scope.tilesets) {
    const tileEntries = ts.tiles.map((t) => ({
      id: t.tileId,
      image: decodePng(store.readBlob(t.blobHash))
    }))
    const packed = packTextureAtlas(tileEntries, {
      padding: Math.max(2, ts.paddingPx),
      maxWidth: 1024,
      extrude: true
    })
    const tsSlug = slugifyAscii(ts.name)
    const tsPng = writeStageFile(`tilesets/${tsSlug}_${ts.tilesetId}.png`, encodePng(packed.atlas))
    const tsDef = {
      stableId: ts.tilesetId,
      assetId: ts.assetId,
      name: ts.name,
      tileSizePx: ts.tileSizePx,
      paddingPx: Math.max(2, ts.paddingPx),
      pixelsPerUnit: cfg.pixelsPerUnit,
      texturePath: tsPng.relPath,
      textureSizePx: { w: packed.atlas.width, h: packed.atlas.height },
      tiles: ts.tiles.map((t) => {
        const pl = packed.placements.find((p) => p.id === t.tileId)!
        return {
          ...t,
          studioRect: pl.rect,
          unityRect: studioRectToUnityRect(pl.rect, packed.atlas.height)
        }
      }),
      autoTileRules: ts.autoTileRules
    }
    const tsJson = writeStageFile(
      `tilesets/${tsSlug}_${ts.tilesetId}.tileset.json`,
      JSON.stringify(tsDef, null, 2)
    )
    entries.push({
      stableId: ts.tilesetId,
      revisionId: ts.updatedAt,
      assetType: 'tileset',
      name: ts.name,
      relativePath: tsJson.relPath,
      metadataPath: tsPng.relPath,
      sha256: tsJson.sha256,
      byteSize: tsJson.byteSize,
      dependencies: []
    })
  }

  // 5) Export Scenes (with exact Unity Y-flipped cell coordinates)
  for (const sc of scope.scenes) {
    const scSlug = slugifyAscii(sc.name)
    const scDef = {
      stableId: sc.sceneId,
      assetId: sc.assetId,
      name: sc.name,
      cols: sc.cols,
      rows: sc.rows,
      tileSizePx: sc.tileSizePx,
      pixelsPerUnit: cfg.pixelsPerUnit,
      tilesetId: sc.tilesetId,
      layers: sc.layers.map((l) => ({
        layerId: l.layerId,
        name: l.name,
        kind: l.kind,
        order: l.order,
        visible: l.visible,
        cells: Object.entries(l.cells).map(([key, tileId]) => {
          const [col, row] = key.split(',').map(Number)
          return {
            col,
            row,
            unityCell: studioTileToUnityCell(col, row, sc.rows),
            tileId
          }
        })
      })),
      placements: sc.placements.map((p) => ({
        ...p,
        unityCell: studioTileToUnityCell(p.gridX, p.gridY, sc.rows)
      })),
      collisionRects: sc.collisionRects,
      markers: sc.markers.map((m) => ({
        ...m,
        unityCell: studioTileToUnityCell(m.gridX, m.gridY, sc.rows)
      }))
    }
    const scWritten = writeStageFile(
      `scenes/${scSlug}_${sc.sceneId}.scene.json`,
      JSON.stringify(scDef, null, 2)
    )
    const deps = [
      ...(sc.tilesetId ? [sc.tilesetId] : []),
      ...sc.placements.map((p) => p.assetId)
    ]
    entries.push({
      stableId: sc.sceneId,
      revisionId: sc.updatedAt,
      assetType: 'scene',
      name: sc.name,
      relativePath: scWritten.relPath,
      metadataPath: null,
      sha256: scWritten.sha256,
      byteSize: scWritten.byteSize,
      dependencies: [...new Set(deps)]
    })
  }

  // 6) Export UI, VFX, Cutscenes, Gameplay (Dialogue, Quest, StateFlags, DataTables)
  for (const ui of scope.uiScreens) {
    const w = writeStageFile(`ui/${slugifyAscii(ui.name)}_${ui.screenId}.ui.json`, JSON.stringify(ui, null, 2))
    entries.push({
      stableId: ui.screenId,
      revisionId: ui.updatedAt,
      assetType: 'ui_screen',
      name: ui.name,
      relativePath: w.relPath,
      metadataPath: null,
      sha256: w.sha256,
      byteSize: w.byteSize,
      dependencies: []
    })
  }
  for (const vfx of scope.vfxConfigs) {
    const w = writeStageFile(`vfx/${slugifyAscii(vfx.name)}_${vfx.vfxId}.vfx.json`, JSON.stringify(vfx, null, 2))
    entries.push({
      stableId: vfx.vfxId,
      revisionId: vfx.updatedAt,
      assetType: 'vfx',
      name: vfx.name,
      relativePath: w.relPath,
      metadataPath: null,
      sha256: w.sha256,
      byteSize: w.byteSize,
      dependencies: [vfx.clipId]
    })
  }
  for (const cut of scope.cutscenes) {
    const w = writeStageFile(
      `cutscenes/${slugifyAscii(cut.name)}_${cut.cutsceneId}.cutscene.json`,
      JSON.stringify(cut, null, 2)
    )
    entries.push({
      stableId: cut.cutsceneId,
      revisionId: cut.updatedAt,
      assetType: 'cutscene',
      name: cut.name,
      relativePath: w.relPath,
      metadataPath: null,
      sha256: w.sha256,
      byteSize: w.byteSize,
      dependencies: []
    })
  }

  if (
    scope.dialogues.length > 0 ||
    scope.quests.length > 0 ||
    scope.stateFlags.length > 0 ||
    scope.dataTables.length > 0
  ) {
    const gameplayBundle = redactDeep(
      {
        stableId: `gameplay_${cfg.projectId}`,
        stateFlags: scope.stateFlags,
        dialogues: scope.dialogues,
        quests: scope.quests,
        dataTables: scope.dataTables
      },
      req.extraSecretsToRedact
    )
    const gw = writeStageFile(
      'gameplay/gameplay_data.json',
      JSON.stringify(gameplayBundle, null, 2)
    )
    entries.push({
      stableId: gameplayBundle.stableId,
      revisionId: exportRunId,
      assetType: 'gameplay',
      name: 'Gameplay Data (Dialogues, Quests, Flags, Tables)',
      relativePath: gw.relPath,
      metadataPath: null,
      sha256: gw.sha256,
      byteSize: gw.byteSize,
      dependencies: []
    })
  }

  // 7) Write validation report & manifest.json, then verify integrity before atomic publish!
  writeStageFile('validation_report.json', JSON.stringify(preflight, null, 2))

  const manifest: ExportManifest = redactDeep(
    {
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      minImporterVersion: MIN_IMPORTER_VERSION,
      pinnedUnityVersion: PINNED_UNITY_VERSION,
      exportRunId,
      exportedAt,
      projectId: cfg.projectId,
      projectName: cfg.name,
      pixelsPerUnit: cfg.pixelsPerUnit,
      tileSizePx: cfg.tileSizePx,
      conventions: {
        imageOrigin: 'top-left',
        unitySpriteRectOrigin: 'bottom-left',
        unityPivotOrigin: 'bottom-left-normalized',
        tilemapMapping: 'y_flipped_rows_minus_1_minus_row',
        durationUnit: 'milliseconds',
        textureFilter: 'Point',
        textureCompression: 'Uncompressed'
      },
      scope: {
        kind: req.scopeKind,
        rootIds: req.rootIds
      },
      entries
    },
    req.extraSecretsToRedact
  )

  const manifestCheckIssues = validateManifestObject(manifest, actualChecksums)
  const manifestErrors = manifestCheckIssues.filter((i) => i.severity === 'error')
  if (manifestErrors.length > 0) {
    throw new Error(
      `Manifest tự kiểm chứng thất bại: ${manifestErrors.map((e) => e.message).join(' | ')}`
    )
  }

  writeStageFile('manifest.json', JSON.stringify(manifest, null, 2))

  // Atomic publish from staging -> targetDir
  const absTarget = path.resolve(req.targetDir)
  fs.mkdirSync(absTarget, { recursive: true })
  const copyDir = (src: string, dst: string) => {
    fs.mkdirSync(dst, { recursive: true })
    for (const item of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, item.name)
      const d = path.join(dst, item.name)
      if (item.isDirectory()) copyDir(s, d)
      else fs.copyFileSync(s, d)
    }
  }
  copyDir(stageDir, absTarget)
  fs.rmSync(stageDir, { recursive: true, force: true })

  store.saveExportRun({
    exportRunId,
    exportedAt,
    scopeKind: req.scopeKind,
    rootIds: req.rootIds,
    targetDir: absTarget,
    entryCount: entries.length,
    errorCount: preflight.errorCount,
    warningCount: preflight.warningCount
  })

  return {
    exportRunId,
    targetDir: absTarget,
    manifestPath: path.join(absTarget, 'manifest.json'),
    manifest,
    preflight,
    filesWritten: actualChecksums.size
  }
}

export function verifyExportDirectory(exportDir: string): {
  valid: boolean
  manifest: ExportManifest | null
  issues: ValidationIssue[]
} {
  const manifestPath = path.join(exportDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    return {
      valid: false,
      manifest: null,
      issues: [
        {
          code: 'MANIFEST_NOT_FOUND',
          severity: 'error',
          targetId: null,
          targetType: 'manifest',
          message: `Không tìm thấy manifest.json tại "${exportDir}".`
        }
      ]
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    return {
      valid: false,
      manifest: null,
      issues: [
        {
          code: 'MANIFEST_PARSE_ERROR',
          severity: 'error',
          targetId: null,
          targetType: 'manifest',
          message: `Lỗi đọc JSON manifest: ${err instanceof Error ? err.message : String(err)}`
        }
      ]
    }
  }

  const checksums = new Map<string, string>()
  const walk = (cur: string) => {
    for (const item of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, item.name)
      if (item.isDirectory()) walk(full)
      else {
        const rel = path.relative(exportDir, full).replace(/\\/g, '/')
        checksums.set(rel, computeSha256(fs.readFileSync(full)))
      }
    }
  }
  walk(exportDir)

  const issues = validateManifestObject(raw, checksums)
  const valid = issues.every((i) => i.severity !== 'error')
  return { valid, manifest: valid ? (raw as ExportManifest) : null, issues }
}
