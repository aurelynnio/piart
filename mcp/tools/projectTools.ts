import { z } from 'zod'
import { makeId } from '../../app/main/db/projectStore'
import type { Palette, StylePreset } from '@domain/schemas/types'
import type { PiartMcpContext } from '../context'

export function registerProjectTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'studio_status',
    {
      title: 'Trạng thái AI Pixel Studio',
      description:
        'Lấy trạng thái tổng quan của AI Pixel Studio: cấu hình provider (openai/mock), chế độ ngoại tuyến, danh sách model, dự án gần đây và tóm tắt dự án đang mở.',
      annotations: { readOnlyHint: true }
    },
    () => {
      const boot = ctx.service.getAppBootstrap()
      return {
        settings: boot.settings,
        providerKeys: boot.providerKeys,
        capabilities: boot.capabilities,
        sampleWorkshopAvailable: boot.sampleWorkshopAvailable,
        currentProject: boot.currentProject ? ctx.summarizeProject(boot.currentProject) : null
      }
    }
  )

  ctx.registerTool(
    'project_create',
    {
      title: 'Tạo dự án mới',
      description:
        'Tạo và mở một dự án AI Pixel Studio cục bộ mới (SQLite WAL + blobs) tại thư mục rootDir. Hỗ trợ đường dẫn tiếng Việt và khoảng trắng.',
      inputSchema: {
        name: z.string().min(1).max(160).describe('Tên dự án'),
        rootDir: z.string().min(1).describe('Đường dẫn thư mục lưu dự án'),
        tileSizePx: z.number().int().min(8).max(256).optional().describe('Kích thước ô tile mặc định (px), VD: 32'),
        pixelsPerUnit: z.number().int().min(1).max(512).optional().describe('Pixels Per Unit cho Unity, VD: 32'),
        defaultCanvasW: z.number().int().min(8).max(512).optional().describe('Chiều rộng sprite mặc định (px)'),
        defaultCanvasH: z.number().int().min(8).max(512).optional().describe('Chiều cao sprite mặc định (px)'),
        defaultPerspective: z.enum(['top-down', '3/4', 'side-view']).optional().describe('Góc nhìn mặc định')
      }
    },
    async (args) => {
      const state = await ctx.service.createProject({
        name: args.name,
        rootDir: args.rootDir,
        tileSizePx: args.tileSizePx,
        pixelsPerUnit: args.pixelsPerUnit,
        defaultCanvasPx:
          args.defaultCanvasW && args.defaultCanvasH
            ? { w: args.defaultCanvasW, h: args.defaultCanvasH }
            : undefined,
        defaultPerspective: args.defaultPerspective
      })
      return { ok: true, project: ctx.summarizeProject(state) }
    }
  )

  ctx.registerTool(
    'project_open',
    {
      title: 'Mở dự án cục bộ',
      description: 'Mở một dự án AI Pixel Studio đã có (chứa studio.sqlite) theo đường dẫn thư mục.',
      inputSchema: {
        rootDir: z.string().min(1).describe('Thư mục dự án chứa studio.sqlite')
      }
    },
    async (args) => {
      const state = await ctx.service.openProject(args.rootDir)
      return { ok: true, project: ctx.summarizeProject(state) }
    }
  )

  ctx.registerTool(
    'project_open_sample_workshop',
    {
      title: 'Mở bản sao Dự án mẫu Xưởng mộc',
      description:
        'Sao chép dự án mẫu nguyên gốc "Xưởng mộc" sang thư mục làm việc targetDir và mở dự án (không làm thay đổi bản mẫu gốc).',
      inputSchema: {
        targetDir: z.string().min(1).describe('Thư mục đích để sao chép bản làm việc của dự án mẫu')
      }
    },
    async (args) => {
      const state = await ctx.service.openSampleWorkshop(args.targetDir)
      return { ok: true, project: ctx.summarizeProject(state) }
    }
  )

  ctx.registerTool(
    'project_close',
    {
      title: 'Đóng dự án hiện tại',
      description: 'Đóng kết nối SQLite của dự án đang mở.'
    },
    () => {
      ctx.service.closeProject()
      return { ok: true, closed: true }
    }
  )

  ctx.registerTool(
    'project_get_summary',
    {
      title: 'Tóm tắt dự án đang mở',
      description:
        'Lấy cấu hình dự án, danh sách bảng màu (palettes), style presets, thư mục (folders) và thống kê số lượng tài nguyên.',
      annotations: { readOnlyHint: true }
    },
    () => {
      const state = ctx.service.requireStore().getFullState()
      return {
        summary: ctx.summarizeProject(state),
        config: state.config,
        palettes: state.palettes,
        presets: state.presets,
        folders: state.folders
      }
    }
  )

  ctx.registerTool(
    'project_update_config',
    {
      title: 'Cập nhật cấu hình dự án',
      description: 'Cập nhật các thuộc tính cấu hình dự án (tên, tileSizePx, pixelsPerUnit, defaultPerspective, activePaletteId, activePresetId...).',
      inputSchema: {
        name: z.string().min(1).max(160).optional(),
        tileSizePx: z.number().int().min(8).max(256).optional(),
        pixelsPerUnit: z.number().int().min(1).max(512).optional(),
        defaultCanvasW: z.number().int().min(8).max(512).optional(),
        defaultCanvasH: z.number().int().min(8).max(512).optional(),
        defaultPerspective: z.enum(['top-down', '3/4', 'side-view']).optional(),
        activePaletteId: z.string().nullable().optional(),
        activePresetId: z.string().nullable().optional()
      }
    },
    (args) => {
      const patch: Record<string, unknown> = {}
      if (args.name !== undefined) patch.name = args.name
      if (args.tileSizePx !== undefined) patch.tileSizePx = args.tileSizePx
      if (args.pixelsPerUnit !== undefined) patch.pixelsPerUnit = args.pixelsPerUnit
      if (args.defaultCanvasW !== undefined && args.defaultCanvasH !== undefined) {
        patch.defaultCanvasPx = { w: args.defaultCanvasW, h: args.defaultCanvasH }
      }
      if (args.defaultPerspective !== undefined) patch.defaultPerspective = args.defaultPerspective
      if (args.activePaletteId !== undefined) patch.activePaletteId = args.activePaletteId
      if (args.activePresetId !== undefined) patch.activePresetId = args.activePresetId

      const state = ctx.service.updateProjectConfig(patch)
      return { ok: true, config: state.config }
    }
  )

  ctx.registerTool(
    'project_upsert_palette',
    {
      title: 'Tạo hoặc cập nhật bảng màu (Palette)',
      description: 'Tạo mới hoặc cập nhật bảng màu pixel art cho dự án, có thể đặt làm bảng màu hoạt động (setActive=true).',
      inputSchema: {
        id: z.string().optional().describe('ID bảng màu (bỏ trống để tự sinh mới)'),
        name: z.string().min(1).describe('Tên bảng màu'),
        colors: z
          .array(
            z.object({
              hex: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/),
              name: z.string().min(1),
              locked: z.boolean().optional().default(false)
            })
          )
          .min(1),
        setActive: z.boolean().optional().default(false)
      }
    },
    (args) => {
      const now = new Date().toISOString()
      const palette: Palette = {
        id: args.id || makeId('pal'),
        name: args.name,
        colors: args.colors.map((c) => ({ hex: c.hex.toUpperCase(), name: c.name, locked: c.locked })),
        createdAt: now,
        updatedAt: now
      }
      const state = ctx.service.upsertPalette(palette, args.setActive)
      return { ok: true, palette, activePaletteId: state.config.activePaletteId }
    }
  )

  ctx.registerTool(
    'project_upsert_preset',
    {
      title: 'Tạo hoặc cập nhật StylePreset',
      description: 'Tạo mới hoặc cập nhật StylePreset của dự án (góc nhìn, kích thước mặc định, phong cách viền/bóng, ghi chú phong cách).',
      inputSchema: {
        id: z.string().optional(),
        name: z.string().min(1),
        perspective: z.enum(['top-down', '3/4', 'side-view']).default('3/4'),
        defaultCanvasW: z.number().int().min(8).max(512).default(32),
        defaultCanvasH: z.number().int().min(8).max(512).default(48),
        paletteId: z.string().nullable().optional(),
        outlineStyle: z.enum(['dark', 'colored', 'none']).default('dark'),
        shadingStyle: z.enum(['flat', 'cel', 'dithered']).default('cel'),
        enforcePalette: z.boolean().optional().default(true),
        notes: z.string().optional().default(''),
        setActive: z.boolean().optional().default(false)
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const existing = args.id ? store.getEntity<StylePreset>('preset', args.id) : null
      const now = new Date().toISOString()
      const preset: StylePreset = {
        id: args.id || makeId('prs'),
        name: args.name,
        version: existing?.version ?? 0,
        perspective: args.perspective,
        defaultCanvasPx: { w: args.defaultCanvasW, h: args.defaultCanvasH },
        paletteId: args.paletteId ?? store.getProjectConfig().activePaletteId ?? null,
        outlineStyle: args.outlineStyle,
        shadingStyle: args.shadingStyle,
        enforcePalette: args.enforcePalette,
        notes: args.notes,
        referenceImageIds: existing?.referenceImageIds ?? [],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      const state = ctx.service.upsertPreset(preset, args.setActive)
      return {
        ok: true,
        preset: state.presets.find((p) => p.id === preset.id),
        activePresetId: state.config.activePresetId
      }
    }
  )

  ctx.registerTool(
    'project_add_reference_image',
    {
      title: 'Thêm ảnh tham chiếu phong cách',
      description: 'Nhập ảnh PNG tham chiếu (từ filePath hoặc pngBase64) và tùy chọn gắn vào StylePreset.',
      inputSchema: {
        name: z.string().min(1),
        role: z.enum(['style', 'proportion', 'palette', 'pose', 'general']).default('style'),
        filePath: z.string().optional().describe('Đường dẫn tệp PNG cục bộ'),
        pngBase64: z.string().optional().describe('Nội dung PNG dạng base64'),
        presetId: z.string().nullable().optional()
      }
    },
    (args) => {
      const pngBase64 = ctx.readPngBase64Input(args)
      const state = ctx.service.addReferenceImage({
        name: args.name,
        role: args.role,
        pngBase64,
        presetId: args.presetId
      })
      return { ok: true, referenceImagesCount: state.referenceImages.length, latest: state.referenceImages.at(-1) }
    }
  )

  ctx.registerTool(
    'project_backup_zip',
    {
      title: 'Sao lưu dự án ra tệp ZIP',
      description: 'Đóng gói toàn bộ dự án đang mở (SQLite + blobs + config, đã lọc bí mật) ra tệp .zip.',
      inputSchema: {
        targetZipPath: z.string().min(1).describe('Đường dẫn tệp .zip đầu ra')
      }
    },
    (args) => {
      const res = ctx.service.backupProject(args.targetZipPath)
      return { ok: true, backup: res }
    }
  )

  ctx.registerTool(
    'project_restore_zip',
    {
      title: 'Khôi phục dự án từ tệp ZIP',
      description: 'Giải nén, kiểm tra checksum và mở lại dự án từ tệp sao lưu .zip vào targetDir.',
      inputSchema: {
        zipPath: z.string().min(1),
        targetDir: z.string().min(1)
      }
    },
    async (args) => {
      const state = await ctx.service.restoreProject(args.zipPath, args.targetDir)
      return { ok: true, project: ctx.summarizeProject(state) }
    }
  )

  ctx.registerTool(
    'project_undo',
    {
      title: 'Hoàn tác (Undo)',
      description: 'Hoàn tác giao dịch gần nhất trong dự án đang mở (tương đương Ctrl+Z).'
    },
    () => {
      const res = ctx.service.undo()
      return {
        ok: true,
        applied: res.applied,
        label: res.label,
        undoRedo: res.state.undoRedo
      }
    }
  )

  ctx.registerTool(
    'project_redo',
    {
      title: 'Làm lại (Redo)',
      description: 'Làm lại giao dịch vừa hoàn tác trong dự án đang mở (tương đương Ctrl+Y).'
    },
    () => {
      const res = ctx.service.redo()
      return {
        ok: true,
        applied: res.applied,
        label: res.label,
        undoRedo: res.state.undoRedo
      }
    }
  )
}
