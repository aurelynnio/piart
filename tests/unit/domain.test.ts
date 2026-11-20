import { describe, it, expect } from 'vitest'
import {
  buildUnityClipName,
  clipFramesToUnityKeyframes,
  scaleFrameDurationMs,
  studioNineSliceToUnityBorder,
  studioPivotToUnityPivot,
  studioRectToUnityRect,
  studioTileToUnityCell,
  unityCellToStudioTile,
  unityPivotToStudioPivot,
  unityRectToStudioRect
} from '@domain/rules/unityMath'
import {
  buildDeterministicWorkflowPlan,
  extractPromptHints,
  resolveParameters,
  type PromptFormState,
  type ResolveContext
} from '@domain/rules/parameterResolver'
import { validateWorkflowPlan } from '@domain/planner/validator'
import {
  createSimulationState,
  stepSimulation,
  validateDataTable,
  validateDialogueGraph
} from '@domain/validators/gameplayValidator'
import { validateManifestObject, validateSceneAndGameplay } from '@domain/validators/assetValidator'
import { maskApiKey, redactDeep, redactString } from '@domain/security/redactor'
import type { ClipFrame, DialogueGraph, ProjectConfig } from '@domain/schemas/types'

const SAMPLE_PROJECT: ProjectConfig = {
  projectId: 'proj_test',
  schemaVersion: 2,
  configVersion: 1,
  name: 'Test Project',
  locale: 'vi-VN',
  pixelsPerUnit: 32,
  tileSizePx: 32,
  defaultCanvasPx: { w: 32, h: 48 },
  defaultPerspective: '3/4',
  uiResolutionPx: { w: 480, h: 270 },
  activePaletteId: null,
  activePresetId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
}

describe('Unity Coordinate & Timing Math', () => {
  it('converts sprite rects top-left <-> Unity bottom-left symmetrically', () => {
    const u = studioRectToUnityRect({ x: 16, y: 8, w: 32, h: 48 }, 128)
    expect(u).toEqual({ x: 16, y: 72, width: 32, height: 48 })
    expect(unityRectToStudioRect(u, 128)).toEqual({ x: 16, y: 8, w: 32, h: 48 })
  })

  it('converts pivot pixels <-> Unity normalized bottom-left pivot', () => {
    const p = studioPivotToUnityPivot({ x: 16, y: 48 }, { w: 32, h: 48 })
    expect(p).toEqual({ x: 0.5, y: 0 })
    expect(unityPivotToStudioPivot(p, { w: 32, h: 48 })).toEqual({ x: 16, y: 48 })
  })

  it('converts tilemap grid cells top-down <-> Unity Y-up', () => {
    const c = studioTileToUnityCell(4, 7, 8)
    expect(c).toEqual({ x: 4, y: 0, z: 0 })
    expect(unityCellToStudioTile(c, 8)).toEqual({ col: 4, row: 7 })
  })

  it('converts 9-slice borders to Unity Vector4 (L, B, R, T)', () => {
    expect(studioNineSliceToUnityBorder({ left: 4, top: 6, right: 8, bottom: 10 })).toEqual({
      x: 4,
      y: 10,
      z: 8,
      w: 6
    })
  })

  it('scales frame durations cleanly for 20% slower (0.8x speed -> 1.25x duration)', () => {
    expect(scaleFrameDurationMs(120, 0.8)).toBe(150)
    expect(scaleFrameDurationMs(125, 0.8)).toBe(156)
    expect(scaleFrameDurationMs(100, 0.8)).toBe(125)
  })

  it('emits Unity keyframes with terminal hold keyframe for full last-frame display', () => {
    const frames: ClipFrame[] = [0, 1, 2, 3, 4, 5].map((i) => ({
      frameId: `f${i}`,
      slotIndex: i,
      revisionId: `r${i}`,
      blobHash: 'a'.repeat(64),
      sourceRect: null,
      durationMs: 125,
      offsetPx: { x: 0, y: 0 },
      isLocked: false,
      isIntentionalHold: false,
      qcWarnings: []
    }))
    const res = clipFramesToUnityKeyframes(frames)
    expect(res.totalDurationMs).toBe(750)
    expect(res.totalDurationSec).toBe(0.75)
    expect(res.keyframes).toHaveLength(7)
    expect(res.keyframes[6].timeSec).toBe(0.75)
    expect(res.keyframes[6].isTerminalHold).toBe(true)
    expect(buildUnityClipName('Thợ mộc', 'walk', 'left')).toBe('tho_moc_walk_left.anim')
  })
})

