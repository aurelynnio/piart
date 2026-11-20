import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectStore } from '@main/db/projectStore'
import { encodePng, renderProceduralSprite } from '@main/imaging/pixelEngine'
import { exportUnityPackage } from '@main/exporter/unityExporter'
import type { Asset, Clip, Scene } from '@domain/schemas/types'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('Performance Benchmark on Representative Large Project', () => {
  it('handles 50 sprites, 20 clips (150+ frames), and 3 maps (up to 64x64) within production SLA', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-perf-'))
    tempDirs.push(tmp)

    const projDir = path.join(tmp, 'large-project')
    const exportDir = path.join(tmp, 'large-export')
    const t0 = Date.now()
    const store = await ProjectStore.create({ name: 'Large Bench', rootDir: projDir })
    const now = new Date().toISOString()

    // 50 Sprites
    const baseBuf = encodePng(renderProceduralSprite({ kind: 'character', width: 32, height: 48 }))
    for (let i = 0; i < 50; i++) {
      const saved = store.saveBlobAtomic(baseBuf)
      const assetId = `spr_${i}`
      const revId = `rev_${i}`
      store.saveRevision({
        revisionId: revId,
        assetId,
        parentRevisionId: null,
        baseRevisionId: null,
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
        direction: 'down',
        stateName: null,
        settingsSnapshot: {},
        dependencyIds: [],
        operationSummary: 'seed',
        createdAt: now
      })
      store.upsertEntity<Asset>('asset', assetId, {
        assetId,
        name: `Sprite ${i}`,
        slug: `sprite_${i}`,
        type: 'character',
        description: '',
        folderId: null,
        collectionIds: [],
        tags: ['bench'],
        parentAssetId: null,
        approvedRevisionId: revId,
        latestRevisionId: revId,
        metadata: {},
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      })
    }

    // 20 Clips x 8 frames = 160 frames
    const frameBuf = encodePng(renderProceduralSprite({ kind: 'character', width: 32, height: 48, frameIndex: 1 }))
    const frameSaved = store.saveBlobAtomic(frameBuf)
    for (let c = 0; c < 20; c++) {
      const frames = Array.from({ length: 8 }).map((_, fi) => ({
        frameId: `f_${c}_${fi}`,
        slotIndex: fi,
        revisionId: `rev_${c}`,
        blobHash: frameSaved.sha256,
        sourceRect: null,
        durationMs: 125,
        offsetPx: { x: 0, y: 0 },
        isLocked: false,
        isIntentionalHold: false,
        qcWarnings: []
      }))
      store.upsertEntity<Clip>('clip', `clip_${c}`, {
        clipId: `clip_${c}`,
        assetId: `spr_${c}`,
        name: `Clip ${c}`,
        action: 'walk',
        direction: 'down',
        fps: 8,
        loopMode: 'loop',
        playbackSpeed: 1,
        canvasPx: { w: 32, h: 48 },
        anchorPx: { x: 16, y: 46 },
        frames,
        events: [],
        status: 'approved',
        createdAt: now,
        updatedAt: now
      })
    }

    // 3 Maps (including 64x64)
    const sizes = [
      [32, 32],
      [48, 48],
      [64, 64]
    ]
    for (let m = 0; m < 3; m++) {
      const [cols, rows] = sizes[m]
      const cells: Record<string, string> = {}
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          cells[`${c},${r}`] = 'tile_0'
        }
      }
      store.upsertEntity<Scene>('scene', `scene_${m}`, {
        sceneId: `scene_${m}`,
        assetId: `map_asset_${m}`,
        name: `Map ${cols}x${rows}`,
        cols,
        rows,
        tileSizePx: 32,
        tilesetId: null,
        layers: [{ layerId: 'l0', name: 'Ground', kind: 'ground', visible: true, locked: false, opacity: 1, order: 0, cells }],
        placements: [],
        collisionRects: [],
        markers: [],
        createdAt: now,
        updatedAt: now
      })
      store.upsertEntity<Asset>('asset', `map_asset_${m}`, {
        assetId: `map_asset_${m}`,
        name: `Map ${cols}x${rows}`,
        slug: `map_${m}`,
        type: 'map',
        description: '',
        folderId: null,
        collectionIds: [],
        tags: [],
        parentAssetId: null,
        approvedRevisionId: null,
        latestRevisionId: null,
        metadata: { sceneId: `scene_${m}` },
        trashedAt: null,
        createdAt: now,
        updatedAt: now
      })
    }

    const seedMs = Date.now() - t0
    const tExport = Date.now()
    const exported = exportUnityPackage(store, {
      scopeKind: 'project',
      rootIds: [],
      targetDir: exportDir,
      includeAtlas: true,
      atlasPaddingPx: 2
    })
    const exportMs = Date.now() - tExport

    const state = store.getFullState()
    store.close()

    expect(state.assets.length).toBe(53)
    expect(state.clips.length).toBe(20)
    expect(state.clips.reduce((acc, c) => acc + c.frames.length, 0)).toBe(160)
    expect(state.scenes.length).toBe(3)
    expect(exported.preflight.errorCount).toBe(0)
    expect(seedMs).toBeLessThan(15000)
    expect(exportMs).toBeLessThan(15000)
  })
})
