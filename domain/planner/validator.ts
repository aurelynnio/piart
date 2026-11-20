import {
  ALLOWED_OPERATIONS,
  WorkflowPlanSchema,
  type ModelCapability,
  type ValidationIssue,
  type WorkflowPlan,
  type WorkflowStep
} from '../schemas/types'

export interface PlanValidationContext {
  projectId: string
  existingAssetIds: Set<string>
  existingClipIds: Set<string>
  existingRevisionIds: Set<string>
  imageModelCapability?: ModelCapability
  editModelCapability?: ModelCapability
  plannerModelCapability?: ModelCapability
}

export interface PlanValidationResult {
  valid: boolean
  orderedStepIds: string[]
  issues: ValidationIssue[]
}

export function topologicalSortSteps(steps: WorkflowStep[]): {
  ordered: WorkflowStep[]
  hasCycle: boolean
  cycleNodes: string[]
} {
  const map = new Map<string, WorkflowStep>()
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const s of steps) {
    map.set(s.id, s)
    inDegree.set(s.id, 0)
    adj.set(s.id, [])
  }

  for (const s of steps) {
    for (const dep of s.dependsOn) {
      if (!map.has(dep)) continue
      adj.get(dep)!.push(s.id)
      inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id)
  }

  const ordered: WorkflowStep[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    ordered.push(map.get(id)!)
    for (const next of adj.get(id) ?? []) {
      const nextDeg = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, nextDeg)
      if (nextDeg === 0) queue.push(next)
    }
  }

  if (ordered.length !== steps.length) {
    const visited = new Set(ordered.map((s) => s.id))
    const cycleNodes = steps.filter((s) => !visited.has(s.id)).map((s) => s.id)
    return { ordered, hasCycle: true, cycleNodes }
  }

  return { ordered, hasCycle: false, cycleNodes: [] }
}

export function validateWorkflowPlan(
  rawPlan: unknown,
  ctx: PlanValidationContext
): PlanValidationResult {
  const issues: ValidationIssue[] = []
  const parsed = WorkflowPlanSchema.safeParse(rawPlan)

  if (!parsed.success) {
    for (const err of parsed.error.issues) {
      issues.push({
        code: 'SCHEMA_INVALID',
        severity: 'error',
        targetId: null,
        targetType: 'plan',
        message: `${err.path.join('.')}: ${err.message}`
      })
    }
    return { valid: false, orderedStepIds: [], issues }
  }

  const plan: WorkflowPlan = parsed.data

  if (plan.projectId !== ctx.projectId) {
    issues.push({
      code: 'PROJECT_MISMATCH',
      severity: 'error',
      targetId: plan.projectId,
      targetType: 'project',
      message: `Kế hoạch thuộc dự án ${plan.projectId}, không khớp dự án đang mở ${ctx.projectId}.`
    })
  }

  // Unresolved conflicts block execution
  for (const c of plan.resolvedConflicts) {
    if (c.resolvedChoice === null) {
      issues.push({
        code: 'UNRESOLVED_CONFLICT',
        severity: 'error',
        targetId: c.field,
        targetType: 'parameter',
        message: `Thông số "${c.label}" đang mâu thuẫn giữa form và prompt, cần chốt trước khi chạy.`
      })
    }
  }

  for (const d of plan.disambiguations) {
    if (!d.selectedAssetId) {
      issues.push({
        code: 'UNRESOLVED_DISAMBIGUATION',
        severity: 'error',
        targetId: d.mentionText,
        targetType: 'mention',
        message: `Đối tượng "${d.mentionText}" trùng nhiều kết quả, cần chọn đúng ID trước khi chạy.`
      })
    }
  }

  const stepIds = new Set<string>()
  const allowSet = new Set<string>(ALLOWED_OPERATIONS)

  for (const step of plan.steps) {
    if (stepIds.has(step.id)) {
      issues.push({
        code: 'DUPLICATE_STEP_ID',
        severity: 'error',
        targetId: step.id,
        targetType: 'step',
        message: `Trùng stepId "${step.id}" trong kế hoạch.`
      })
    }
    stepIds.add(step.id)

    if (!allowSet.has(step.operation)) {
      issues.push({
        code: 'OPERATION_NOT_ALLOWED',
        severity: 'error',
        targetId: step.id,
        targetType: 'step',
        message: `Thao tác "${step.operation}" không nằm trong danh mục cho phép.`
      })
    }

    if (step.targetAssetId && !ctx.existingAssetIds.has(step.targetAssetId)) {
      issues.push({
        code: 'MISSING_TARGET_ASSET',
        severity: 'error',
        targetId: step.targetAssetId,
        targetType: 'asset',
        message: `Không tìm thấy asset đích "${step.targetAssetId}" trong dự án.`
      })
    }

    if (step.targetClipId && !ctx.existingClipIds.has(step.targetClipId)) {
      issues.push({
        code: 'MISSING_TARGET_CLIP',
        severity: 'error',
        targetId: step.targetClipId,
        targetType: 'clip',
        message: `Không tìm thấy clip đích "${step.targetClipId}" trong dự án.`
      })
    }

    if (step.sourceRevisionId && !ctx.existingRevisionIds.has(step.sourceRevisionId)) {
      issues.push({
        code: 'MISSING_SOURCE_REVISION',
        severity: 'error',
        targetId: step.sourceRevisionId,
        targetType: 'revision',
        message: `Không tìm thấy revision nguồn "${step.sourceRevisionId}".`
      })
    }

    // Check capability compatibility
    if (step.enabled && step.operation === 'inpaint_region' && ctx.editModelCapability) {
      if (!ctx.editModelCapability.supportsImageEditWithMask) {
        issues.push({
          code: 'CAPABILITY_MISSING_MASK_EDIT',
          severity: 'warning',
          targetId: step.id,
          targetType: 'model',
          message: `Model "${ctx.editModelCapability.displayName}" không hỗ trợ chỉnh ảnh bằng mask trực tiếp. Hãy chuyển sang model hỗ trợ hoặc dùng ghép mask cục bộ.`
        })
      }
    }

    if (step.enabled && step.kind === 'ai_image' && ctx.imageModelCapability) {
      if (!ctx.imageModelCapability.supportsImageGenerate) {
        issues.push({
          code: 'CAPABILITY_MISSING_IMAGE_GEN',
          severity: 'error',
          targetId: step.id,
          targetType: 'model',
          message: `Model "${ctx.imageModelCapability.displayName}" không có khả năng sinh ảnh.`
        })
      }
    }
  }

  // Missing dependency references
  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      if (!stepIds.has(dep)) {
        issues.push({
          code: 'MISSING_DEPENDENCY_STEP',
          severity: 'error',
          targetId: step.id,
          targetType: 'step',
          message: `Bước "${step.id}" phụ thuộc vào bước không tồn tại "${dep}".`
        })
      }
    }
  }

  const enabledSteps = plan.steps.filter((s) => s.enabled)
  const topo = topologicalSortSteps(enabledSteps)
  if (topo.hasCycle) {
    issues.push({
      code: 'DEPENDENCY_CYCLE',
      severity: 'error',
      targetId: topo.cycleNodes.join(','),
      targetType: 'plan',
      message: `Phát hiện chu trình phụ thuộc giữa các bước: ${topo.cycleNodes.join(', ')}.`
    })
  }

  return {
    valid: issues.every((i) => i.severity !== 'error'),
    orderedStepIds: topo.ordered.map((s) => s.id),
    issues
  }
}