describe('ParameterResolver & Conflict / Deterministic Edit Detection', () => {
  const baseCtx: ResolveContext = {
    project: SAMPLE_PROJECT,
    preset: null,
    assets: [],
    folders: [],
    targetAsset: null,
    targetRevision: null,
    targetClip: null,
    targetFrameIndex: null,
    hasMask: false
  }

  it('A02: detects conflict when form selects 32x32 and prompt requests 64x64', () => {
    const form: PromptFormState = {
      mode: 'create',
      contentType: 'character',
      promptText: 'Tạo NPC 64 × 64',
      spriteSize: { value: { w: 32, h: 32 }, mode: 'selected' }
    }
    const r1 = resolveParameters(form, baseCtx)
    expect(r1.canExecute).toBe(false)
    expect(r1.unresolvedConflicts).toHaveLength(1)
    expect(r1.unresolvedConflicts[0].field).toBe('spriteSize')

    const r2 = resolveParameters(form, { ...baseCtx, conflictResolutions: { spriteSize: 'form' } })
    expect(r2.canExecute).toBe(true)
    expect(r2.resolvedSettings.spriteSize).toEqual({ w: 32, h: 32 })
  })

  it('A05: routes "Cho clip đi trái chậm hơn 20%" to deterministic 0-image-call step', () => {
    const hints = extractPromptHints('Cho clip đi trái chậm hơn 20%.', 'edit')
    expect(hints.deterministicEdit?.operation).toBe('update_clip_timing')
    expect(hints.deterministicEdit?.params.speedFactor).toBe(0.8)
    expect(hints.deterministicEdit?.params.targetDirection).toBe('left')

    const form: PromptFormState = {
      mode: 'edit',
      contentType: 'auto',
      promptText: 'Cho clip đi trái chậm hơn 20%.'
    }
    const res = resolveParameters(form, baseCtx)
    const plan = buildDeterministicWorkflowPlan(form, res, baseCtx, 'plan_a05')
    expect(plan.estimatedSummary.imageApiCalls).toBe(0)
    expect(plan.estimatedSummary.localSteps).toBe(1)
    expect(plan.steps[0].kind).toBe('deterministic')
  })

  it('A06: decomposes workshop room prompt into ordered multi-output DAG', () => {
    const form: PromptFormState = {
      mode: 'create',
      contentType: 'auto',
      promptText: 'Tạo xưởng mộc 10 × 8 ô, có bàn, ghế và tủ hai ô ngang. Tủ có clip mở 6 frame. Đặt cửa ra vào ở phía dưới.',
      tileSizePx: { value: 32, mode: 'project' }
    }
    const res = resolveParameters(form, baseCtx)
    const plan = buildDeterministicWorkflowPlan(form, res, baseCtx, 'plan_room')
    expect(plan.steps.length).toBeGreaterThanOrEqual(5)
    const validation = validateWorkflowPlan(plan, {
      projectId: SAMPLE_PROJECT.projectId,
      existingAssetIds: new Set(),
      existingClipIds: new Set(),
      existingRevisionIds: new Set()
    })
    expect(validation.valid).toBe(true)
    expect(validation.orderedStepIds.indexOf('room_cabinet')).toBeLessThan(
      validation.orderedStepIds.indexOf('room_cabinet_open_clip')
    )
    expect(validation.orderedStepIds.indexOf('room_tileset')).toBeLessThan(
      validation.orderedStepIds.indexOf('room_map')
    )
  })

  it('detects dependency cycles in WorkflowPlan validator', () => {
    const cyclicPlan = {
      schemaVersion: 1,
      planId: 'p_cyc',
      projectId: 'proj_test',
      mode: 'create',
      steps: [
        { id: 'a', kind: 'ai_image', operation: 'generate_sprite', dependsOn: ['b'] },
        { id: 'b', kind: 'ai_image', operation: 'generate_sprite', dependsOn: ['a'] }
      ]
    }
    const v = validateWorkflowPlan(cyclicPlan, {
      projectId: 'proj_test',
      existingAssetIds: new Set(),
      existingClipIds: new Set(),
      existingRevisionIds: new Set()
    })
    expect(v.valid).toBe(false)
    expect(v.issues.some((i) => i.code === 'DEPENDENCY_CYCLE')).toBe(true)
  })
})

