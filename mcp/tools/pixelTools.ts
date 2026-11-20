import { z } from 'zod'
import {
  analyzeSpriteMetrics,
  createBlankImage,
  decodePng,
  drawOutline,
  encodePng,
  fillRect,
  hexToRgba,
  setPixel
} from '../../app/main/imaging/pixelEngine'
import type { Asset, Palette } from '@domain/schemas/types'
import type { PiartMcpContext } from '../context'

const PaintOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set_pixel'),
    x: z.number().int(),
    y: z.number().int(),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
  }),
  z.object({
    op: z.literal('fill_rect'),
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
  }),
  z.object({
    op: z.literal('line'),
    x0: z.number().int(),
    y0: z.number().int(),
    x1: z.number().int(),
    y1: z.number().int(),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
  }),
  z.object({
    op: z.literal('clear_rect'),
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().min(1),
    h: z.number().int().min(1)
  }),
  z.object({
    op: z.literal('outline'),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
  }),
  z.object({
    op: z.literal('clear_all')
  })
])

function drawBresenhamLine(
  img: ReturnType<typeof createBlankImage>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  hex: string
): void {
  const [r, g, b, a] = hexToRgba(hex)
  let cx = x0
  let cy = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  while (true) {
    setPixel(img, cx, cy, r, g, b, a)
    if (cx === x1 && cy === y1) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      cx += sx
    }
    if (e2 < dx) {
      err += dx
      cy += sy
    }
  }
}

