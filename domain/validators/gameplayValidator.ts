import type {
  ActionEffect,
  ConditionExpr,
  DataTable,
  DialogueGraph,
  Quest,
  StateFlag,
  ValidationIssue
} from '../schemas/types'

export interface GameplayValidationContext {
  assetIds: Set<string>
  flags: StateFlag[]
  quests: Quest[]
}

function validateConditionExpr(
  expr: ConditionExpr,
  targetId: string,
  flagMap: Map<string, StateFlag>,
  questMap: Map<string, Quest>,
  issues: ValidationIssue[]
): void {
  if (expr.kind === 'flag_eq' || expr.kind === 'flag_gte') {
    const flag = flagMap.get(expr.key)
    if (!flag) {
      issues.push({
        code: 'UNKNOWN_FLAG',
        severity: 'error',
        targetId,
        targetType: 'flag',
        message: `Điều kiện tham chiếu cờ chưa khai báo "${expr.key}".`
      })
      return
    }
    if (flag.type === 'bool' && typeof expr.value !== 'boolean') {
      issues.push({
        code: 'FLAG_TYPE_MISMATCH',
        severity: 'error',
        targetId,
        targetType: 'flag',
        message: `Cờ "${expr.key}" có kiểu bool nhưng biểu thức so sánh với giá trị kiểu ${typeof expr.value}.`
      })
    } else if (flag.type === 'int' && typeof expr.value !== 'number') {
      issues.push({
        code: 'FLAG_TYPE_MISMATCH',
        severity: 'error',
        targetId,
        targetType: 'flag',
        message: `Cờ "${expr.key}" có kiểu int nhưng biểu thức so sánh với giá trị kiểu ${typeof expr.value}.`
      })
    } else if (flag.type === 'string' && typeof expr.value !== 'string') {
      issues.push({
        code: 'FLAG_TYPE_MISMATCH',
        severity: 'error',
        targetId,
        targetType: 'flag',
        message: `Cờ "${expr.key}" có kiểu string nhưng biểu thức so sánh với giá trị kiểu ${typeof expr.value}.`
      })
    }
    if (expr.kind === 'flag_gte' && flag.type !== 'int') {
      issues.push({
        code: 'INVALID_OPERATOR_FOR_FLAG',
        severity: 'error',
        targetId,
        targetType: 'flag',
        message: `Toán tử >= chỉ dùng được cho cờ kiểu int, không hợp lệ với "${expr.key}" (${flag.type}).`
      })
    }
  } else if (expr.kind === 'quest_status') {
    if (!questMap.has(expr.key)) {
      issues.push({
        code: 'UNKNOWN_QUEST_REF',
        severity: 'warning',
        targetId,
        targetType: 'quest',
        message: `Điều kiện tham chiếu nhiệm vụ chưa tồn tại "${expr.key}".`
      })
    }
  }
}

