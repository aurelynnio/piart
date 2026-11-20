import fs from 'node:fs'
import path from 'node:path'
import { ProjectStore, makeId } from '../app/main/db/projectStore'
import {
  encodePng,
  renderProceduralSprite,
  WORKSHOP_PALETTE_HEX
} from '../app/main/imaging/pixelEngine'
import { exportUnityPackage } from '../app/main/exporter/unityExporter'
import type {
  Asset,
  Clip,
  Cutscene,
  DataTable,
  DialogueGraph,
  Direction,
  Folder,
  Quest,
  Scene,
  StateFlag,
  TileSet,
  UIScreen,
  VFXConfig
} from '../domain/schemas/types'

async function seedWorkshop() {
  const workshopDir = path.resolve(process.cwd(), 'examples', 'workshop')
  const sampleExportDir = path.resolve(process.cwd(), 'examples', 'workshop-export')

  fs.rmSync(workshopDir, { recursive: true, force: true })
  fs.rmSync(sampleExportDir, { recursive: true, force: true })

  const store = await ProjectStore.create({
    name: 'Xưởng mộc — Dự án mẫu',
    rootDir: workshopDir,
    tileSizePx: 32,
    pixelsPerUnit: 32,
    defaultCanvasPx: { w: 32, h: 48 },
    defaultPerspective: '3/4'
  })

  const now = new Date().toISOString()

  // Folders
  const folders: Folder[] = [
    { id: 'fld_chars', name: 'Nhân vật', parentId: null, kind: 'folder', createdAt: now },
    { id: 'fld_furn', name: 'Nội thất & Vật phẩm', parentId: null, kind: 'folder', createdAt: now },
    { id: 'fld_world', name: 'Tileset & Bản đồ', parentId: null, kind: 'folder', createdAt: now },
    { id: 'fld_ui', name: 'UI, VFX & Cutscene', parentId: null, kind: 'folder', createdAt: now },
    { id: 'fld_story', name: 'Hội thoại & Nhiệm vụ', parentId: null, kind: 'folder', createdAt: now }
  ]
  for (const f of folders) store.upsertEntity('folder', f.id, f)

  // Helper to create approved sprite asset + revision
  const addSpriteAsset = (params: {
    assetId: string
    name: string
    slug: string
    type: Asset['type']
    folderId: string
    tags: string[]
    png: Buffer
    w: number
    h: number
    pivotX: number
    pivotY: number
    footprint?: { w: number; h: number } | null
    nineSlice?: { left: number; top: number; right: number; bottom: number } | null
    parentAssetId?: string | null
    attachmentPoints?: Array<{ id: string; name: string; kind: any; x: number; y: number }>
  }) => {
    const saved = store.saveBlobAtomic(params.png)
    const revId = `rev_${params.assetId}_approved`
    store.saveRevision({
      revisionId: revId,
      assetId: params.assetId,
      parentRevisionId: null,
      baseRevisionId: null,
      status: 'approved',
      staleConflict: false,
      rawBlobHash: saved.sha256,
      normalizedBlobHash: saved.sha256,
      maskBlobHash: null,
      canvasPx: { w: params.w, h: params.h },
      pivotPx: { x: params.pivotX, y: params.pivotY },
      footprintTiles: params.footprint ?? null,
      collisionBox: null,
      nineSlice: params.nineSlice ?? null,
      layers: [
        {
          id: `lyr_${params.assetId}`,
          name: 'Nền chính',
          visible: true,
          locked: false,
          opacity: 1,
          blobHash: saved.sha256,
          order: 0
        }
      ],
      attachmentPoints: params.attachmentPoints ?? [],
      variantGroupId: null,
      direction: 'down',
      stateName: 'normal',
      settingsSnapshot: { palette: WORKSHOP_PALETTE_HEX },
      dependencyIds: [],
      operationSummary: 'Tạo tài nguyên mẫu nguyên gốc',
      createdAt: now
    })
    store.upsertEntity<Asset>('asset', params.assetId, {
      assetId: params.assetId,
      name: params.name,
      slug: params.slug,
      type: params.type,
      description: `Tài nguyên mẫu nguyên gốc cho ${params.name}`,
      folderId: params.folderId,
      collectionIds: [],
      tags: params.tags,
      parentAssetId: params.parentAssetId ?? null,
      approvedRevisionId: revId,
      latestRevisionId: revId,
      metadata: {},
      trashedAt: null,
      createdAt: now,
      updatedAt: now
    })
    return { revId, blobHash: saved.sha256 }
  }

  // 1) Hero NPC: Thợ mộc (32x48) + Portrait + Outfit + 4-dir walk & idle clips
  const carpBase = addSpriteAsset({
    assetId: 'character_carpenter',
    name: 'Thợ mộc',
    slug: 'carpenter',
    type: 'character',
    folderId: 'fld_chars',
    tags: ['npc', 'carpenter', 'workshop'],
    png: encodePng(renderProceduralSprite({ kind: 'character', width: 32, height: 48, direction: 'down', frameIndex: 0 })),
    w: 32,
    h: 48,
    pivotX: 16,
    pivotY: 46,
    attachmentPoints: [{ id: 'ap_hand', name: 'hand_hold', kind: 'hand_hold', x: 7, y: 26 }]
  })

  addSpriteAsset({
    assetId: 'portrait_carpenter',
    name: 'Chân dung Thợ mộc',
    slug: 'carpenter_portrait',
    type: 'portrait',
    folderId: 'fld_chars',
    tags: ['portrait', 'npc'],
    png: encodePng(renderProceduralSprite({ kind: 'portrait', width: 64, height: 64 })),
    w: 64,
    h: 64,
    pivotX: 32,
    pivotY: 32,
    parentAssetId: 'character_carpenter'
  })

  addSpriteAsset({
    assetId: 'outfit_apron',
    name: 'Tạp dề thợ mộc',
    slug: 'carpenter_apron',
    type: 'outfit',
    folderId: 'fld_chars',
    tags: ['outfit'],
    png: encodePng(renderProceduralSprite({ kind: 'outfit', width: 32, height: 48 })),
    w: 32,
    h: 48,
    pivotX: 16,
    pivotY: 46,
    parentAssetId: 'character_carpenter'
  })

  const dirs: Direction[] = ['down', 'left', 'right', 'up']
  for (const dir of dirs) {
    // Walk clip: 6 frames, 8 FPS (125 ms)
    const walkFrames = []
    for (let i = 0; i < 6; i++) {
      const buf = encodePng(
        renderProceduralSprite({ kind: 'character', width: 32, height: 48, direction: dir, frameIndex: i, totalFrames: 6 })
      )
      const saved = store.saveBlobAtomic(buf)
      const revId = `rev_carp_walk_${dir}_${i}`
      store.saveRevision({
        revisionId: revId,
        assetId: 'character_carpenter',
        parentRevisionId: carpBase.revId,
        baseRevisionId: carpBase.revId,
        status: 'approved',
        staleConflict: false,
        rawBlobHash: saved.sha256,
        normalizedBlobHash: saved.sha256,
        maskBlobHash: null,
        canvasPx: { w: 32, h: 48 },
        pivotPx: { x: 16, y: 46 },
        footprintTiles: null,
        collisionBox: null,
        nineSlice: null,
        layers: [],
        attachmentPoints: [],
        variantGroupId: null,
        direction: dir,
        stateName: null,
        settingsSnapshot: { action: 'walk', dir, frameIndex: i },
        dependencyIds: [carpBase.revId],
        operationSummary: `Walk ${dir} #${i + 1}`,
        createdAt: now
      })
      walkFrames.push({
        frameId: `frm_carp_walk_${dir}_${i}`,
        slotIndex: i,
        revisionId: revId,
        blobHash: saved.sha256,
        sourceRect: null,
        durationMs: 125,
        offsetPx: { x: 0, y: 0 },
        isLocked: false,
        isIntentionalHold: false,
        qcWarnings: []
      })
    }

    const walkClip: Clip = {
      clipId: `clip_carpenter_walk_${dir}`,
      assetId: 'character_carpenter',
      name: `Thợ mộc — walk (${dir})`,
      action: 'walk',
      direction: dir,
      fps: 8,
      loopMode: 'loop',
      playbackSpeed: 1,
      canvasPx: { w: 32, h: 48 },
      anchorPx: { x: 16, y: 46 },
      frames: walkFrames,
      events: [
        { eventId: `evt_step_l_${dir}`, name: 'footstep_left', frameId: walkFrames[1].frameId, timeMs: 125, payload: { surface: 'wood' } },
        { eventId: `evt_step_r_${dir}`, name: 'footstep_right', frameId: walkFrames[4].frameId, timeMs: 500, payload: { surface: 'wood' } }
      ],
      status: 'approved',
      createdAt: now,
      updatedAt: now
    }
    store.upsertEntity('clip', walkClip.clipId, walkClip)

    // Idle clip: 2 frames, 4 FPS (250 ms)
    const idleFrames = [0, 1].map((i) => {
      const buf = encodePng(
        renderProceduralSprite({ kind: 'character', width: 32, height: 48, direction: dir, frameIndex: i === 0 ? 0 : 3, totalFrames: 6 })
      )
      const saved = store.saveBlobAtomic(buf)
      const revId = `rev_carp_idle_${dir}_${i}`
      store.saveRevision({
        revisionId: revId,
        assetId: 'character_carpenter',
        parentRevisionId: carpBase.revId,
        baseRevisionId: carpBase.revId,
        status: 'approved',
        staleConflict: false,
        rawBlobHash: saved.sha256,
        normalizedBlobHash: saved.sha256,
        maskBlobHash: null,
        canvasPx: { w: 32, h: 48 },
        pivotPx: { x: 16, y: 46 },
        footprintTiles: null,
        collisionBox: null,
        nineSlice: null,
        layers: [],
        attachmentPoints: [],
        variantGroupId: null,
        direction: dir,
        stateName: null,
        settingsSnapshot: { action: 'idle', dir, frameIndex: i },
        dependencyIds: [carpBase.revId],
        operationSummary: `Idle ${dir} #${i + 1}`,
        createdAt: now
      })
      return {
        frameId: `frm_carp_idle_${dir}_${i}`,
        slotIndex: i,
        revisionId: revId,
        blobHash: saved.sha256,
        sourceRect: null,
        durationMs: 250,
        offsetPx: { x: 0, y: 0 },
        isLocked: false,
        isIntentionalHold: false,
        qcWarnings: []
      }
    })
    store.upsertEntity<Clip>('clip', `clip_carpenter_idle_${dir}`, {
      clipId: `clip_carpenter_idle_${dir}`,
      assetId: 'character_carpenter',
      name: `Thợ mộc — idle (${dir})`,
      action: 'idle',
      direction: dir,
      fps: 4,
      loopMode: 'loop',
      playbackSpeed: 1,
      canvasPx: { w: 32, h: 48 },
      anchorPx: { x: 16, y: 46 },
      frames: idleFrames,
      events: [],
      status: 'approved',
      createdAt: now,
      updatedAt: now
    })
  }

  // 2) Furniture (Cabinet 2x1 + open/close clips, Table 2x1, Chair 1x1) & Item (Hammer + Icon)
  const cabinetBase = addSpriteAsset({
    assetId: 'furniture_cabinet',
    name: 'Tủ gỗ xưởng mộc',
    slug: 'wooden_cabinet',
    type: 'furniture',
    folderId: 'fld_furn',
    tags: ['furniture', 'interactive'],
    png: encodePng(renderProceduralSprite({ kind: 'furniture_cabinet', width: 64, height: 48, frameIndex: 0, totalFrames: 6 })),
    w: 64,
    h: 48,
    pivotX: 32,
    pivotY: 46,
    footprint: { w: 2, h: 1 },
    attachmentPoints: [{ id: 'ap_handle', name: 'door_handle', kind: 'door_handle', x: 30, y: 28 }]
  })

  const cabOpenFrames = []
  for (let i = 0; i < 6; i++) {
    const saved = store.saveBlobAtomic(
      encodePng(renderProceduralSprite({ kind: 'furniture_cabinet', width: 64, height: 48, frameIndex: i, totalFrames: 6 }))
    )
    const revId = `rev_cab_open_${i}`
    store.saveRevision({
      revisionId: revId,
      assetId: 'furniture_cabinet',
      parentRevisionId: cabinetBase.revId,
      baseRevisionId: cabinetBase.revId,
      status: 'approved',
      staleConflict: false,
      rawBlobHash: saved.sha256,
      normalizedBlobHash: saved.sha256,
      maskBlobHash: null,
      canvasPx: { w: 64, h: 48 },
      pivotPx: { x: 32, y: 46 },
      footprintTiles: { w: 2, h: 1 },
      collisionBox: null,
      nineSlice: null,
      layers: [],
      attachmentPoints: [],
      variantGroupId: null,
      direction: 'down',
      stateName: i === 5 ? 'open' : 'closed',
      settingsSnapshot: {},
      dependencyIds: [cabinetBase.revId],
      operationSummary: `Mở tủ #${i + 1}`,
      createdAt: now
    })
    cabOpenFrames.push({
      frameId: `frm_cab_open_${i}`,
      slotIndex: i,
      revisionId: revId,
      blobHash: saved.sha256,
      sourceRect: null,
      durationMs: 100,
      offsetPx: { x: 0, y: 0 },
      isLocked: false,
      isIntentionalHold: false,
      qcWarnings: []
    })
  }
  store.upsertEntity<Clip>('clip', 'clip_cabinet_open', {
    clipId: 'clip_cabinet_open',
    assetId: 'furniture_cabinet',
    name: 'Tủ gỗ — open (down)',
    action: 'open',
    direction: 'down',
    fps: 10,
    loopMode: 'once',
    playbackSpeed: 1,
    canvasPx: { w: 64, h: 48 },
    anchorPx: { x: 32, y: 46 },
    frames: cabOpenFrames,
    events: [{ eventId: 'evt_cab_open', name: 'sfx_cabinet_open', frameId: cabOpenFrames[5].frameId, timeMs: 500, payload: {} }],
    status: 'approved',
    createdAt: now,
    updatedAt: now
  })

  addSpriteAsset({
    assetId: 'furniture_table',
    name: 'Bàn thợ mộc',
    slug: 'workbench_table',
    type: 'furniture',
    folderId: 'fld_furn',
    tags: ['furniture'],
    png: encodePng(renderProceduralSprite({ kind: 'furniture_table', width: 64, height: 48 })),
    w: 64,
    h: 48,
    pivotX: 32,
    pivotY: 46,
    footprint: { w: 2, h: 1 }
  })

  addSpriteAsset({
    assetId: 'furniture_chair',
    name: 'Ghế gỗ',
    slug: 'wooden_chair',
    type: 'furniture',
    folderId: 'fld_furn',
    tags: ['furniture'],
    png: encodePng(renderProceduralSprite({ kind: 'furniture_chair', width: 32, height: 32 })),
    w: 32,
    h: 32,
    pivotX: 16,
    pivotY: 30,
    footprint: { w: 1, h: 1 }
  })

  addSpriteAsset({
    assetId: 'item_hammer',
    name: 'Búa thợ mộc',
    slug: 'carpenter_hammer',
    type: 'item',
    folderId: 'fld_furn',
    tags: ['item', 'tool', 'quest_item'],
    png: encodePng(renderProceduralSprite({ kind: 'item_hammer', width: 32, height: 32 })),
    w: 32,
    h: 32,
    pivotX: 16,
    pivotY: 16
  })

  addSpriteAsset({
    assetId: 'icon_hammer',
    name: 'Icon Búa (Túi đồ)',
    slug: 'hammer_icon',
    type: 'icon',
    folderId: 'fld_furn',
    tags: ['icon', 'inventory'],
    png: encodePng(renderProceduralSprite({ kind: 'icon_hammer', width: 16, height: 16 })),
    w: 16,
    h: 16,
    pivotX: 8,
    pivotY: 8,
    parentAssetId: 'item_hammer'
  })

  // 3) Tileset (32x32) + AutoTile Rules
  const tileFloor = store.saveBlobAtomic(encodePng(renderProceduralSprite({ kind: 'tile_wood_floor', width: 32, height: 32 })))
  const tileWall = store.saveBlobAtomic(encodePng(renderProceduralSprite({ kind: 'tile_wall', width: 32, height: 32 })))
  const tileDirt = store.saveBlobAtomic(encodePng(renderProceduralSprite({ kind: 'tile_dirt', width: 32, height: 32 })))
  const tileBorder = store.saveBlobAtomic(encodePng(renderProceduralSprite({ kind: 'tile_border', width: 32, height: 32 })))

  const tileset: TileSet = {
    tilesetId: 'tileset_workshop',
    assetId: 'asset_tileset_workshop',
    name: 'Tileset Xưởng mộc 32×32',
    tileSizePx: 32,
    paddingPx: 2,
    tiles: [
      { tileId: 'tile_floor_wood', name: 'Sàn gỗ sồi', blobHash: tileFloor.sha256, terrainTag: 'wood', walkable: true, collisionShape: 'none', customCollisionRect: null, isOverlay: false },
      { tileId: 'tile_wall_wood', name: 'Tường gỗ', blobHash: tileWall.sha256, terrainTag: 'wall', walkable: false, collisionShape: 'full', customCollisionRect: null, isOverlay: false },
      { tileId: 'tile_dirt_path', name: 'Đất lối vào', blobHash: tileDirt.sha256, terrainTag: 'dirt', walkable: true, collisionShape: 'none', customCollisionRect: null, isOverlay: false },
      { tileId: 'tile_border_wall', name: 'Viền giao tường', blobHash: tileBorder.sha256, terrainTag: 'wood', walkable: true, collisionShape: 'none', customCollisionRect: null, isOverlay: false }
    ],
    autoTileRules: [
      { ruleId: 'rule_north_edge', name: 'Sàn giáp tường phía bắc', mode: '4-bit', terrainTag: 'wood', bitmask: 14, tileId: 'tile_border_wall', priority: 10 }
    ],
    createdAt: now,
    updatedAt: now
  }
  store.upsertEntity('tileset', tileset.tilesetId, tileset)
  store.upsertEntity<Asset>('asset', 'asset_tileset_workshop', {
    assetId: 'asset_tileset_workshop',
    name: tileset.name,
    slug: 'tileset_workshop',
    type: 'tileset',
    description: 'Tileset sàn gỗ, tường và viền nối 32×32',
    folderId: 'fld_world',
    collectionIds: [],
    tags: ['tileset'],
    parentAssetId: null,
    approvedRevisionId: null,
    latestRevisionId: null,
    metadata: { tilesetId: tileset.tilesetId },
    trashedAt: null,
    createdAt: now,
    updatedAt: now
  })

  // 4) UI 9-slice Box + Buttons + UI Screen + VFX + Cutscene
  addSpriteAsset({
    assetId: 'ui_dialogue_box',
    name: 'Khung thoại 9-slice',
    slug: 'ui_dialogue_box',
    type: 'ui_element',
    folderId: 'fld_ui',
    tags: ['ui', '9-slice'],
    png: encodePng(renderProceduralSprite({ kind: 'ui_box', width: 48, height: 48 })),
    w: 48,
    h: 48,
    pivotX: 24,
    pivotY: 24,
    nineSlice: { left: 8, top: 8, right: 8, bottom: 8 }
  })
  addSpriteAsset({
    assetId: 'ui_btn_normal',
    name: 'Nút UI (Bình thường)',
    slug: 'ui_btn_normal',
    type: 'ui_element',
    folderId: 'fld_ui',
    tags: ['ui', 'button'],
    png: encodePng(renderProceduralSprite({ kind: 'ui_button', width: 48, height: 20, stateName: 'normal' })),
    w: 48,
    h: 20,
    pivotX: 24,
    pivotY: 10,
    nineSlice: { left: 6, top: 6, right: 6, bottom: 6 }
  })
  addSpriteAsset({
    assetId: 'ui_btn_pressed',
    name: 'Nút UI (Nhấn)',
    slug: 'ui_btn_pressed',
    type: 'ui_element',
    folderId: 'fld_ui',
    tags: ['ui', 'button'],
    png: encodePng(renderProceduralSprite({ kind: 'ui_button', width: 48, height: 20, stateName: 'pressed' })),
    w: 48,
    h: 20,
    pivotX: 24,
    pivotY: 10,
    nineSlice: { left: 6, top: 6, right: 6, bottom: 6 }
  })
  addSpriteAsset({
    assetId: 'ui_btn_disabled',
    name: 'Nút UI (Vô hiệu hóa)',
    slug: 'ui_btn_disabled',
    type: 'ui_element',
    folderId: 'fld_ui',
    tags: ['ui', 'button'],
    png: encodePng(renderProceduralSprite({ kind: 'ui_button', width: 48, height: 20, stateName: 'disabled' })),
    w: 48,
    h: 20,
    pivotX: 24,
    pivotY: 10,
    nineSlice: { left: 6, top: 6, right: 6, bottom: 6 }
  })

  const uiScreen: UIScreen = {
    screenId: 'ui_screen_workshop_hud',
    assetId: 'asset_ui_screen_hud',
    name: 'Màn hình HUD Xưởng mộc',
    resolutionPx: { w: 480, h: 270 },
    elements: [
      {
        elementId: 'uie_dialogue',
        name: 'Khung thoại chính',
        kind: 'dialogue_box',
        x: 24,
        y: 186,
        w: 432,
        h: 72,
        anchor: 'bottom-center',
        nineSlice: { left: 8, top: 8, right: 8, bottom: 8 },
        states: { normalAssetId: 'ui_dialogue_box', pressedAssetId: null, disabledAssetId: null, hoverAssetId: null },
        text: 'Thợ mộc: Bạn đã tìm thấy cây búa giúp tôi chưa?'
      },
      {
        elementId: 'uie_confirm_btn',
        name: 'Nút Xác nhận',
        kind: 'button',
        x: 368,
        y: 230,
        w: 76,
        h: 22,
        anchor: 'bottom-right',
        nineSlice: { left: 6, top: 6, right: 6, bottom: 6 },
        states: { normalAssetId: 'ui_btn_normal', pressedAssetId: 'ui_btn_pressed', disabledAssetId: 'ui_btn_disabled', hoverAssetId: null },
        text: 'Giao búa'
      }
    ],
    createdAt: now,
    updatedAt: now
  }
  store.upsertEntity('ui_screen', uiScreen.screenId, uiScreen)
  store.upsertEntity<Asset>('asset', uiScreen.assetId, {
    assetId: uiScreen.assetId,
    name: uiScreen.name,
    slug: 'ui_screen_workshop_hud',
    type: 'ui_screen',
    description: 'Bố cục màn hình HUD & khung thoại 480×270',
    folderId: 'fld_ui',
    collectionIds: [],
    tags: ['ui'],
    parentAssetId: null,
    approvedRevisionId: null,
    latestRevisionId: null,
    metadata: { screenId: uiScreen.screenId },
    trashedAt: null,
    createdAt: now,
    updatedAt: now
  })

  // VFX Sawdust Clip (6 frames)
  const vfxFrames = []
  for (let i = 0; i < 6; i++) {
    const saved = store.saveBlobAtomic(
      encodePng(renderProceduralSprite({ kind: 'vfx_dust', width: 24, height: 24, frameIndex: i, totalFrames: 6 }))
    )
    const revId = `rev_vfx_sawdust_${i}`
    store.saveRevision({
      revisionId: revId,
      assetId: 'vfx_sawdust',
      parentRevisionId: null,
      baseRevisionId: null,
      status: 'approved',
      staleConflict: false,
      rawBlobHash: saved.sha256,
      normalizedBlobHash: saved.sha256,
      maskBlobHash: null,
      canvasPx: { w: 24, h: 24 },
      pivotPx: { x: 12, y: 12 },
      footprintTiles: null,
      collisionBox: null,
      nineSlice: null,
      layers: [],
      attachmentPoints: [],
      variantGroupId: null,
      direction: 'down',
      stateName: null,
      settingsSnapshot: {},
      dependencyIds: [],
      operationSummary: `VFX Bụi mùn cưa #${i + 1}`,
      createdAt: now
    })
    vfxFrames.push({
      frameId: `frm_vfx_dust_${i}`,
      slotIndex: i,
      revisionId: revId,
      blobHash: saved.sha256,
      sourceRect: null,
      durationMs: 80,
      offsetPx: { x: 0, y: 0 },
      isLocked: false,
      isIntentionalHold: false,
      qcWarnings: []
    })
  }
  store.upsertEntity<Asset>('asset', 'vfx_sawdust', {
    assetId: 'vfx_sawdust',
    name: 'VFX Bụi mùn cưa',
    slug: 'vfx_sawdust',
    type: 'vfx',
    description: 'Hiệu ứng bụi mùn cưa khi đẽo gỗ',
    folderId: 'fld_ui',
    collectionIds: [],
    tags: ['vfx'],
    parentAssetId: null,
    approvedRevisionId: 'rev_vfx_sawdust_0',
    latestRevisionId: 'rev_vfx_sawdust_0',
    metadata: {},
    trashedAt: null,
    createdAt: now,
    updatedAt: now
  })
  store.upsertEntity<Clip>('clip', 'clip_vfx_sawdust', {
    clipId: 'clip_vfx_sawdust',
    assetId: 'vfx_sawdust',
    name: 'VFX Bụi mùn cưa (6 frame)',
    action: 'emit',
    direction: 'down',
    fps: 12,
    loopMode: 'loop',
    playbackSpeed: 1,
    canvasPx: { w: 24, h: 24 },
    anchorPx: { x: 12, y: 12 },
    frames: vfxFrames,
    events: [],
    status: 'approved',
    createdAt: now,
    updatedAt: now
  })
  store.upsertEntity<VFXConfig>('vfx', 'vfx_cfg_sawdust', {
    vfxId: 'vfx_cfg_sawdust',
    assetId: 'vfx_sawdust',
    clipId: 'clip_vfx_sawdust',
    name: 'Hiệu ứng mùn cưa trên bàn mộc',
    emitterOffsetPx: { x: 0, y: -6 },
    previewTargetType: 'asset',
    previewTargetId: 'furniture_table',
    blendMode: 'normal',
    playbackSpeed: 1,
    loopMode: 'loop',
    createdAt: now,
    updatedAt: now
  })

  // 5) StateFlag, Dialogue, Quest, DataTable
  const flags: StateFlag[] = [
    { flagId: 'flg_hammer_done', key: 'quest_hammer_done', type: 'bool', defaultValue: false, description: 'Hoàn thành nhiệm vụ giao búa cho thợ mộc' },
    { flagId: 'flg_wood_rep', key: 'carpenter_reputation', type: 'int', defaultValue: 0, description: 'Điểm thân thiện với thợ mộc' }
  ]
  for (const fl of flags) store.upsertEntity('state_flag', fl.flagId, fl)

  const dialogue: DialogueGraph = {
    dialogueId: 'dialogue_carpenter_hammer',
    assetId: 'asset_dialogue_hammer',
    name: 'Hội thoại giao búa cho Thợ mộc',
    npcAssetId: 'character_carpenter',
    startNodeId: 'n_greet',
    nodes: [
      { nodeId: 'n_greet', kind: 'dialogue', speakerAssetId: 'character_carpenter', speakerName: 'Thợ mộc', text: 'Chào bạn! Tôi đang làm dở chiếc tủ gỗ mà lại để quên cây búa. Bạn có mang búa theo không?', condition: null, effects: [{ kind: 'start_quest', key: 'quest_deliver_hammer', value: true }], position: { x: 40, y: 80 } },
      { nodeId: 'n_no_hammer', kind: 'dialogue', speakerAssetId: 'character_carpenter', speakerName: 'Thợ mộc', text: 'Chưa có à? Không sao, hãy kiểm tra quanh xưởng rồi mang búa lại cho tôi nhé!', condition: null, effects: [], position: { x: 320, y: 20 } },
      { nodeId: 'n_give_hammer', kind: 'dialogue', speakerAssetId: 'character_carpenter', speakerName: 'Thợ mộc', text: 'Đúng cây búa này rồi! Cảm ơn bạn nhiều, đây là phần thưởng gỗ và tiền công của bạn.', condition: null, effects: [{ kind: 'take_item', key: 'item_hammer', value: 1 }, { kind: 'give_item', key: 'gold_coin', value: 50 }, { kind: 'set_flag', key: 'quest_hammer_done', value: true }, { kind: 'complete_quest', key: 'quest_deliver_hammer', value: true }], position: { x: 320, y: 150 } },
      { nodeId: 'n_end', kind: 'end', speakerAssetId: null, speakerName: '', text: '', condition: null, effects: [], position: { x: 600, y: 85 } }
    ],
    edges: [
      { edgeId: 'e_has', fromNodeId: 'n_greet', toNodeId: 'n_give_hammer', label: 'Giao cây búa', condition: { kind: 'has_item', key: 'item_hammer', value: 1 } },
      { edgeId: 'e_missing', fromNodeId: 'n_greet', toNodeId: 'n_no_hammer', label: 'Tôi chưa tìm thấy búa', condition: null },
      { edgeId: 'e_end1', fromNodeId: 'n_no_hammer', toNodeId: 'n_end', label: 'Rời đi', condition: null },
      { edgeId: 'e_end2', fromNodeId: 'n_give_hammer', toNodeId: 'n_end', label: 'Nhận thưởng', condition: null }
    ],
    createdAt: now,
    updatedAt: now
  }
  store.upsertEntity('dialogue', dialogue.dialogueId, dialogue)
  store.upsertEntity<Asset>('asset', dialogue.assetId, {
    assetId: dialogue.assetId,
    name: dialogue.name,
    slug: 'dialogue_carpenter_hammer',
    type: 'dialogue',
    description: 'Nhánh hội thoại thiếu búa và đủ búa gắn với NPC Thợ mộc',
    folderId: 'fld_story',
    collectionIds: [],
    tags: ['dialogue', 'workshop'],
    parentAssetId: 'character_carpenter',
    approvedRevisionId: null,
    latestRevisionId: null,
    metadata: { dialogueId: dialogue.dialogueId },
    trashedAt: null,
    createdAt: now,
    updatedAt: now
  })

  const quest: Quest = {
    questId: 'quest_deliver_hammer',
    assetId: 'asset_quest_hammer',
    name: 'Giao búa cho Thợ mộc',
    description: 'Tìm cây búa thợ mộc và giao lại cho NPC Thợ mộc trong xưởng.',
    giverNpcAssetId: 'character_carpenter',
    prerequisiteQuestId: null,
    startConditions: [],
    objectives: [
      { objectiveId: 'obj_bring_hammer', description: 'Sở hữu Búa thợ mộc và giao cho Thợ mộc', condition: { kind: 'has_item', key: 'item_hammer', value: 1 } }
    ],
    rewards: [{ itemAssetId: 'item_hammer', itemKey: 'gold_coin', quantity: 50 }],
    completionFlagKey: 'quest_hammer_done',
    completionEffects: [
      { kind: 'set_flag', key: 'quest_hammer_done', value: true },
      { kind: 'give_item', key: 'gold_coin', value: 50 }
    ],
    createdAt: now,
    updatedAt: now
  }
  store.upsertEntity('quest', quest.questId, quest)
  store.upsertEntity<Asset>('asset', quest.assetId, {
    assetId: quest.assetId,
    name: quest.name,
    slug: 'quest_deliver_hammer',
    type: 'quest',
    description: quest.description,
    folderId: 'fld_story',
    collectionIds: [],
    tags: ['quest'],
    parentAssetId: 'character_carpenter',
    approvedRevisionId: null,
    latestRevisionId: null,
    metadata: { questId: quest.questId },
    trashedAt: null,
    createdAt: now,
    updatedAt: now
  })

  const dataTable: DataTable = {
    tableId: 'table_workshop_items',
    assetId: 'asset_table_items',
    name: 'Bảng chỉ số vật phẩm Xưởng mộc',
    columns: [
      { colId: 'c_key', name: 'item_key', type: 'string', required: true },
      { colId: 'c_name', name: 'ten_vat_pham', type: 'string', required: true },
      { colId: 'c_price', name: 'gia_ban', type: 'int', required: true, min: 0, max: 10000 },
      { colId: 'c_dur', name: 'do_ben', type: 'int', required: true, min: 1, max: 100 },
      { colId: 'c_rarity', name: 'do_hiem', type: 'enum', required: true, enumValues: ['thuong', 'tot', 'hiem'] },
      { colId: 'c_asset', name: 'asset_id', type: 'asset_ref', required: false }
    ],
    rows: [
      { item_key: 'item_hammer', ten_vat_pham: 'Búa thợ mộc', gia_ban: 120, do_ben: 80, do_hiem: 'tot', asset_id: 'item_hammer' },
      { item_key: 'wooden_cabinet', ten_vat_pham: 'Tủ gỗ 2 ô', gia_ban: 350, do_ben: 100, do_hiem: 'hiem', asset_id: 'furniture_cabinet' }
    ],
    createdAt: now,
    updatedAt: now
  }
  store.upsertEntity('data_table', dataTable.tableId, dataTable)
  store.upsertEntity<Asset>('asset', dataTable.assetId, {
    assetId: dataTable.assetId,
    name: dataTable.name,
    slug: 'table_workshop_items',
    type: 'data_table',
    description: 'Bảng giá và độ bền vật phẩm có kiểm tra kiểu',
    folderId: 'fld_story',
    collectionIds: [],
    tags: ['table', 'gameplay'],
    parentAssetId: null,
    approvedRevisionId: null,
    latestRevisionId: null,
    metadata: { tableId: dataTable.tableId },
    trashedAt: null,
    createdAt: now,
    updatedAt: now
  })

  // 6) Workshop Scene (10x8 tiles) linking everything cleanly
  const groundCells: Record<string, string> = {}
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 10; c++) {
      const isWall = r === 0 || c === 0 || c === 9 || (r === 7 && c !== 4 && c !== 5)
      if (isWall) groundCells[`${c},${r}`] = 'tile_wall_wood'
      else if (r === 7) groundCells[`${c},${r}`] = 'tile_dirt_path'
      else if (r === 1) groundCells[`${c},${r}`] = 'tile_border_wall'
      else groundCells[`${c},${r}`] = 'tile_floor_wood'
    }
  }

  const scene: Scene = {
    sceneId: 'scene_workshop',
    assetId: 'asset_scene_workshop',
    name: 'Xưởng mộc (10×8 ô)',
    cols: 10,
    rows: 8,
    tileSizePx: 32,
    tilesetId: 'tileset_workshop',
    layers: [
      { layerId: 'ml_ground', name: 'Nền (Ground)', kind: 'ground', visible: true, locked: false, opacity: 1, order: 0, cells: groundCells },
      { layerId: 'ml_detail', name: 'Chi tiết (Detail)', kind: 'detail', visible: true, locked: false, opacity: 1, order: 1, cells: {} },
      { layerId: 'ml_object', name: 'Vật thể (Y-Sort)', kind: 'object', visible: true, locked: false, opacity: 1, order: 2, cells: {} },
      { layerId: 'ml_overlay', name: 'Lớp phủ (Overlay)', kind: 'overlay', visible: true, locked: false, opacity: 1, order: 3, cells: {} },
      { layerId: 'ml_collision', name: 'Va chạm (Collision)', kind: 'collision', visible: true, locked: false, opacity: 0.5, order: 4, cells: {} }
    ],
    placements: [
      { placementId: 'plc_cabinet', assetId: 'furniture_cabinet', revisionId: 'rev_furniture_cabinet_approved', name: 'Tủ gỗ xưởng mộc', layerId: 'ml_object', gridX: 2, gridY: 1, offsetPx: { x: 0, y: 0 }, footprint: { w: 2, h: 1 }, facing: 'down', ySortOffset: 0, blocksMovement: true, linkedDialogueId: null, linkedQuestId: null },
      { placementId: 'plc_table', assetId: 'furniture_table', revisionId: 'rev_furniture_table_approved', name: 'Bàn thợ mộc', layerId: 'ml_object', gridX: 6, gridY: 2, offsetPx: { x: 0, y: 0 }, footprint: { w: 2, h: 1 }, facing: 'down', ySortOffset: 0, blocksMovement: true, linkedDialogueId: null, linkedQuestId: null },
      { placementId: 'plc_chair', assetId: 'furniture_chair', revisionId: 'rev_furniture_chair_approved', name: 'Ghế gỗ', layerId: 'ml_object', gridX: 6, gridY: 3, offsetPx: { x: 0, y: 0 }, footprint: { w: 1, h: 1 }, facing: 'up', ySortOffset: 0, blocksMovement: true, linkedDialogueId: null, linkedQuestId: null },
      { placementId: 'plc_carpenter', assetId: 'character_carpenter', revisionId: 'rev_character_carpenter_approved', name: 'Thợ mộc', layerId: 'ml_object', gridX: 4, gridY: 3, offsetPx: { x: 0, y: 0 }, footprint: { w: 1, h: 1 }, facing: 'down', ySortOffset: 0, blocksMovement: true, linkedDialogueId: 'dialogue_carpenter_hammer', linkedQuestId: 'quest_deliver_hammer' }
    ],
    collisionRects: [
      { x: 0, y: 0, w: 320, h: 32 },
      { x: 0, y: 0, w: 32, h: 256 },
      { x: 288, y: 0, w: 32, h: 256 }
    ],
    markers: [
      { markerId: 'mrk_spawn', kind: 'spawn', name: 'Điểm xuất hiện', gridX: 4, gridY: 6, widthTiles: 1, heightTiles: 1, eventName: 'player_spawn', targetSceneId: null, linkedDialogueId: null, linkedQuestId: null },
      { markerId: 'mrk_door', kind: 'door', name: 'Cửa ra vào xưởng', gridX: 4, gridY: 7, widthTiles: 2, heightTiles: 1, eventName: 'door_workshop_exit', targetSceneId: null, linkedDialogueId: null, linkedQuestId: null },
      { markerId: 'mrk_trig_quest', kind: 'trigger', name: 'Vùng hỏi thăm Thợ mộc', gridX: 4, gridY: 4, widthTiles: 1, heightTiles: 1, eventName: 'trigger_carpenter_talk', targetSceneId: null, linkedDialogueId: 'dialogue_carpenter_hammer', linkedQuestId: 'quest_deliver_hammer' }
    ],
    createdAt: now,
    updatedAt: now
  }
  store.upsertEntity('scene', scene.sceneId, scene)
  store.upsertEntity<Asset>('asset', scene.assetId, {
    assetId: scene.assetId,
    name: scene.name,
    slug: 'scene_workshop',
    type: 'map',
    description: 'Bản đồ xưởng mộc 10×8 ô với bàn, ghế, tủ 2 ô, NPC Thợ mộc, va chạm và cửa ra vào phía dưới',
    folderId: 'fld_world',
    collectionIds: [],
    tags: ['map', 'workshop'],
    parentAssetId: null,
    approvedRevisionId: null,
    latestRevisionId: null,
    metadata: { sceneId: scene.sceneId },
    trashedAt: null,
    createdAt: now,
    updatedAt: now
  })

  // 7) Cutscene / Storyboard
  const cutscene: Cutscene = {
    cutsceneId: 'cutscene_workshop_intro',
    assetId: 'asset_cutscene_intro',
    name: 'Cutscene mở đầu Xưởng mộc',
    shots: [
      { shotId: 'shot_1', order: 0, title: 'Cảnh 1 · Cửa xưởng mở ra', durationMs: 2200, sceneId: 'scene_workshop', dialogueId: null, speakerAssetId: 'character_carpenter', referencedAssetIds: ['character_carpenter', 'furniture_cabinet'], dialogueText: 'Ánh nắng sáng rọi vào xưởng mộc mùi gỗ sồi.', cameraNotes: 'Fade-in toàn cảnh 10×8', transitionCue: 'fade_in' },
      { shotId: 'shot_2', order: 1, title: 'Cảnh 2 · Thợ mộc nhờ tìm búa', durationMs: 2800, sceneId: 'scene_workshop', dialogueId: 'dialogue_carpenter_hammer', speakerAssetId: 'character_carpenter', referencedAssetIds: ['character_carpenter', 'item_hammer'], dialogueText: 'Bạn có thấy cây búa của tôi ở đâu không?', cameraNotes: 'Zoom nhẹ về phía Thợ mộc', transitionCue: 'pan' }
    ],
    createdAt: now,
    updatedAt: now
  }
  store.upsertEntity('cutscene', cutscene.cutsceneId, cutscene)
  store.upsertEntity<Asset>('asset', cutscene.assetId, {
    assetId: cutscene.assetId,
    name: cutscene.name,
    slug: 'cutscene_workshop_intro',
    type: 'cutscene',
    description: 'Storyboard 2 cảnh giới thiệu xưởng mộc',
    folderId: 'fld_ui',
    collectionIds: [],
    tags: ['cutscene', 'storyboard'],
    parentAssetId: null,
    approvedRevisionId: null,
    latestRevisionId: null,
    metadata: { cutsceneId: cutscene.cutsceneId },
    trashedAt: null,
    createdAt: now,
    updatedAt: now
  })

  // Also seed a reusable PromptTemplate
  store.upsertEntity('prompt_template', 'tpl_npc_walk_4dir', {
    templateId: 'tpl_npc_walk_4dir',
    name: 'NPC 4 hướng đi bộ chuẩn (32×48, 6 frame, 8 FPS)',
    category: 'content_pack',
    promptText: 'Tạo thợ mộc đeo tạp dề nâu. Cho nhân vật đi bộ, bước chân chắc và nhịp đều.',
    options: { spriteSize: { w: 32, h: 48 }, directionCount: 4, framesPerDirection: 6, fps: 8, loopMode: 'loop' },
    createdAt: now,
    updatedAt: now
  })

  // Export verified sample Unity package right alongside it!
  const exported = exportUnityPackage(store, {
    scopeKind: 'project',
    rootIds: [],
    targetDir: sampleExportDir,
    includeAtlas: true,
    atlasPaddingPx: 2
  })

  const integrity = store.verifyIntegrity()
  store.close()

  console.log(
    JSON.stringify(
      {
        workshopDir,
        sampleExportDir,
        integrity,
        exportedFiles: exported.filesWritten,
        manifestEntries: exported.manifest.entries.length,
        preflightErrors: exported.preflight.errorCount,
        preflightWarnings: exported.preflight.warningCount
      },
      null,
      2
    )
  )
}

seedWorkshop().catch((err) => {
  console.error(err)
  process.exit(1)
})
