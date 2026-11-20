import type {
  Asset,
  AssetRevision,
  Clip,
  ContentType,
  Direction,
  DisambiguationRequest,
  FieldSource,
  Folder,
  LoopMode,
  ParameterConflict,
  ProjectConfig,
  SizePx,
  StylePreset,
  WorkflowPlan,
  WorkflowStep
} from '../schemas/types'
import { fpsToFrameDurationMs } from './unityMath'

export interface PromptFormField<T> {
  value: T | null
  mode: 'auto' | 'selected' | 'project'
}

export interface PromptFormState {
  mode: 'create' | 'edit'
  contentType: ContentType
  promptText: string
  spriteSize?: PromptFormField<SizePx>
  perspective?: PromptFormField<'top-down' | '3/4' | 'side-view'>
  directionCount?: PromptFormField<number>
  directions?: PromptFormField<Direction[]>
  framesPerDirection?: PromptFormField<number>
  fps?: PromptFormField<number>
  loopMode?: PromptFormField<LoopMode>
  tileSizePx?: PromptFormField<number>
  mapGrid?: PromptFormField<{ cols: number; rows: number }>
  footprintTiles?: PromptFormField<{ w: number; h: number }>
  action?: PromptFormField<string>
  enforcePalette?: PromptFormField<boolean>
  variantCount?: PromptFormField<number>
  nineSlice?: PromptFormField<{ left: number; top: number; right: number; bottom: number }>
  uiResolution?: PromptFormField<SizePx>
}

export interface ExtractedPromptHints {
  detectedContentType: Exclude<ContentType, 'auto'>
  spriteSize?: SizePx
  mapGrid?: { cols: number; rows: number }
  footprintTiles?: { w: number; h: number }
  tileSizePx?: number
  directionCount?: number
  directions?: Direction[]
  framesPerDirection?: number
  fps?: number
  loopMode?: LoopMode
  action?: string
  speedModifierFactor?: number
  deterministicEdit?: {
    operation: 'update_clip_timing' | 'rename_asset' | 'move_map_placement'
    summary: string
    params: Record<string, unknown>
  }
  mentions: string[]
  isMultiOutputRoom: boolean
  isCharacterWithWalk: boolean
}

export interface ResolveContext {
  project: ProjectConfig
  preset: StylePreset | null
  assets: Asset[]
  folders: Folder[]
  targetAsset: Asset | null
  targetRevision: AssetRevision | null
  targetClip: Clip | null
  targetFrameIndex: number | null
  hasMask: boolean
  conflictResolutions?: Record<string, 'form' | 'prompt'>
  disambiguationSelections?: Record<string, string>
}

export interface ResolutionResult {
  resolvedContentType: Exclude<ContentType, 'auto'>
  resolvedSettings: Record<string, unknown>
  fieldSources: Record<string, FieldSource>
  conflicts: ParameterConflict[]
  unresolvedConflicts: ParameterConflict[]
  disambiguations: DisambiguationRequest[]
  unresolvedDisambiguations: DisambiguationRequest[]
  hints: ExtractedPromptHints
  canExecute: boolean
}

function directionsFromCount(count: number): Direction[] {
  if (count >= 8) {
    return ['down', 'down_left', 'left', 'up_left', 'up', 'up_right', 'right', 'down_right']
  }
  if (count >= 4) {
    return ['down', 'left', 'right', 'up']
  }
  return ['down']
}

