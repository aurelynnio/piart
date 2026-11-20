import { z } from 'zod'
import { makeId } from '../../app/main/db/projectStore'
import type { PromptFormState } from '@domain/rules/parameterResolver'
import type { ContentType, LoopMode } from '@domain/schemas/types'
import type { PiartMcpContext } from '../context'

const ContentTypeEnum = z.enum([
  'auto',
  'character',
  'furniture_item',
  'animation',
  'tileset',
  'map',
  'ui_vfx',
  'dialogue_quest',
  'content_pack'
])

const PromptFormInputShape = {
  mode: z.enum(['create', 'edit']).default('create'),
  contentType: ContentTypeEnum.default('auto'),
  promptText: z.string().min(1).describe('Prompt tiếng Việt hoặc tiếng Anh'),
  spriteWidth: z.number().int().min(8).max(512).optional(),
  spriteHeight: z.number().int().min(8).max(512).optional(),
  spriteSizeMode: z.enum(['auto', 'selected', 'project']).optional().default('auto'),
  directionCount: z.number().int().min(1).max(8).optional(),
  directionMode: z.enum(['auto', 'selected']).optional().default('auto'),
  framesPerDirection: z.number().int().min(1).max(32).optional(),
  framesMode: z.enum(['auto', 'selected']).optional().default('auto'),
  fps: z.number().min(1).max(60).optional(),
  fpsMode: z.enum(['auto', 'selected']).optional().default('auto'),
  loopMode: z.enum(['loop', 'once', 'ping_pong']).optional().default('loop'),
  tileSizePx: z.number().int().min(8).max(256).optional(),
  tileSizeMode: z.enum(['auto', 'selected', 'project']).optional().default('project'),
  mapCols: z.number().int().min(4).max(128).optional(),
  mapRows: z.number().int().min(4).max(128).optional(),
  enforcePalette: z.boolean().optional().default(true),
  variantCount: z.number().int().min(1).max(4).optional().default(1),
  targetAssetId: z.string().nullable().optional(),
  targetClipId: z.string().nullable().optional(),
  targetFrameIndex: z.number().int().min(0).nullable().optional(),
  conflictResolutions: z.record(z.enum(['form', 'prompt'])).optional(),
  disambiguationSelections: z.record(z.string()).optional()
}

function toPromptForm(args: {
  mode: 'create' | 'edit'
  contentType: ContentType
  promptText: string
  spriteWidth?: number
  spriteHeight?: number
  spriteSizeMode: 'auto' | 'selected' | 'project'
  directionCount?: number
  directionMode: 'auto' | 'selected'
  framesPerDirection?: number
  framesMode: 'auto' | 'selected'
  fps?: number
  fpsMode: 'auto' | 'selected'
  loopMode: LoopMode
  tileSizePx?: number
  tileSizeMode: 'auto' | 'selected' | 'project'
  mapCols?: number
  mapRows?: number
  enforcePalette: boolean
  variantCount: number
}): PromptFormState {
  const effectiveSpriteMode =
    args.spriteWidth !== undefined && args.spriteHeight !== undefined && args.spriteSizeMode === 'auto'
      ? 'selected'
      : args.spriteSizeMode

  return {
    mode: args.mode,
    contentType: args.contentType,
    promptText: args.promptText,
    spriteSize: {
      value: { w: args.spriteWidth ?? 32, h: args.spriteHeight ?? 48 },
      mode: effectiveSpriteMode
    },
    directionCount: {
      value: args.directionCount ?? 4,
      mode: args.directionCount !== undefined ? 'selected' : args.directionMode
    },
    framesPerDirection: {
      value: args.framesPerDirection ?? 6,
      mode: args.framesPerDirection !== undefined ? 'selected' : args.framesMode
    },
    fps: {
      value: args.fps ?? 8,
      mode: args.fps !== undefined ? 'selected' : args.fpsMode
    },
    loopMode: { value: args.loopMode, mode: 'auto' },
    tileSizePx: {
      value: args.tileSizePx ?? 32,
      mode: args.tileSizePx !== undefined ? 'selected' : args.tileSizeMode
    },
    mapGrid: {
      value: { cols: args.mapCols ?? 10, rows: args.mapRows ?? 8 },
      mode: args.mapCols !== undefined || args.mapRows !== undefined ? 'selected' : 'auto'
    },
    enforcePalette: { value: args.enforcePalette, mode: 'selected' },
    variantCount: { value: args.variantCount, mode: 'selected' }
  }
}

