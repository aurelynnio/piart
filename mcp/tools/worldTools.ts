import { z } from 'zod'
import { makeId } from '../../app/main/db/projectStore'
import {
  createSimulationState,
  getAvailableEdges,
  stepSimulation,
  validateDataTable,
  validateDialogueGraph,
  validateQuest
} from '@domain/validators/gameplayValidator'
import { validateSceneAndGameplay } from '@domain/validators/assetValidator'
import type { DataTable, DialogueGraph, Quest, Scene } from '@domain/schemas/types'
import type { PiartMcpContext } from '../context'

const WorldEntityTypeEnum = z.enum([
  'tileset',
  'scene',
  'dialogue',
  'quest',
  'data_table',
  'ui_screen',
  'vfx',
  'cutscene',
  'state_flag'
])

export function registerWorldTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'world_list_entities',
    {
      title: 'Liệt kê thực thể Thế giới & Gameplay',
      description:
        'Liệt kê tilesets, scenes (maps), dialogues, quests, data_tables, ui_screens, vfx, cutscenes hoặc state_flags trong dự án.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        entityType: WorldEntityTypeEnum
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const map = {
        tileset: state.tilesets,
        scene: state.scenes,
        dialogue: state.dialogues,
        quest: state.quests,
        data_table: state.dataTables,
        ui_screen: state.uiScreens,
        vfx: state.vfxConfigs,
        cutscene: state.cutscenes,
        state_flag: state.stateFlags
      }
      const list = map[args.entityType]
      return { entityType: args.entityType, total: list.length, items: list }
    }
  )

  ctx.registerTool(
    'world_get_entity',
    {
      title: 'Đọc chi tiết một thực thể Thế giới / Gameplay',
      description: 'Lấy toàn bộ dữ liệu JSON của một tileset, scene, dialogue, quest, data_table, ui_screen, vfx, cutscene hoặc state_flag theo ID.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        entityType: WorldEntityTypeEnum,
        id: z.string().min(1)
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const entity = store.getEntity(args.entityType, args.id)
      if (!entity) throw new Error(`Không tìm thấy ${args.entityType} với ID "${args.id}".`)
      return { entityType: args.entityType, id: args.id, data: entity }
    }
  )

  ctx.registerTool(
    'world_upsert_entity',
    {
      title: 'Tạo hoặc cập nhật thực thể Thế giới / Gameplay',
      description: 'Ghi trực tiếp dữ liệu JSON cho tileset, scene, dialogue, quest, data_table, ui_screen, vfx, cutscene hoặc state_flag.',
      inputSchema: {
        entityType: WorldEntityTypeEnum,
        id: z.string().min(1),
        data: z.record(z.unknown())
      }
    },
    (args) => {
      ctx.service.upsertEntityDirect(args.entityType, args.id, args.data)
      return { ok: true, entityType: args.entityType, id: args.id }
    }
  )

  ctx.registerTool(
    'world_scene_paint_tiles',
    {
      title: 'Vẽ ô Tile lên bản đồ (Scene)',
      description: 'Đặt nhiều ô tile lên một layer (mặc định layer ground) của Scene/Map.',
      inputSchema: {
        sceneId: z.string().min(1),
        layerId: z.string().optional().describe('Bỏ trống sẽ tự chọn layer kind="ground" đầu tiên'),
        cells: z
          .array(
            z.object({
              col: z.number().int().min(0),
              row: z.number().int().min(0),
              tileId: z.string().min(1)
            })
          )
          .min(1)
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const scene = store.getEntity<Scene>('scene', args.sceneId)
      if (!scene) throw new Error(`Không tìm thấy scene "${args.sceneId}".`)
      const targetLayer = args.layerId
        ? scene.layers.find((l) => l.layerId === args.layerId)
        : scene.layers.find((l) => l.kind === 'ground')
      if (!targetLayer) throw new Error('Không tìm thấy layer phù hợp trên scene.')

      const updatedCells = { ...targetLayer.cells }
      for (const c of args.cells) {
        if (c.col >= scene.cols || c.row >= scene.rows) {
          throw new Error(`Tọa độ (${c.col}, ${c.row}) vượt biên bản đồ ${scene.cols}×${scene.rows}.`)
        }
        updatedCells[`${c.col},${c.row}`] = c.tileId
      }

      const nextScene: Scene = {
        ...scene,
        layers: scene.layers.map((l) =>
          l.layerId === targetLayer.layerId ? { ...l, cells: updatedCells } : l
        ),
        updatedAt: new Date().toISOString()
      }
      ctx.service.upsertEntityDirect('scene', scene.sceneId, nextScene)
      return { ok: true, sceneId: scene.sceneId, layerId: targetLayer.layerId, paintedCount: args.cells.length }
    }
  )

  ctx.registerTool(
    'world_scene_place_asset',
    {
      title: 'Đặt hoặc xóa vật thể/NPC trên bản đồ (Scene)',
      description: 'Thêm, cập nhật hoặc gỡ một sprite placement (kèm footprint & va chạm) trên Scene/Map.',
      inputSchema: {
        sceneId: z.string().min(1),
        action: z.enum(['upsert', 'remove']).default('upsert'),
        placementId: z.string().optional(),
        assetId: z.string().optional(),
        name: z.string().optional(),
        gridX: z.number().int().min(0).optional(),
        gridY: z.number().int().min(0).optional(),
        footprintW: z.number().int().min(1).optional().default(1),
        footprintH: z.number().int().min(1).optional().default(1),
        blocksMovement: z.boolean().optional().default(true)
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const scene = store.getEntity<Scene>('scene', args.sceneId)
      if (!scene) throw new Error(`Không tìm thấy scene "${args.sceneId}".`)

      let placements = [...scene.placements]
      if (args.action === 'remove') {
        if (!args.placementId) throw new Error('Cần truyền `placementId` khi xóa.')
        placements = placements.filter((p) => p.placementId !== args.placementId)
      } else {
        if (!args.assetId || args.gridX === undefined || args.gridY === undefined) {
          throw new Error('Cần truyền `assetId`, `gridX`, `gridY` khi đặt vật thể.')
        }
        const pid = args.placementId || makeId('plc')
        const objectsLayer = scene.layers.find((l) => l.kind === 'object') ?? scene.layers[0]
        const entry: Scene['placements'][number] = {
          placementId: pid,
          assetId: args.assetId,
          revisionId: null,
          name: args.name || args.assetId,
          layerId: objectsLayer?.layerId ?? 'layer_objects',
          gridX: args.gridX,
          gridY: args.gridY,
          offsetPx: { x: 0, y: 0 },
          footprint: { w: args.footprintW, h: args.footprintH },
          blocksMovement: args.blocksMovement,
          facing: 'down',
          ySortOffset: 0,
          linkedDialogueId: null,
          linkedQuestId: null
        }
        const exists = placements.some((p) => p.placementId === pid)
        placements = exists ? placements.map((p) => (p.placementId === pid ? entry : p)) : [...placements, entry]
      }

      const nextScene: Scene = { ...scene, placements, updatedAt: new Date().toISOString() }
      ctx.service.upsertEntityDirect('scene', scene.sceneId, nextScene)
      return { ok: true, sceneId: scene.sceneId, placementCount: placements.length }
    }
  )

  ctx.registerTool(
    'world_validate_scene',
    {
      title: 'Kiểm tra hợp lệ Bản đồ & Footprint',
      description: 'Kiểm tra chồng lấn footprint, vượt biên bản đồ và liên kết hỏng của Scene/Map.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        sceneId: z.string().min(1)
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const scene = state.scenes.find((s) => s.sceneId === args.sceneId)
      if (!scene) throw new Error(`Không tìm thấy scene "${args.sceneId}".`)
      const issues = validateSceneAndGameplay({
        scene,
        tilesets: state.tilesets,
        assets: state.assets,
        dialogues: state.dialogues,
        quests: state.quests,
        flags: state.stateFlags
      })
      return { sceneId: scene.sceneId, ok: issues.every((i) => i.severity !== 'error'), issues }
    }
  )

  ctx.registerTool(
    'world_dialogue_validate',
    {
      title: 'Kiểm tra hợp lệ Đồ thị Hội thoại',
      description: 'Kiểm tra node mồ côi, liên kết hỏng, điều kiện cờ trạng thái và nhiệm vụ của một DialogueGraph.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dialogueId: z.string().min(1)
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const dialogue = state.dialogues.find((d) => d.dialogueId === args.dialogueId)
      if (!dialogue) throw new Error(`Không tìm thấy hội thoại "${args.dialogueId}".`)
      const issues = validateDialogueGraph(dialogue, {
        assetIds: new Set(state.assets.filter((a) => !a.trashedAt).map((a) => a.assetId)),
        flags: state.stateFlags,
        quests: state.quests
      })
      return { dialogueId: dialogue.dialogueId, ok: issues.every((i) => i.severity !== 'error'), issues }
    }
  )

  ctx.registerTool(
    'world_dialogue_simulate',
    {
      title: 'Mô phỏng nhánh Hội thoại (Dialogue Simulator)',
      description:
        'Khởi tạo trạng thái mô phỏng hội thoại với cờ (flags) và túi đồ (inventory) tùy chọn, rồi bước qua chuỗi `edgeIds` để kiểm chứng điều kiện phân nhánh và hiệu ứng.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dialogueId: z.string().min(1),
        flags: z.record(z.union([z.boolean(), z.number(), z.string()])).optional(),
        inventory: z.record(z.number().int().min(0)).optional().default({}),
        edgeIds: z.array(z.string()).optional().default([]).describe('Chuỗi edgeId muốn đi qua theo thứ tự')
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const dialogue = state.dialogues.find((d) => d.dialogueId === args.dialogueId) as DialogueGraph | undefined
      if (!dialogue) throw new Error(`Không tìm thấy hội thoại "${args.dialogueId}".`)

      const defaultFlags: Record<string, boolean | number | string> = {}
      for (const f of state.stateFlags) defaultFlags[f.key] = f.defaultValue
      let sim = createSimulationState(dialogue, { ...defaultFlags, ...(args.flags ?? {}) }, args.inventory)

      for (const edgeId of args.edgeIds) {
        sim = stepSimulation(dialogue, sim, edgeId)
      }

      const currentNode = dialogue.nodes.find((n) => n.nodeId === sim.currentNodeId) ?? null
      const availableEdges = getAvailableEdges(dialogue, sim)
      return {
        dialogueId: dialogue.dialogueId,
        currentNode,
        availableEdges,
        simulationState: sim
      }
    }
  )

  ctx.registerTool(
    'world_quest_validate',
    {
      title: 'Kiểm tra hợp lệ Nhiệm vụ (Quest)',
      description: 'Kiểm tra mục tiêu, điều kiện cờ trạng thái và phần thưởng của Quest.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        questId: z.string().min(1)
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const quest = state.quests.find((q) => q.questId === args.questId) as Quest | undefined
      if (!quest) throw new Error(`Không tìm thấy quest "${args.questId}".`)
      const issues = validateQuest(quest, {
        assetIds: new Set(state.assets.filter((a) => !a.trashedAt).map((a) => a.assetId)),
        flags: state.stateFlags,
        quests: state.quests
      })
      return { questId: quest.questId, ok: issues.every((i) => i.severity !== 'error'), issues }
    }
  )

  ctx.registerTool(
    'world_table_add_row_and_validate',
    {
      title: 'Thêm dòng & Kiểm tra Bảng dữ liệu (DataTable)',
      description: 'Thêm một hoặc nhiều dòng dữ liệu vào DataTable (tùy chọn) và chạy kiểm tra schema cột/tham chiếu asset.',
      inputSchema: {
        tableId: z.string().min(1),
        appendRows: z.array(z.record(z.unknown())).optional().default([])
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const state = store.getFullState()
      const table = state.dataTables.find((t) => t.tableId === args.tableId) as DataTable | undefined
      if (!table) throw new Error(`Không tìm thấy DataTable "${args.tableId}".`)

      const updated: DataTable =
        args.appendRows.length > 0
          ? { ...table, rows: [...table.rows, ...args.appendRows], updatedAt: new Date().toISOString() }
          : table

      if (args.appendRows.length > 0) {
        ctx.service.upsertEntityDirect('data_table', updated.tableId, updated)
      }

      const issues = validateDataTable(
        updated,
        new Set(state.assets.filter((a) => !a.trashedAt).map((a) => a.assetId))
      )
      return {
        tableId: updated.tableId,
        rowCount: updated.rows.length,
        ok: issues.every((i) => i.severity !== 'error'),
        issues
      }
    }
  )
}