export function validateDialogueGraph(
  graph: DialogueGraph,
  ctx: GameplayValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const nodeMap = new Map(graph.nodes.map((n) => [n.nodeId, n]))
  const flagMap = new Map(ctx.flags.map((f) => [f.key, f]))
  const questMap = new Map(ctx.quests.map((q) => [q.questId, q]))

  if (graph.npcAssetId && !ctx.assetIds.has(graph.npcAssetId)) {
    issues.push({
      code: 'BROKEN_NPC_REF',
      severity: 'error',
      targetId: graph.dialogueId,
      targetType: 'dialogue',
      message: `Hội thoại "${graph.name}" trỏ tới NPC không tồn tại (${graph.npcAssetId}).`
    })
  }

  if (!nodeMap.has(graph.startNodeId)) {
    issues.push({
      code: 'MISSING_START_NODE',
      severity: 'error',
      targetId: graph.dialogueId,
      targetType: 'dialogue',
      message: `Hội thoại "${graph.name}" thiếu node bắt đầu "${graph.startNodeId}".`
    })
    return issues
  }

  // Validate edges
  const outgoing = new Map<string, string[]>()
  for (const n of graph.nodes) outgoing.set(n.nodeId, [])

  for (const edge of graph.edges) {
    if (!nodeMap.has(edge.fromNodeId)) {
      issues.push({
        code: 'BROKEN_EDGE_SOURCE',
        severity: 'error',
        targetId: edge.edgeId,
        targetType: 'edge',
        message: `Cạnh "${edge.edgeId}" có nguồn không tồn tại (${edge.fromNodeId}).`
      })
    }
    if (!nodeMap.has(edge.toNodeId)) {
      issues.push({
        code: 'BROKEN_EDGE_TARGET',
        severity: 'error',
        targetId: edge.edgeId,
        targetType: 'edge',
        message: `Cạnh "${edge.edgeId}" trỏ tới node không tồn tại (${edge.toNodeId}).`
      })
    }
    if (nodeMap.has(edge.fromNodeId) && nodeMap.has(edge.toNodeId)) {
      outgoing.get(edge.fromNodeId)!.push(edge.toNodeId)
    }
    if (edge.condition) {
      validateConditionExpr(edge.condition, edge.edgeId, flagMap, questMap, issues)
    }
  }

  // BFS for unreachable nodes
  const visited = new Set<string>([graph.startNodeId])
  const queue = [graph.startNodeId]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const next of outgoing.get(id) ?? []) {
      if (!visited.has(next)) {
        visited.add(next)
        queue.push(next)
      }
    }
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.nodeId)) {
      issues.push({
        code: 'UNREACHABLE_NODE',
        severity: 'error',
        targetId: node.nodeId,
        targetType: 'node',
        message: `Node "${node.nodeId}" không thể đi tới từ node bắt đầu "${graph.startNodeId}".`
      })
    }
    if (node.kind !== 'end' && (outgoing.get(node.nodeId)?.length ?? 0) === 0) {
      issues.push({
        code: 'DEAD_END_NODE',
        severity: 'warning',
        targetId: node.nodeId,
        targetType: 'node',
        message: `Node "${node.nodeId}" không phải node kết thúc nhưng không có cạnh đi tiếp.`
      })
    }
    if (node.condition) {
      validateConditionExpr(node.condition, node.nodeId, flagMap, questMap, issues)
    }
  }

  return issues
}

export function validateQuest(quest: Quest, ctx: GameplayValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const flagMap = new Map(ctx.flags.map((f) => [f.key, f]))
  const questMap = new Map(ctx.quests.map((q) => [q.questId, q]))

  if (quest.giverNpcAssetId && !ctx.assetIds.has(quest.giverNpcAssetId)) {
    issues.push({
      code: 'BROKEN_QUEST_NPC',
      severity: 'error',
      targetId: quest.questId,
      targetType: 'quest',
      message: `Nhiệm vụ "${quest.name}" gắn với NPC không tồn tại (${quest.giverNpcAssetId}).`
    })
  }
  if (quest.prerequisiteQuestId && !questMap.has(quest.prerequisiteQuestId)) {
    issues.push({
      code: 'BROKEN_PREREQ_QUEST',
      severity: 'error',
      targetId: quest.questId,
      targetType: 'quest',
      message: `Nhiệm vụ tiền đề "${quest.prerequisiteQuestId}" không tồn tại.`
    })
  }
  for (const c of quest.startConditions) {
    validateConditionExpr(c, quest.questId, flagMap, questMap, issues)
  }
  for (const obj of quest.objectives) {
    validateConditionExpr(obj.condition, obj.objectiveId, flagMap, questMap, issues)
  }
  for (const r of quest.rewards) {
    if (r.itemAssetId && !ctx.assetIds.has(r.itemAssetId)) {
      issues.push({
        code: 'BROKEN_REWARD_ITEM',
        severity: 'error',
        targetId: quest.questId,
        targetType: 'quest',
        message: `Phần thưởng "${r.itemKey}" trỏ tới vật phẩm không tồn tại (${r.itemAssetId}).`
      })
    }
  }
  if (quest.completionFlagKey && !flagMap.has(quest.completionFlagKey)) {
    issues.push({
      code: 'UNKNOWN_COMPLETION_FLAG',
      severity: 'warning',
      targetId: quest.questId,
      targetType: 'flag',
      message: `Cờ hoàn thành "${quest.completionFlagKey}" chưa được khai báo trong danh sách StateFlag.`
    })
  }
  return issues
}