export function registerPromptTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'prompt_preview_plan',
    {
      title: 'Phân tích Prompt & Xem trước kế hoạch thực thi',
      description:
        'Chạy ParameterResolver và dựng kế hoạch DAG nhiều bước (0 lượt gọi API ảnh). Trả về các thông số đã chốt, xung đột (conflicts) và đối tượng trùng tên (disambiguations) nếu có.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        ...PromptFormInputShape,
        hasMask: z.boolean().optional().default(false)
      }
    },
    (args) => {
      const form = toPromptForm(args)
      const res = ctx.service.resolveAndPreviewPlan({
        form,
        targetAssetId: args.targetAssetId ?? null,
        targetClipId: args.targetClipId ?? null,
        targetFrameIndex: args.targetFrameIndex ?? null,
        hasMask: args.hasMask,
        conflictResolutions: args.conflictResolutions,
        disambiguationSelections: args.disambiguationSelections
      })
      return res
    }
  )

  ctx.registerTool(
    'prompt_run_workflow',
    {
      title: 'Thực thi luồng Tạo mới / Sửa mục tiêu bằng Prompt',
      description:
        'Thực thi kế hoạch tạo mới hoặc chỉnh sửa (hỗ trợ cả lệnh thuần dữ liệu như đổi tốc độ clip 0 lượt gọi ảnh, chỉnh 1 frame bằng mask từ maskFilePath/maskPngBase64, và sinh tài nguyên nhiều bước).',
      inputSchema: {
        ...PromptFormInputShape,
        maskFilePath: z.string().optional().describe('Đường dẫn tệp PNG mask cho inpaint'),
        maskPngBase64: z.string().optional().describe('Nội dung PNG mask dạng base64'),
        idempotencySalt: z.string().optional()
      }
    },
    async (args) => {
      const form = toPromptForm(args)
      const maskPngBase64 =
        args.maskFilePath || args.maskPngBase64
          ? ctx.readPngBase64Input({ filePath: args.maskFilePath, pngBase64: args.maskPngBase64 })
          : null

      const res = await ctx.service.runPromptWorkflow({
        form,
        targetAssetId: args.targetAssetId ?? null,
        targetClipId: args.targetClipId ?? null,
        targetFrameIndex: args.targetFrameIndex ?? null,
        maskPngBase64,
        conflictResolutions: args.conflictResolutions,
        disambiguationSelections: args.disambiguationSelections,
        idempotencySalt: args.idempotencySalt
      })
      return {
        ok: res.job.status === 'succeeded',
        job: res.job,
        outputAssetIds: res.job.steps.flatMap((s) => s.outputAssetIds),
        outputClipIds: res.job.steps.flatMap((s) => s.outputClipIds)
      }
    }
  )

  ctx.registerTool(
    'prompt_template_list',
    {
      title: 'Liệt kê mẫu Prompt đã lưu',
      description: 'Xem toàn bộ mẫu prompt (PromptTemplates) trong dự án đang mở.',
      annotations: { readOnlyHint: true }
    },
    () => {
      const state = ctx.service.requireStore().getFullState()
      return { total: state.promptTemplates.length, templates: state.promptTemplates }
    }
  )

  ctx.registerTool(
    'prompt_template_save',
    {
      title: 'Lưu mẫu Prompt',
      description: 'Tạo mới hoặc cập nhật một mẫu prompt trong dự án.',
      inputSchema: {
        templateId: z.string().optional(),
        name: z.string().min(1),
        category: ContentTypeEnum.default('auto'),
        promptText: z.string().min(1),
        options: z.record(z.unknown()).optional().default({})
      }
    },
    (args) => {
      const now = new Date().toISOString()
      const templateId = args.templateId || makeId('tpl')
      ctx.service.savePromptTemplate({
        templateId,
        name: args.name,
        category: args.category,
        promptText: args.promptText,
        options: args.options,
        createdAt: now,
        updatedAt: now
      })
      return { ok: true, templateId }
    }
  )

  ctx.registerTool(
    'prompt_template_delete',
    {
      title: 'Xóa mẫu Prompt',
      description: 'Xóa một mẫu prompt theo templateId.',
      inputSchema: {
        templateId: z.string().min(1)
      }
    },
    (args) => {
      ctx.service.deletePromptTemplate(args.templateId)
      return { ok: true, deletedTemplateId: args.templateId }
    }
  )
}