function normalizeVi(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function extractPromptHints(promptText: string, mode: 'create' | 'edit'): ExtractedPromptHints {
  const text = promptText.trim()
  const lower = normalizeVi(text)
  const hints: ExtractedPromptHints = {
    detectedContentType: 'character',
    mentions: [],
    isMultiOutputRoom: false,
    isCharacterWithWalk: false
  }

  // Extract @mentions
  const mentionMatches = text.matchAll(/@([\p{L}\p{N}_\-.]+)/gu)
  for (const m of mentionMatches) {
    if (m[1]) hints.mentions.push(m[1])
  }

  // Detect map grid e.g. "10 x 8 ô" or "10×8 tiles"
  const mapMatch = lower.match(/(\d{1,3})\s*[x×*]\s*(\d{1,3})\s*(?:ô|tiles?|cells?)/i)
  if (mapMatch) {
    hints.mapGrid = { cols: parseInt(mapMatch[1], 10), rows: parseInt(mapMatch[2], 10) }
  }

  // Detect footprint e.g. "hai ô ngang" / "2 ô ngang" / "footprint 2x1"
  if (/hai\s+ô\s+ngang|2\s+ô\s+ngang/i.test(lower)) {
    hints.footprintTiles = { w: 2, h: 1 }
  } else {
    const fpMatch = lower.match(/footprint\s*(\d{1,2})\s*[x×*]\s*(\d{1,2})/i)
    if (fpMatch) {
      hints.footprintTiles = { w: parseInt(fpMatch[1], 10), h: parseInt(fpMatch[2], 10) }
    }
  }

  // Detect pixel dimensions e.g. "64 × 64", "32x48", "32 x 32 px" (excluding map grid match)
  const allDims = [...lower.matchAll(/(\d{2,4})\s*[x×*]\s*(\d{2,4})(\s*(?:ô|tiles?|cells?|px|pixel))?/gi)]
  for (const m of allDims) {
    const unit = (m[3] || '').trim()
    if (/^(?:ô|tiles?|cells?)$/i.test(unit)) continue
    const w = parseInt(m[1], 10)
    const h = parseInt(m[2], 10)
    // Distinguish tile size mentions like "tile 32x32"
    const before = lower.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0)
    if (/\btile\s*$/i.test(before)) {
      if (w === h) hints.tileSizePx = w
    } else if (!hints.spriteSize && w >= 8 && h >= 8 && w <= 2048 && h <= 2048) {
      hints.spriteSize = { w, h }
    }
  }

  // Detect directions
  const dirCountMatch = lower.match(/(\d)\s*(?:hướng|directions?|dirs?)/i)
  if (dirCountMatch) {
    const n = parseInt(dirCountMatch[1], 10)
    if ([1, 4, 8].includes(n)) {
      hints.directionCount = n
      hints.directions = directionsFromCount(n)
    }
  } else if (/bốn\s+hướng|4\s*hướng/i.test(lower)) {
    hints.directionCount = 4
    hints.directions = directionsFromCount(4)
  }

  // Detect frames count
  const framesMatch = lower.match(/(\d{1,2})\s*frames?/i)
  if (framesMatch) {
    hints.framesPerDirection = parseInt(framesMatch[1], 10)
  }

  // Detect FPS
  const fpsMatch = lower.match(/(\d{1,2})\s*fps/i)
  if (fpsMatch) {
    hints.fps = parseInt(fpsMatch[1], 10)
  }

  // Detect loop
  if (/không\s*lặp|no\s*loop|one[\s-]?shot|chạy\s*1\s*lần/i.test(lower)) {
    hints.loopMode = 'once'
  } else if (/ping[\s-]?pong/i.test(lower)) {
    hints.loopMode = 'ping_pong'
  } else if (/\blặp\b|\bloop\b/i.test(lower)) {
    hints.loopMode = 'loop'
  }

  // Detect action
  if (/đi\s*bộ|\bwalk\b/i.test(lower)) hints.action = 'walk'
  else if (/\bidle\b|đứng\s*yên|thở/i.test(lower)) hints.action = 'idle'
  else if (/mở\s*tủ|mở\s*cửa|clip\s*mở|\bopen\b/i.test(lower)) hints.action = 'open'
  else if (/đóng\s*tủ|đóng\s*cửa|\bclose\b/i.test(lower)) hints.action = 'close'
  else if (/tương\s*tác|\binteract\b|đập\s*búa|\bhammer\b/i.test(lower)) hints.action = 'interact'

  // Detect deterministic local edit commands (0 AI image calls!)
  // 1) Speed modifier: "chậm hơn 20%" => 0.8x, "nhanh hơn 25%" => 1.25x, "slower by 20%"
  const slowerMatch = lower.match(/(?:chậm\s*hơn|giảm\s*tốc|slower\s*(?:by)?)\s*(\d{1,2})\s*%/i)
  const fasterMatch = lower.match(/(?:nhanh\s*hơn|tăng\s*tốc|faster\s*(?:by)?)\s*(\d{1,3})\s*%/i)
  if (slowerMatch) {
    const pct = parseInt(slowerMatch[1], 10)
    const factor = Number((1 - pct / 100).toFixed(4))
    if (factor > 0.05) {
      hints.speedModifierFactor = factor
      let targetDir: Direction | undefined
      if (/đi\s*trái|hướng\s*trái|\bleft\b/i.test(lower)) targetDir = 'left'
      else if (/đi\s*phải|hướng\s*phải|\bright\b/i.test(lower)) targetDir = 'right'
      else if (/đi\s*lên|hướng\s*lên|\bup\b/i.test(lower)) targetDir = 'up'
      else if (/đi\s*xuống|hướng\s*xuống|\bdown\b/i.test(lower)) targetDir = 'down'
      hints.deterministicEdit = {
        operation: 'update_clip_timing',
        summary: `Giảm tốc độ clip xuống ${(factor * 100).toFixed(0)}% (thời lượng frame × ${(1 / factor).toFixed(2)})`,
        params: { speedFactor: factor, targetDirection: targetDir }
      }
    }
  } else if (fasterMatch) {
    const pct = parseInt(fasterMatch[1], 10)
    const factor = Number((1 + pct / 100).toFixed(4))
    hints.speedModifierFactor = factor
    hints.deterministicEdit = {
      operation: 'update_clip_timing',
      summary: `Tăng tốc độ clip lên ${(factor * 100).toFixed(0)}%`,
      params: { speedFactor: factor }
    }
  } else if (/(?:đổi\s*fps|set\s*fps)\s*(?:thành|to|=)?\s*(\d{1,2})/i.test(lower)) {
    const m = lower.match(/(?:đổi\s*fps|set\s*fps)\s*(?:thành|to|=)?\s*(\d{1,2})/i)!
    const newFps = parseInt(m[1], 10)
    hints.fps = newFps
    hints.deterministicEdit = {
      operation: 'update_clip_timing',
      summary: `Đổi FPS cơ sở của clip thành ${newFps} FPS`,
      params: { fps: newFps }
    }
  } else if (/(?:đổi\s*tên|rename)\s+(?:thành|sang|to)\s+["“]?([^"”\n]+)["”]?/i.test(text)) {
    const m = text.match(/(?:đổi\s*tên|rename)\s+(?:thành|sang|to)\s+["“]?([^"”\n]+)["”]?/i)!
    hints.deterministicEdit = {
      operation: 'rename_asset',
      summary: `Đổi tên thành "${m[1].trim()}"`,
      params: { newName: m[1].trim() }
    }
  } else if (
    /(?:di\s*chuyển|dịch|đẩy|move)\s+.+?(?:sang\s*(trái|phải)|lên|xuống)\s*(\d+)\s*ô/i.test(lower)
  ) {
    const m = lower.match(/(?:sang\s*(trái|phải)|(lên)|(xuống))\s*(\d+)\s*ô/i)!
    const dist = parseInt(m[4], 10)
    let dx = 0
    let dy = 0
    if (m[1] === 'trái') dx = -dist
    else if (m[1] === 'phải') dx = dist
    else if (m[2]) dy = -dist
    else if (m[3]) dy = dist
    hints.deterministicEdit = {
      operation: 'move_map_placement',
      summary: `Dịch chuyển vật thể trên bản đồ (dx=${dx}, dy=${dy} ô)`,
      params: { dx, dy }
    }
  }

  // Content type classification
  const hasRoomKeywords =
    Boolean(hints.mapGrid) &&
    /(?:xưởng|phòng|căn\s*phòng|map|bản\s*đồ|room)/i.test(lower) &&
    /(?:bàn|ghế|tủ|cửa|nội\s*thất|furniture)/i.test(lower)
  const hasNpcAndWalk =
    /(?:npc|nhân\s*vật|thợ\s*mộc|character|hero)/i.test(lower) &&
    /(?:đi\s*bộ|\bwalk\b|animation|clip|chuyển\s*động)/i.test(lower)

  hints.isMultiOutputRoom = hasRoomKeywords
  hints.isCharacterWithWalk = hasNpcAndWalk

  if (hasRoomKeywords) {
    hints.detectedContentType = 'content_pack'
  } else if (hints.deterministicEdit?.operation === 'update_clip_timing') {
    hints.detectedContentType = 'animation'
  } else if (/(?:hội\s*thoại|nhiệm\s*vụ|dialogue|quest|bảng\s*chỉ\s*số)/i.test(lower)) {
    hints.detectedContentType = 'dialogue_quest'
  } else if (/(?:tileset|tile\s*viền|địa\s*hình|auto[\s-]?tile)/i.test(lower)) {
    hints.detectedContentType = 'tileset'
  } else if (hints.mapGrid || /(?:bản\s*đồ|\bmap\b|scene\s*xưởng)/i.test(lower)) {
    hints.detectedContentType = 'map'
  } else if (/(?:nút\s*bấm|khung\s*thoại|\bhud\b|9[\s-]?slice|ui\s|vfx|hiệu\s*ứng|bụi|khói|tia\s*sáng|storyboard|cutscene)/i.test(lower)) {
    hints.detectedContentType = 'ui_vfx'
  } else if (hasNpcAndWalk) {
    hints.detectedContentType = mode === 'create' ? 'content_pack' : 'animation'
  } else if (/(?:animation|clip|frame|chuyển\s*động|đi\s*bộ|mở\s*tủ)/i.test(lower)) {
    hints.detectedContentType = 'animation'
  } else if (/(?:bàn|ghế|tủ|nội\s*thất|vật\s*phẩm|công\s*cụ|búa|đạo\s*cụ|icon\s*túi\s*đồ|furniture|item|prop)/i.test(lower)) {
    hints.detectedContentType = 'furniture_item'
  } else {
    hints.detectedContentType = 'character'
  }

  return hints
}

function sizeEqual(a: SizePx, b: SizePx): boolean {
  return a.w === b.w && a.h === b.h
}

export function resolveParameters(form: PromptFormState, ctx: ResolveContext): ResolutionResult {
  const hints = extractPromptHints(form.promptText, form.mode)
  const resolvedContentType: Exclude<ContentType, 'auto'> =
    form.contentType === 'auto' ? hints.detectedContentType : form.contentType

  const resolvedSettings: Record<string, unknown> = {}
  const fieldSources: Record<string, FieldSource> = {}
  const conflicts: ParameterConflict[] = []

  const resolveField = <T>(
    key: string,
    label: string,
    formField: PromptFormField<T> | undefined,
    promptVal: T | undefined,
    assetVal: T | undefined,
    presetVal: T | undefined,
    defaultVal: T,
    equals: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  ): T => {
    const mode = formField?.mode ?? 'auto'
    const fVal = formField?.value ?? null

    if (mode === 'project') {
      const chosen = presetVal ?? defaultVal
      resolvedSettings[key] = chosen
      fieldSources[key] = presetVal !== undefined ? 'preset' : 'default'
      return chosen
    }

    if (mode === 'selected' && fVal !== null) {
      if (promptVal !== undefined && !equals(fVal, promptVal)) {
        const decision = ctx.conflictResolutions?.[key] ?? null
        conflicts.push({
          field: key,
          label,
          formValue: fVal,
          promptValue: promptVal,
          resolvedChoice: decision
        })
        if (decision === 'prompt') {
          resolvedSettings[key] = promptVal
          fieldSources[key] = 'prompt'
          return promptVal
        }
        resolvedSettings[key] = fVal
        fieldSources[key] = 'selected'
        return fVal
      }
      resolvedSettings[key] = fVal
      fieldSources[key] = 'selected'
      return fVal
    }

    // Auto cascade: Prompt -> Target Asset/Clip -> Active StylePreset -> System Default
    if (promptVal !== undefined) {
      resolvedSettings[key] = promptVal
      fieldSources[key] = 'prompt'
      return promptVal
    }
    if (assetVal !== undefined) {
      resolvedSettings[key] = assetVal
      fieldSources[key] = 'asset'
      return assetVal
    }
    if (presetVal !== undefined) {
      resolvedSettings[key] = presetVal
      fieldSources[key] = 'preset'
      return presetVal
    }
    resolvedSettings[key] = defaultVal
    fieldSources[key] = 'default'
    return defaultVal
  }

  // Resolve standard fields
  const defaultSpriteSize: SizePx =
    resolvedContentType === 'character' || resolvedContentType === 'animation'
      ? { w: 32, h: 48 }
      : { w: 32, h: 32 }

  resolveField<SizePx>(
    'spriteSize',
    'Kích thước sprite',
    form.spriteSize,
    hints.spriteSize,
    ctx.targetRevision?.canvasPx ?? ctx.targetClip?.canvasPx,
    ctx.preset?.defaultCanvasPx ?? ctx.project.defaultCanvasPx,
    defaultSpriteSize,
    sizeEqual
  )

  resolveField<'top-down' | '3/4' | 'side-view'>(
    'perspective',
    'Góc nhìn',
    form.perspective,
    undefined,
    undefined,
    ctx.preset?.perspective ?? ctx.project.defaultPerspective,
    '3/4'
  )

  const dirCount = resolveField<number>(
    'directionCount',
    'Số hướng',
    form.directionCount,
    hints.directionCount,
    undefined,
    undefined,
    resolvedContentType === 'animation' || hints.isCharacterWithWalk ? 4 : 1
  )

  resolveField<Direction[]>(
    'directions',
    'Danh sách hướng',
    form.directions,
    hints.directions,
    ctx.targetClip ? [ctx.targetClip.direction] : undefined,
    undefined,
    directionsFromCount(dirCount)
  )

  resolveField<number>(
    'framesPerDirection',
    'Số frame mỗi hướng',
    form.framesPerDirection,
    hints.framesPerDirection,
    ctx.targetClip?.frames.length || undefined,
    undefined,
    6
  )

  resolveField<number>(
    'fps',
    'FPS cơ sở',
    form.fps,
    hints.fps,
    ctx.targetClip?.fps,
    undefined,
    8
  )

  resolveField<LoopMode>(
    'loopMode',
    'Kiểu lặp',
    form.loopMode,
    hints.loopMode,
    ctx.targetClip?.loopMode,
    undefined,
    'loop'
  )

  resolveField<number>(
    'tileSizePx',
    'Kích thước tile',
    form.tileSizePx,
    hints.tileSizePx,
    undefined,
    ctx.project.tileSizePx,
    32
  )

  resolveField<{ cols: number; rows: number }>(
    'mapGrid',
    'Kích thước bản đồ (ô)',
    form.mapGrid,
    hints.mapGrid,
    undefined,
    undefined,
    { cols: 10, rows: 8 }
  )

  resolveField<{ w: number; h: number }>(
    'footprintTiles',
    'Footprint (ô)',
    form.footprintTiles,
    hints.footprintTiles,
    ctx.targetRevision?.footprintTiles ?? undefined,
    undefined,
    { w: 1, h: 1 }
  )

  resolveField<string>(
    'action',
    'Hành động',
    form.action,
    hints.action,
    ctx.targetClip?.action,
    undefined,
    'walk'
  )

  resolveField<boolean>(
    'enforcePalette',
    'Ràng buộc palette',
    form.enforcePalette,
    undefined,
    undefined,
    ctx.preset?.enforcePalette,
    true
  )

  resolveField<number>(
    'variantCount',
    'Số phương án',
    form.variantCount,
    undefined,
    undefined,
    undefined,
    1
  )

  // Check @mentions or duplicate name mentions for disambiguation
  const folderMap = new Map(ctx.folders.map((f) => [f.id, f.name]))
  const activeAssets = ctx.assets.filter((a) => !a.trashedAt)
  const disambiguations: DisambiguationRequest[] = []

  for (const mention of hints.mentions) {
    const q = mention.toLowerCase()
    const matches = activeAssets.filter(
      (a) =>
        a.assetId.toLowerCase() === q ||
        a.slug.toLowerCase() === q ||
        a.name.toLowerCase().includes(q)
    )
    if (matches.length > 1) {
      const selected = ctx.disambiguationSelections?.[mention] ?? null
      disambiguations.push({
        mentionText: mention,
        candidates: matches.map((a) => ({
          assetId: a.assetId,
          name: a.name,
          type: a.type,
          folderName: (a.folderId && folderMap.get(a.folderId)) || 'Gốc',
          revisionId: a.approvedRevisionId ?? a.latestRevisionId
        })),
        selectedAssetId: selected
      })
    }
  }

  const unresolvedConflicts = conflicts.filter((c) => c.resolvedChoice === null)
  const unresolvedDisambiguations = disambiguations.filter((d) => d.selectedAssetId === null)

  return {
    resolvedContentType,
    resolvedSettings,
    fieldSources,
    conflicts,
    unresolvedConflicts,
    disambiguations,
    unresolvedDisambiguations,
    hints,
    canExecute: unresolvedConflicts.length === 0 && unresolvedDisambiguations.length === 0
  }
}

export function buildDeterministicWorkflowPlan(
  form: PromptFormState,
  resolution: ResolutionResult,
  ctx: ResolveContext,
  planId: string
): WorkflowPlan {
  const settings = resolution.resolvedSettings
  const resolvedContentType = resolution.resolvedContentType
  const spriteSize = settings.spriteSize as SizePx
  const directions = (settings.directions as Direction[]) || ['down']
  const framesPerDir = (settings.framesPerDirection as number) || 6
  const fps = (settings.fps as number) || 8
  const loopMode = (settings.loopMode as LoopMode) || 'loop'
  const tileSizePx = (settings.tileSizePx as number) || ctx.project.tileSizePx || 32
  const mapGrid = (settings.mapGrid as { cols: number; rows: number }) || { cols: 10, rows: 8 }
  const action = (settings.action as string) || 'walk'
  const enforcePalette = Boolean(settings.enforcePalette)
  const variantCount = (settings.variantCount as number) || 1
  const steps: WorkflowStep[] = []

  // Case 1: Pure deterministic local edit (0 image calls!)
  if (resolution.hints.deterministicEdit) {
    const det = resolution.hints.deterministicEdit
    steps.push({
      id: 'local_edit_1',
      title: det.summary,
      kind: 'deterministic',
      operation: det.operation,
      dependsOn: [],
      enabled: true,
      scope:
        det.operation === 'update_clip_timing'
          ? 'clip'
          : det.operation === 'move_map_placement'
            ? 'map_placement'
            : 'asset',
      targetAssetId: ctx.targetAsset?.assetId ?? null,
      targetClipId: ctx.targetClip?.clipId ?? null,
      targetFrameIndex: null,
      sourceRevisionId: ctx.targetRevision?.revisionId ?? null,
      settings: {
        ...det.params,
        promptText: form.promptText
      },
      validation: {}
    })
  }
  // Case 2: Edit mode on specific frame or mask region
  else if (form.mode === 'edit' && ctx.targetClip && ctx.targetFrameIndex !== null) {
    steps.push({
      id: 'edit_frame_slot',
      title: ctx.hasMask
        ? `Chỉnh vùng mask trên frame ${ctx.targetFrameIndex + 1} của clip ${ctx.targetClip.name}`
        : `Tạo lại frame ${ctx.targetFrameIndex + 1} của clip ${ctx.targetClip.name}`,
      kind: 'ai_image',
      operation: ctx.hasMask ? 'inpaint_region' : 'regenerate_frame',
      dependsOn: [],
      enabled: true,
      scope: ctx.hasMask ? 'mask_region' : 'frame',
      targetAssetId: ctx.targetClip.assetId,
      targetClipId: ctx.targetClip.clipId,
      targetFrameIndex: ctx.targetFrameIndex,
      sourceRevisionId:
        ctx.targetClip.frames[ctx.targetFrameIndex]?.revisionId ??
        ctx.targetRevision?.revisionId ??
        null,
      settings: {
        promptText: form.promptText,
        canvasPx: ctx.targetClip.canvasPx,
        enforcePalette
      },
      validation: { preserveOutsideMask: ctx.hasMask }
    })
  } else if (form.mode === 'edit' && ctx.targetAsset && ctx.hasMask) {
    steps.push({
      id: 'inpaint_sprite',
      title: `Chỉnh vùng mask trên ${ctx.targetAsset.name}`,
      kind: 'ai_image',
      operation: 'inpaint_region',
      dependsOn: [],
      enabled: true,
      scope: 'mask_region',
      targetAssetId: ctx.targetAsset.assetId,
      targetClipId: null,
      targetFrameIndex: null,
      sourceRevisionId: ctx.targetRevision?.revisionId ?? ctx.targetAsset.approvedRevisionId,
      settings: {
        promptText: form.promptText,
        canvasPx: spriteSize,
        enforcePalette
      },
      validation: { preserveOutsideMask: true }
    })
  }
  // Case 3: Multi-output workshop room (A06)
  else if (resolution.hints.isMultiOutputRoom) {
    steps.push(
      {
        id: 'room_tileset',
        title: `Tạo tileset phòng (${tileSizePx}×${tileSizePx})`,
        kind: 'ai_image',
        operation: 'generate_tileset',
        dependsOn: [],
        enabled: true,
        scope: 'asset',
        targetAssetId: null,
        targetClipId: null,
        targetFrameIndex: null,
        sourceRevisionId: null,
        settings: {
          name: 'Tileset Xưởng mộc',
          tileSizePx,
          promptText: form.promptText,
          enforcePalette
        },
        validation: {}
      },
      {
        id: 'room_table',
        title: 'Tạo nội thất: Bàn (2×1 ô)',
        kind: 'ai_image',
        operation: 'generate_furniture',
        dependsOn: [],
        enabled: true,
        scope: 'asset',
        targetAssetId: null,
        targetClipId: null,
        targetFrameIndex: null,
        sourceRevisionId: null,
        settings: {
          name: 'Bàn gỗ',
          footprintTiles: { w: 2, h: 1 },
          canvasPx: { w: tileSizePx * 2, h: Math.round(tileSizePx * 1.5) },
          promptText: 'Bàn thợ mộc bằng gỗ tự nhiên, pixel art 3/4',
          enforcePalette
        },
        validation: {}
      },
      {
        id: 'room_chair',
        title: 'Tạo nội thất: Ghế (1×1 ô)',
        kind: 'ai_image',
        operation: 'generate_furniture',
        dependsOn: [],
        enabled: true,
        scope: 'asset',
        targetAssetId: null,
        targetClipId: null,
        targetFrameIndex: null,
        sourceRevisionId: null,
        settings: {
          name: 'Ghế gỗ',
          footprintTiles: { w: 1, h: 1 },
          canvasPx: { w: tileSizePx, h: tileSizePx },
          promptText: 'Ghế gỗ xưởng mộc, pixel art 3/4',
          enforcePalette
        },
        validation: {}
      },
      {
        id: 'room_cabinet',
        title: 'Tạo nội thất: Tủ gỗ (2×1 ô ngang)',
        kind: 'ai_image',
        operation: 'generate_furniture',
        dependsOn: [],
        enabled: true,
        scope: 'asset',
        targetAssetId: null,
        targetClipId: null,
        targetFrameIndex: null,
        sourceRevisionId: null,
        settings: {
          name: 'Tủ gỗ',
          footprintTiles: resolution.hints.footprintTiles ?? { w: 2, h: 1 },
          canvasPx: { w: tileSizePx * 2, h: Math.round(tileSizePx * 1.5) },
          promptText: 'Tủ gỗ dụng cụ hai ô ngang, pixel art 3/4',
          enforcePalette
        },
        validation: {}
      },
      {
        id: 'room_cabinet_open_clip',
        title: `Tạo clip mở tủ (${framesPerDir} frame)`,
        kind: 'ai_image',
        operation: 'generate_animation',
        dependsOn: ['room_cabinet'],
        enabled: true,
        scope: 'clip',
        targetAssetId: null,
        targetClipId: null,
        targetFrameIndex: null,
        sourceRevisionId: null,
        settings: {
          sourceStepId: 'room_cabinet',
          action: 'open',
          directions: ['down'],
          framesPerDirection: framesPerDir,
          fps: 10,
          frameDurationMs: 100,
          loopMode: 'once',
          frameWidth: tileSizePx * 2,
          frameHeight: Math.round(tileSizePx * 1.5),
          promptText: 'Clip mở cánh cửa tủ gỗ',
          enforcePalette
        },
        validation: {}
      },
      {
        id: 'room_map',
        title: `Dựng bản đồ xưởng mộc (${mapGrid.cols}×${mapGrid.rows} ô)`,
        kind: 'ai_plan',
        operation: 'generate_map_layout',
        dependsOn: ['room_tileset', 'room_table', 'room_chair', 'room_cabinet'],
        enabled: true,
        scope: 'asset',
        targetAssetId: null,
        targetClipId: null,
        targetFrameIndex: null,
        sourceRevisionId: null,
        settings: {
          name: 'Bản đồ Xưởng mộc',
          cols: mapGrid.cols,
          rows: mapGrid.rows,
          tileSizePx,
          doorEdge: /phía\s*dưới|cạnh\s*dưới|bottom/i.test(form.promptText) ? 'bottom' : 'bottom',
          tilesetStepId: 'room_tileset',
          placeFromSteps: ['room_table', 'room_chair', 'room_cabinet'],
          promptText: form.promptText
        },
        validation: {}
      }
    )
  }
  // Case 4: Character + Multi-direction walk animation (A03)
  else if (resolution.hints.isCharacterWithWalk && form.mode === 'create') {
    steps.push(
      {
        id: 'base_character',
        title: `Tạo nhân vật gốc (${spriteSize.w}×${spriteSize.h})`,
        kind: 'ai_image',
        operation: 'generate_sprite',
        dependsOn: [],
        enabled: true,
        scope: 'asset',
        targetAssetId: null,
        targetClipId: null,
        targetFrameIndex: null,
        sourceRevisionId: null,
        settings: {
          assetType: 'character',
          promptText: form.promptText,
          canvasPx: spriteSize,
          perspective: settings.perspective,
          enforcePalette,
          variantCount
        },
        validation: {}
      },
      {
        id: 'character_walk_clips',
        title: `Tạo bộ clip ${action} (${directions.length} hướng × ${framesPerDir} frame)`,
        kind: 'ai_image',
        operation: 'generate_animation',
        dependsOn: ['base_character'],
        enabled: true,
        scope: 'clip',
        targetAssetId: null,
        targetClipId: null,
        targetFrameIndex: null,
        sourceRevisionId: null,
        settings: {
          sourceStepId: 'base_character',
          action,
          directions,
          framesPerDirection: framesPerDir,
          fps,
          frameDurationMs: fpsToFrameDurationMs(fps),
          loopMode,
          frameWidth: spriteSize.w,
          frameHeight: spriteSize.h,
          promptText: form.promptText,
          enforcePalette
        },
        validation: { maxAnchorDriftPx: 2 }
      }
    )
  }
  // Case 5: Single content type operations
  else if (resolvedContentType === 'animation') {
    steps.push({
      id: 'anim_step',
      title: `Tạo clip ${action} (${directions.length} hướng × ${framesPerDir} frame)`,
      kind: 'ai_image',
      operation: 'generate_animation',
      dependsOn: [],
      enabled: true,
      scope: 'clip',
      targetAssetId: ctx.targetAsset?.assetId ?? null,
      targetClipId: null,
      targetFrameIndex: null,
      sourceRevisionId: ctx.targetAsset?.approvedRevisionId ?? ctx.targetRevision?.revisionId ?? null,
      settings: {
        action,
        directions,
        framesPerDirection: framesPerDir,
        fps,
        frameDurationMs: fpsToFrameDurationMs(fps),
        loopMode,
        frameWidth: spriteSize.w,
        frameHeight: spriteSize.h,
        promptText: form.promptText,
        enforcePalette
      },
      validation: { maxAnchorDriftPx: 2 }
    })
  } else if (resolvedContentType === 'tileset') {
    steps.push({
      id: 'tileset_step',
      title: `Tạo tileset ${tileSizePx}×${tileSizePx}`,
      kind: 'ai_image',
      operation: 'generate_tileset',
      dependsOn: [],
      enabled: true,
      scope: 'asset',
      targetAssetId: null,
      targetClipId: null,
      targetFrameIndex: null,
      sourceRevisionId: null,
      settings: {
        tileSizePx,
        promptText: form.promptText,
        enforcePalette
      },
      validation: {}
    })
  } else if (resolvedContentType === 'map') {
    steps.push({
      id: 'map_step',
      title: `Dựng bản đồ ${mapGrid.cols}×${mapGrid.rows} ô`,
      kind: 'ai_plan',
      operation: 'generate_map_layout',
      dependsOn: [],
      enabled: true,
      scope: 'asset',
      targetAssetId: null,
      targetClipId: null,
      targetFrameIndex: null,
      sourceRevisionId: null,
      settings: {
        cols: mapGrid.cols,
        rows: mapGrid.rows,
        tileSizePx,
        promptText: form.promptText
      },
      validation: {}
    })
  } else if (resolvedContentType === 'dialogue_quest') {
    const isTable = /bảng\s*chỉ\s*số|table|giá\s*trị\s*vật\s*phẩm/i.test(form.promptText)
    const isQuest = /nhiệm\s*vụ|quest/i.test(form.promptText)
    const isDialogue = /hội\s*thoại|dialogue/i.test(form.promptText)
    if (isTable) {
      steps.push({
        id: 'data_table_step',
        title: 'Tạo bảng chỉ số vật phẩm',
        kind: 'ai_plan',
        operation: 'generate_data_table',
        dependsOn: [],
        enabled: true,
        scope: 'asset',
        targetAssetId: null,
        targetClipId: null,
        targetFrameIndex: null,
        sourceRevisionId: null,
        settings: { promptText: form.promptText },
        validation: {}
      })
    } else {
      if (isDialogue || !isQuest) {
        steps.push({
          id: 'dialogue_step',
          title: 'Tạo đồ thị hội thoại nhiều node',
          kind: 'ai_plan',
          operation: 'generate_dialogue',
          dependsOn: [],
          enabled: true,
          scope: 'asset',
          targetAssetId: ctx.targetAsset?.assetId ?? null,
          targetClipId: null,
          targetFrameIndex: null,
          sourceRevisionId: null,
          settings: { promptText: form.promptText, npcAssetId: ctx.targetAsset?.assetId ?? null },
          validation: {}
        })
      }
      if (isQuest) {
        steps.push({
          id: 'quest_step',
          title: 'Tạo nhiệm vụ có điều kiện và phần thưởng',
          kind: 'ai_plan',
          operation: 'generate_quest',
          dependsOn: [],
          enabled: true,
          scope: 'asset',
          targetAssetId: ctx.targetAsset?.assetId ?? null,
          targetClipId: null,
          targetFrameIndex: null,
          sourceRevisionId: null,
          settings: { promptText: form.promptText, npcAssetId: ctx.targetAsset?.assetId ?? null },
          validation: {}
        })
      }
    }
  } else if (resolvedContentType === 'ui_vfx') {
    const isVfx = /vfx|hiệu\s*ứng|bụi|khói|tia\s*sáng/i.test(form.promptText)
    const isStoryboard = /storyboard|cutscene/i.test(form.promptText)
    const isScreen = /bố\s*cục|màn\s*ui|layout/i.test(form.promptText)
    const isIconSet = /bộ\s*icon|icon\s*set/i.test(form.promptText)
    steps.push({
      id: 'ui_vfx_step',
      title: isStoryboard
        ? 'Tạo storyboard / cutscene'
        : isVfx
          ? `Tạo clip VFX (${framesPerDir} frame)`
          : isScreen
            ? 'Tạo bố cục màn hình UI'
            : isIconSet
              ? 'Tạo bộ icon giao diện'
              : 'Tạo phần tử UI pixel art',
      kind: isStoryboard || isScreen ? 'ai_plan' : 'ai_image',
      operation: isStoryboard
        ? 'generate_storyboard'
        : isVfx
          ? 'generate_vfx'
          : isScreen
            ? 'generate_ui_screen'
            : isIconSet
              ? 'generate_ui_icon_set'
              : 'generate_ui_element',
      dependsOn: [],
      enabled: true,
      scope: 'asset',
      targetAssetId: null,
      targetClipId: null,
      targetFrameIndex: null,
      sourceRevisionId: null,
      settings: {
        promptText: form.promptText,
        canvasPx: spriteSize,
        framesPerDirection: framesPerDir,
        fps,
        loopMode,
        enforcePalette
      },
      validation: {}
    })
  } else if (resolvedContentType === 'furniture_item') {
    const isIcon = /icon\s*túi\s*đồ|inventory\s*icon/i.test(form.promptText)
    const isItem = /búa|công\s*cụ|vật\s*phẩm|đạo\s*cụ|item|tool/i.test(form.promptText)
    steps.push({
      id: 'furniture_item_step',
      title: isIcon ? 'Tạo icon túi đồ' : isItem ? 'Tạo sprite vật phẩm / công cụ' : 'Tạo đồ nội thất có footprint',
      kind: 'ai_image',
      operation: isIcon ? 'generate_icon' : isItem ? 'generate_item' : 'generate_furniture',
      dependsOn: [],
      enabled: true,
      scope: 'asset',
      targetAssetId: ctx.targetAsset?.assetId ?? null,
      targetClipId: null,
      targetFrameIndex: null,
      sourceRevisionId: ctx.targetRevision?.revisionId ?? null,
      settings: {
        promptText: form.promptText,
        canvasPx: isIcon ? { w: 16, h: 16 } : spriteSize,
        footprintTiles: settings.footprintTiles,
        enforcePalette,
        variantCount
      },
      validation: {}
    })
  } else {
    const isPortrait = /chân\s*dung|portrait/i.test(form.promptText)
    const isOutfit = /trang\s*phục|phụ\s*kiện|tạp\s*dề\s*riêng|outfit/i.test(form.promptText)
    steps.push({
      id: 'sprite_step',
      title: isPortrait
        ? 'Tạo chân dung đối thoại'
        : isOutfit
          ? 'Tạo lớp trang phục / phụ kiện'
          : `Tạo sprite nhân vật (${spriteSize.w}×${spriteSize.h})`,
      kind: 'ai_image',
      operation: isPortrait ? 'generate_portrait' : isOutfit ? 'generate_outfit' : 'generate_sprite',
      dependsOn: [],
      enabled: true,
      scope: 'asset',
      targetAssetId: ctx.targetAsset?.assetId ?? null,
      targetClipId: null,
      targetFrameIndex: null,
      sourceRevisionId: ctx.targetRevision?.revisionId ?? null,
      settings: {
        assetType: 'character',
        promptText: form.promptText,
        canvasPx: spriteSize,
        perspective: settings.perspective,
        enforcePalette,
        variantCount
      },
      validation: {}
    })
  }

  // Compute summary
  let clips = 0
  let frames = 0
  let imageApiCalls = 0
  let planApiCalls = 0
  let localSteps = 0

  for (const s of steps) {
    if (!s.enabled) continue
    if (s.kind === 'deterministic') {
      localSteps += 1
    } else if (s.kind === 'ai_plan') {
      planApiCalls += 1
    } else if (s.kind === 'ai_image') {
      if (s.operation === 'generate_animation') {
        const dirs = (s.settings.directions as Direction[]) || ['down']
        const fpd = (s.settings.framesPerDirection as number) || 6
        clips += dirs.length
        frames += dirs.length * fpd
        imageApiCalls += dirs.length
      } else {
        const vc = (s.settings.variantCount as number) || 1
        imageApiCalls += vc
      }
    }
  }

  return {
    schemaVersion: 1,
    planId,
    projectId: ctx.project.projectId,
    mode: form.mode,
    promptText: form.promptText,
    resolvedConflicts: resolution.conflicts,
    disambiguations: resolution.disambiguations,
    estimatedSummary: {
      outputs: steps.filter((s) => s.enabled).length,
      clips,
      frames,
      imageApiCalls,
      planApiCalls,
      localSteps
    },
    steps
  }
}