describe('Gameplay Validator, Branch Simulator, Scene & Redactor', () => {
  it('validates unreachable nodes and simulates missing vs has-hammer branches (A07)', () => {
    const graph: DialogueGraph = {
      dialogueId: 'd1',
      assetId: 'a_d1',
      name: 'Hammer Dialogue',
      npcAssetId: 'npc_1',
      startNodeId: 's',
      nodes: [
        { nodeId: 's', kind: 'dialogue', speakerAssetId: 'npc_1', speakerName: 'Thợ mộc', text: 'Có búa chưa?', condition: null, effects: [], position: { x: 0, y: 0 } },
        { nodeId: 'no', kind: 'dialogue', speakerAssetId: 'npc_1', speakerName: 'Thợ mộc', text: 'Chưa có búa!', condition: null, effects: [], position: { x: 1, y: 0 } },
        { nodeId: 'yes', kind: 'dialogue', speakerAssetId: 'npc_1', speakerName: 'Thợ mộc', text: 'Cảm ơn!', condition: null, effects: [{ kind: 'set_flag', key: 'done', value: true }, { kind: 'give_item', key: 'gold', value: 50 }], position: { x: 1, y: 1 } },
        { nodeId: 'orphan', kind: 'dialogue', speakerAssetId: null, speakerName: '', text: 'Không tới được', condition: null, effects: [], position: { x: 2, y: 2 } },
        { nodeId: 'end', kind: 'end', speakerAssetId: null, speakerName: '', text: '', condition: null, effects: [], position: { x: 2, y: 0 } }
      ],
      edges: [
        { edgeId: 'e_yes', fromNodeId: 's', toNodeId: 'yes', label: 'Giao búa', condition: { kind: 'has_item', key: 'item_hammer', value: 1 } },
        { edgeId: 'e_no', fromNodeId: 's', toNodeId: 'no', label: 'Chưa có', condition: null },
        { edgeId: 'e1', fromNodeId: 'no', toNodeId: 'end', label: '', condition: null },
        { edgeId: 'e2', fromNodeId: 'yes', toNodeId: 'end', label: '', condition: null }
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    }

    const issues = validateDialogueGraph(graph, {
      assetIds: new Set(['npc_1']),
      flags: [{ flagId: 'f1', key: 'done', type: 'bool', defaultValue: false, description: '' }],
      quests: []
    })
    expect(issues.some((i) => i.code === 'UNREACHABLE_NODE' && i.targetId === 'orphan')).toBe(true)

    // Branch 1: Missing hammer
    const sMissing = stepSimulation(graph, createSimulationState(graph, { done: false }, {}))
    expect(sMissing.currentNodeId).toBe('no')
    expect(sMissing.flags.done).toBe(false)

    // Branch 2: Has hammer
    const sHas = stepSimulation(
      graph,
      createSimulationState(graph, { done: false }, { item_hammer: 1 }),
      'e_yes'
    )
    expect(sHas.currentNodeId).toBe('yes')
    expect(sHas.flags.done).toBe(true)
    expect(sHas.inventory.gold).toBe(50)
  })

  it('validates DataTable range and enum constraints (F092)', () => {
    const issues = validateDataTable(
      {
        tableId: 't1',
        assetId: 'at1',
        name: 'Items',
        columns: [
          { colId: 'c1', name: 'price', type: 'int', required: true, min: 0, max: 100 },
          { colId: 'c2', name: 'rarity', type: 'enum', required: true, enumValues: ['common', 'rare'] }
        ],
        rows: [{ price: 250, rarity: 'mythic' }],
        createdAt: '',
        updatedAt: ''
      },
      new Set()
    )
    expect(issues.some((i) => i.code === 'TABLE_RANGE_MAX')).toBe(true)
    expect(issues.some((i) => i.code === 'TABLE_ENUM_INVALID')).toBe(true)
  })

  it('detects out-of-bounds placement & footprint overlap on scene (F073)', () => {
    const issues = validateSceneAndGameplay({
      scene: {
        sceneId: 's1',
        assetId: 'as1',
        name: 'Map',
        cols: 4,
        rows: 4,
        tileSizePx: 32,
        tilesetId: null,
        layers: [],
        placements: [
          { placementId: 'p1', assetId: 'a1', revisionId: null, name: 'Tủ A', layerId: 'l1', gridX: 1, gridY: 1, offsetPx: { x: 0, y: 0 }, footprint: { w: 2, h: 1 }, facing: 'down', ySortOffset: 0, blocksMovement: true, linkedDialogueId: null, linkedQuestId: null },
          { placementId: 'p2', assetId: 'a1', revisionId: null, name: 'Bàn B', layerId: 'l1', gridX: 2, gridY: 1, offsetPx: { x: 0, y: 0 }, footprint: { w: 1, h: 1 }, facing: 'down', ySortOffset: 0, blocksMovement: true, linkedDialogueId: null, linkedQuestId: null },
          { placementId: 'p3', assetId: 'a1', revisionId: null, name: 'Ghế OOB', layerId: 'l1', gridX: 3, gridY: 3, offsetPx: { x: 0, y: 0 }, footprint: { w: 2, h: 1 }, facing: 'down', ySortOffset: 0, blocksMovement: true, linkedDialogueId: null, linkedQuestId: null }
        ],
        collisionRects: [],
        markers: [],
        createdAt: '',
        updatedAt: ''
      },
      tilesets: [],
      assets: [{ assetId: 'a1', name: 'A1', slug: 'a1', type: 'furniture', description: '', folderId: null, collectionIds: [], tags: [], parentAssetId: null, approvedRevisionId: null, latestRevisionId: null, metadata: {}, trashedAt: null, createdAt: '', updatedAt: '' }],
      dialogues: [],
      quests: [],
      flags: []
    })
    expect(issues.some((i) => i.code === 'PLACEMENT_FOOTPRINT_OVERLAP')).toBe(true)
    expect(issues.some((i) => i.code === 'PLACEMENT_OUT_OF_BOUNDS')).toBe(true)
  })

  it('redacts API keys, Authorization headers, and Windows user paths (A11)', () => {
    const fakeKey = 'sk-proj-TestSecretKey1234567890ABCD'
    expect(maskApiKey(fakeKey)).toBe('sk-••••••ABCD')
    const logLine = `Authorization: Bearer ${fakeKey} failed at C:\\Users\\nguyenvana\\Desktop\\proj`
    const clean = redactString(logLine, [fakeKey])
    expect(clean).not.toContain(fakeKey)
    expect(clean).not.toContain('nguyenvana')
    expect(clean).toContain('<user>')

    const obj = redactDeep({ authorization: fakeKey, nested: { note: logLine } }, [fakeKey])
    expect(JSON.stringify(obj)).not.toContain(fakeKey)
  })

  it('rejects manifest with unsafe relative paths or mismatched checksums (F117)', () => {
    const issues = validateManifestObject(
      {
        manifestSchemaVersion: 1,
        minImporterVersion: '1.0.0',
        pinnedUnityVersion: '6000.6.7f1',
        exportRunId: 'exp_1',
        exportedAt: '2026-01-01T00:00:00Z',
        projectId: 'p1',
        projectName: 'P1',
        pixelsPerUnit: 32,
        tileSizePx: 32,
        conventions: {
          imageOrigin: 'top-left',
          unitySpriteRectOrigin: 'bottom-left',
          unityPivotOrigin: 'bottom-left-normalized',
          tilemapMapping: 'y_flipped_rows_minus_1_minus_row',
          durationUnit: 'milliseconds',
          textureFilter: 'Point',
          textureCompression: 'Uncompressed'
        },
        scope: { kind: 'project', rootIds: [] },
        entries: [
          {
            stableId: 'a1',
            revisionId: 'r1',
            assetType: 'character',
            name: 'Bad',
            relativePath: '../escape.png',
            metadataPath: null,
            sha256: 'a'.repeat(64),
            byteSize: 10,
            dependencies: []
          }
        ]
      },
      new Map([['../escape.png', 'b'.repeat(64)]])
    )
    expect(issues.some((i) => i.code === 'MANIFEST_UNSAFE_PATH')).toBe(true)
    expect(issues.some((i) => i.code === 'MANIFEST_CHECKSUM_MISMATCH')).toBe(true)
  })
})