export function registerPixelTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'pixel_import_png',
    {
      title: 'Nhập tệp PNG thành Sprite Asset',
      description: 'Nhập một ảnh PNG (từ `filePath` hoặc `pngBase64`) thành sprite asset đã duyệt mới trong dự án.',
      inputSchema: {
        name: z.string().min(1),
        filePath: z.string().optional(),
        pngBase64: z.string().optional(),
        assetType: z
          .enum(['character', 'portrait', 'outfit', 'furniture', 'item', 'icon', 'ui_element', 'vfx'])
          .optional()
          .default('character'),
        folderId: z.string().nullable().optional()
      }
    },
    (args) => {
      const pngBase64 = ctx.readPngBase64Input(args)
      const res = ctx.service.importPngAsSprite({
        name: args.name,
        pngBase64,
        assetType: args.assetType,
        folderId: args.folderId
      })
      return { ok: true, asset: res.asset, revision: res.revision }
    }
  )

  ctx.registerTool(
    'pixel_create_blank_sprite',
    {
      title: 'Tạo Sprite Pixel Art trống (hoặc tô nền)',
      description:
        'Tạo nhanh một sprite pixel art W×H mới trong dự án (có thể truyền sẵn các lệnh vẽ `operations` để dựng sprite hoàn chỉnh trong 1 bước).',
      inputSchema: {
        name: z.string().min(1),
        width: z.number().int().min(4).max(512).default(32),
        height: z.number().int().min(4).max(512).default(32),
        assetType: z
          .enum(['character', 'portrait', 'outfit', 'furniture', 'item', 'icon', 'ui_element', 'vfx'])
          .optional()
          .default('item'),
        folderId: z.string().nullable().optional(),
        operations: z.array(PaintOpSchema).optional().describe('Các lệnh vẽ pixel khởi tạo tùy chọn')
      }
    },
    (args) => {
      const img = createBlankImage(args.width, args.height)
      for (const op of args.operations ?? []) {
        applyPaintOp(img, op)
      }
      const pngBase64 = encodePng(img).toString('base64')
      const res = ctx.service.importPngAsSprite({
        name: args.name,
        pngBase64,
        assetType: args.assetType,
        folderId: args.folderId
      })
      return { ok: true, asset: res.asset, revision: res.revision }
    }
  )

  ctx.registerTool(
    'pixel_paint_canvas',
    {
      title: 'Vẽ Pixel Art theo tọa độ trên Sprite hiện có',
      description:
        'Thực hiện các thao tác vẽ pixel (set_pixel, fill_rect, line, outline, clear_rect, clear_all) lên revision hiện tại của asset và lưu thành revision nháp mới (hỗ trợ Undo).',
      inputSchema: {
        assetId: z.string().min(1),
        operations: z.array(PaintOpSchema).min(1),
        pivotPx: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
        summary: z.string().optional().default('Vẽ pixel art qua MCP'),
        autoApprove: z.boolean().optional().default(false)
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const asset = store.getEntity<Asset>('asset', args.assetId)
      if (!asset) throw new Error(`Không tìm thấy asset "${args.assetId}".`)
      const revId = asset.latestRevisionId ?? asset.approvedRevisionId
      const rev = revId ? store.getRevision(revId) : null
      if (!rev || !rev.normalizedBlobHash) {
        throw new Error(`Asset "${args.assetId}" chưa có dữ liệu ảnh để vẽ.`)
      }

      const img = decodePng(store.readBlob(rev.normalizedBlobHash))
      for (const op of args.operations) {
        applyPaintOp(img, op)
      }
      const encoded = encodePng(img).toString('base64')
      const saved = ctx.service.savePixelEdit({
        assetId: args.assetId,
        layers: [
          {
            id: rev.layers[0]?.id ?? 'lyr_main',
            name: rev.layers[0]?.name ?? 'Nền chính',
            visible: true,
            locked: false,
            opacity: 1,
            pngBase64: encoded,
            order: 0
          }
        ],
        width: img.width,
        height: img.height,
        pivotPx: args.pivotPx ?? rev.pivotPx,
        summary: args.summary
      })

      if (args.autoApprove) {
        ctx.service.approveRevision(args.assetId, saved.revision.revisionId)
      }

      return {
        ok: true,
        assetId: args.assetId,
        revisionId: saved.revision.revisionId,
        blobHash: saved.revision.normalizedBlobHash,
        approved: args.autoApprove
      }
    }
  )

  ctx.registerTool(
    'pixel_save_layers',
    {
      title: 'Gộp nhiều Layer PNG và lưu Revision mới',
      description: 'Gộp danh sách layers (hỗ trợ filePath hoặc pngBase64 cho từng layer) thành revision mới cho asset.',
      inputSchema: {
        assetId: z.string().min(1),
        width: z.number().int().min(4).max(512),
        height: z.number().int().min(4).max(512),
        layers: z
          .array(
            z.object({
              id: z.string().min(1),
              name: z.string().min(1),
              visible: z.boolean().default(true),
              locked: z.boolean().default(false),
              opacity: z.number().min(0).max(1).default(1),
              order: z.number().int().default(0),
              filePath: z.string().optional(),
              pngBase64: z.string().optional()
            })
          )
          .min(1),
        pivotPx: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
        summary: z.string().optional().default('Lưu layers qua MCP')
      }
    },
    (args) => {
      const res = ctx.service.savePixelEdit({
        assetId: args.assetId,
        width: args.width,
        height: args.height,
        pivotPx: args.pivotPx,
        summary: args.summary,
        layers: args.layers.map((l) => ({
          id: l.id,
          name: l.name,
          visible: l.visible,
          locked: l.locked,
          opacity: l.opacity,
          order: l.order,
          pngBase64: ctx.readPngBase64Input(l)
        }))
      })
      return { ok: true, revision: res.revision }
    }
  )

  ctx.registerTool(
    'pixel_transform',
    {
      title: 'Biến đổi Sprite tất định (Deterministic Transform)',
      description:
        'Thực hiện phép biến đổi ảnh cục bộ không cần gọi AI: flip_h, flip_v, rotate_cw, rotate_ccw, quantize (ép bảng màu), remove_bg (tách nền alpha), crop_resize.',
      inputSchema: {
        assetId: z.string().min(1),
        op: z.enum(['flip_h', 'flip_v', 'rotate_cw', 'rotate_ccw', 'quantize', 'remove_bg', 'crop_resize']),
        dither: z.boolean().optional(),
        colorKeyHex: z.string().nullable().optional(),
        tolerance: z.number().min(0).max(255).optional(),
        targetW: z.number().int().min(4).max(512).optional(),
        targetH: z.number().int().min(4).max(512).optional(),
        anchor: z
          .enum([
            'top-left',
            'top-center',
            'top-right',
            'middle-left',
            'center',
            'middle-right',
            'bottom-left',
            'bottom-center',
            'bottom-right'
          ])
          .optional(),
        autoApprove: z.boolean().optional().default(false)
      }
    },
    (args) => {
      const res = ctx.service.transformSpriteDeterministic({
        assetId: args.assetId,
        op: args.op,
        dither: args.dither,
        colorKeyHex: args.colorKeyHex,
        tolerance: args.tolerance,
        targetW: args.targetW,
        targetH: args.targetH,
        anchor: args.anchor
      })
      if (args.autoApprove) {
        ctx.service.approveRevision(args.assetId, res.revision.revisionId)
      }
      return {
        ok: true,
        revisionId: res.revision.revisionId,
        canvasPx: res.revision.canvasPx,
        clippedOpaquePixels: res.clippedOpaquePixels ?? 0,
        approved: args.autoApprove
      }
    }
  )

  ctx.registerTool(
    'pixel_analyze_sprite',
    {
      title: 'Phân tích chất lượng (QC) Sprite Pixel Art',
      description:
        'Đo các chỉ số kỹ thuật pixel art cho một asset (số pixel đục, pixel bán trong suốt, bounding box, foot anchor, chạm mép canvas, số màu lệch bảng màu dự án).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        assetId: z.string().min(1)
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const asset = store.getEntity<Asset>('asset', args.assetId)
      if (!asset) throw new Error(`Không tìm thấy asset "${args.assetId}".`)
      const revId = asset.latestRevisionId ?? asset.approvedRevisionId
      const rev = revId ? store.getRevision(revId) : null
      if (!rev || !rev.normalizedBlobHash) {
        throw new Error(`Asset "${args.assetId}" chưa có revision ảnh.`)
      }
      const cfg = store.getProjectConfig()
      const pal = cfg.activePaletteId ? store.getEntity<Palette>('palette', cfg.activePaletteId) : null
      const img = decodePng(store.readBlob(rev.normalizedBlobHash))
      const metrics = analyzeSpriteMetrics(img, pal?.colors)
      return {
        assetId: asset.assetId,
        revisionId: rev.revisionId,
        pivotPx: rev.pivotPx,
        metrics
      }
    }
  )
}

function applyPaintOp(img: ReturnType<typeof createBlankImage>, op: z.infer<typeof PaintOpSchema>): void {
  if (op.op === 'set_pixel') {
    const [r, g, b, a] = hexToRgba(op.hex)
    setPixel(img, op.x, op.y, r, g, b, a)
  } else if (op.op === 'fill_rect') {
    fillRect(img, op.x, op.y, op.w, op.h, op.hex)
  } else if (op.op === 'line') {
    drawBresenhamLine(img, op.x0, op.y0, op.x1, op.y1, op.hex)
  } else if (op.op === 'clear_rect') {
    for (let py = op.y; py < op.y + op.h; py++) {
      for (let px = op.x; px < op.x + op.w; px++) {
        setPixel(img, px, py, 0, 0, 0, 0)
      }
    }
  } else if (op.op === 'outline') {
    drawOutline(img, op.hex)
  } else if (op.op === 'clear_all') {
    img.data.fill(0)
  }
}