export function validateDataTable(table: DataTable, assetIds: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
    const row = table.rows[rowIdx]
    for (const col of table.columns) {
      const val = row[col.name]
      if (col.required && (val === undefined || val === null || val === '')) {
        issues.push({
          code: 'TABLE_REQUIRED_MISSING',
          severity: 'error',
          targetId: `${table.tableId}:${rowIdx}:${col.name}`,
          targetType: 'data_table',
          message: `Hàng ${rowIdx + 1}, cột "${col.name}" là bắt buộc.`
        })
        continue
      }
      if (val === undefined || val === null || val === '') continue

      if (col.type === 'int' && (!Number.isInteger(val) || typeof val !== 'number')) {
        issues.push({
          code: 'TABLE_TYPE_ERROR',
          severity: 'error',
          targetId: `${table.tableId}:${rowIdx}:${col.name}`,
          targetType: 'data_table',
          message: `Hàng ${rowIdx + 1}, cột "${col.name}" yêu cầu số nguyên.`
        })
      } else if (col.type === 'float' && typeof val !== 'number') {
        issues.push({
          code: 'TABLE_TYPE_ERROR',
          severity: 'error',
          targetId: `${table.tableId}:${rowIdx}:${col.name}`,
          targetType: 'data_table',
          message: `Hàng ${rowIdx + 1}, cột "${col.name}" yêu cầu số thực.`
        })
      } else if (col.type === 'bool' && typeof val !== 'boolean') {
        issues.push({
          code: 'TABLE_TYPE_ERROR',
          severity: 'error',
          targetId: `${table.tableId}:${rowIdx}:${col.name}`,
          targetType: 'data_table',
          message: `Hàng ${rowIdx + 1}, cột "${col.name}" yêu cầu boolean.`
        })
      } else if (col.type === 'enum' && col.enumValues && !col.enumValues.includes(String(val))) {
        issues.push({
          code: 'TABLE_ENUM_INVALID',
          severity: 'error',
          targetId: `${table.tableId}:${rowIdx}:${col.name}`,
          targetType: 'data_table',
          message: `Hàng ${rowIdx + 1}, cột "${col.name}" có giá trị "${val}" ngoài danh sách [${col.enumValues.join(', ')}].`
        })
      } else if (col.type === 'asset_ref' && !assetIds.has(String(val))) {
        issues.push({
          code: 'TABLE_ASSET_REF_MISSING',
          severity: 'error',
          targetId: `${table.tableId}:${rowIdx}:${col.name}`,
          targetType: 'data_table',
          message: `Hàng ${rowIdx + 1}, cột "${col.name}" trỏ tới asset không tồn tại (${val}).`
        })
      }

      if (typeof val === 'number') {
        if (col.min !== undefined && val < col.min) {
          issues.push({
            code: 'TABLE_RANGE_MIN',
            severity: 'error',
            targetId: `${table.tableId}:${rowIdx}:${col.name}`,
            targetType: 'data_table',
            message: `Hàng ${rowIdx + 1}, cột "${col.name}" (${val}) nhỏ hơn giới hạn ${col.min}.`
          })
        }
        if (col.max !== undefined && val > col.max) {
          issues.push({
            code: 'TABLE_RANGE_MAX',
            severity: 'error',
            targetId: `${table.tableId}:${rowIdx}:${col.name}`,
            targetType: 'data_table',
            message: `Hàng ${rowIdx + 1}, cột "${col.name}" (${val}) vượt quá giới hạn ${col.max}.`
          })
        }
      }
    }
  }
  return issues
}

export interface SimulationState {
  flags: Record<string, boolean | number | string>
  inventory: Record<string, number>
  questStatus: Record<string, 'not_started' | 'active' | 'completed'>
  currentNodeId: string
  visitedNodeIds: string[]
  appliedEffects: ActionEffect[]
  finished: boolean
}

export function evaluateCondition(expr: ConditionExpr, state: SimulationState): boolean {
  switch (expr.kind) {
    case 'flag_eq':
      return state.flags[expr.key] === expr.value
    case 'flag_gte':
      return Number(state.flags[expr.key] ?? 0) >= Number(expr.value)
    case 'has_item':
      return (state.inventory[expr.key] ?? 0) >= Number(expr.value || 1)
    case 'quest_status':
      return (state.questStatus[expr.key] ?? 'not_started') === expr.value
  }
}

export function applyEffect(effect: ActionEffect, state: SimulationState): void {
  switch (effect.kind) {
    case 'set_flag':
      state.flags[effect.key] = effect.value
      break
    case 'give_item':
      state.inventory[effect.key] = (state.inventory[effect.key] ?? 0) + Number(effect.value || 1)
      break
    case 'take_item':
      state.inventory[effect.key] = Math.max(
        0,
        (state.inventory[effect.key] ?? 0) - Number(effect.value || 1)
      )
      break
    case 'start_quest':
      state.questStatus[effect.key] = 'active'
      break
    case 'complete_quest':
      state.questStatus[effect.key] = 'completed'
      break
  }
  state.appliedEffects.push(effect)
}

export function createSimulationState(
  graph: DialogueGraph,
  initialFlags: Record<string, boolean | number | string>,
  initialInventory: Record<string, number>,
  initialQuestStatus: Record<string, 'not_started' | 'active' | 'completed'> = {}
): SimulationState {
  return {
    flags: { ...initialFlags },
    inventory: { ...initialInventory },
    questStatus: { ...initialQuestStatus },
    currentNodeId: graph.startNodeId,
    visitedNodeIds: [graph.startNodeId],
    appliedEffects: [],
    finished: false
  }
}

export function getAvailableEdges(graph: DialogueGraph, state: SimulationState) {
  return graph.edges.filter(
    (e) =>
      e.fromNodeId === state.currentNodeId &&
      (!e.condition || evaluateCondition(e.condition, state))
  )
}

export function stepSimulation(
  graph: DialogueGraph,
  state: SimulationState,
  edgeId?: string
): SimulationState {
  const next: SimulationState = {
    flags: { ...state.flags },
    inventory: { ...state.inventory },
    questStatus: { ...state.questStatus },
    currentNodeId: state.currentNodeId,
    visitedNodeIds: [...state.visitedNodeIds],
    appliedEffects: [...state.appliedEffects],
    finished: state.finished
  }
  if (next.finished) return next

  const currentNode = graph.nodes.find((n) => n.nodeId === next.currentNodeId)
  if (!currentNode) {
    next.finished = true
    return next
  }

  for (const eff of currentNode.effects) {
    applyEffect(eff, next)
  }

  if (currentNode.kind === 'end') {
    next.finished = true
    return next
  }

  const available = getAvailableEdges(graph, next)
  const chosen = edgeId ? available.find((e) => e.edgeId === edgeId) : available[0]
  if (!chosen) {
    next.finished = true
    return next
  }

  next.currentNodeId = chosen.toNodeId
  next.visitedNodeIds.push(chosen.toNodeId)

  const targetNode = graph.nodes.find((n) => n.nodeId === chosen.toNodeId)
  if (targetNode) {
    for (const eff of targetNode.effects) {
      applyEffect(eff, next)
    }
    if (targetNode.kind === 'end') {
      next.finished = true
    }
  }
  return next
}
