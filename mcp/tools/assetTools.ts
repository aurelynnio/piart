import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { makeId } from '../../app/main/db/projectStore'
import type { AssetType } from '@domain/schemas/types'
import type { PiartMcpContext } from '../context'

const ASSET_TYPES = [
  'character',
  'portrait',
  'outfit',
  'furniture',
  'item',
  'icon',
  'tileset',
  'map',
  'ui_element',
  'ui_screen',
  'vfx',
  'cutscene',
  'dialogue',
  'quest',
  'data_table'
] as const

export function registerAssetTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'asset_list',
    {
      title: 'Liệt kê tài nguyên trong dự án',
      description: 'Tìm kiếm và lọc danh sách tài nguyên (sprite, character, tileset, map, dialogue, quest...) trong dự án đang mở.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        status: z.enum(['active', 'approved', 'draft', 'trash', 'all']).optional().default('active'),
        type: z.enum(ASSET_TYPES).optional(),
        folderId: z.string().optional(),
        query: z.string().optional().describe('Từ khóa lọc theo tên, ID, mô tả hoặc tag')
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const clipCounts = new Map<string, number>()
      for (const c of state.clips) {
        clipCounts.set(c.assetId, (clipCounts.get(c.assetId) ?? 0) + 1)
      }
      const revMap = new Map(state.revisions.map((r) => [r.revisionId, r]))

      const items = state.assets
        .filter((a) => {
          if (args.status === 'trash') return Boolean(a.trashedAt)
          if (args.status !== 'all' && a.trashedAt) return false
          if (args.status === 'approved' && !a.approvedRevisionId) return false
          if (args.status === 'draft' && a.approvedRevisionId) return false
          if (args.type && a.type !== (args.type as AssetType)) return false
          if (args.folderId && (a.folderId ?? 'root') !== args.folderId) return false
          if (args.query?.trim()) {
            const q = args.query.toLowerCase()
            return (
              a.name.toLowerCase().includes(q) ||
              a.assetId.toLowerCase().includes(q) ||
              a.description.toLowerCase().includes(q) ||
              a.tags.some((t) => t.toLowerCase().includes(q))
            )
          }
          return true
        })
        .map((a) => {
          const revId = a.approvedRevisionId ?? a.latestRevisionId
          const rev = revId ? revMap.get(revId) : null
          return {
            assetId: a.assetId,
            name: a.name,
            slug: a.slug,
            type: a.type,
            folderId: a.folderId,
            tags: a.tags,
            approvedRevisionId: a.approvedRevisionId,
            latestRevisionId: a.latestRevisionId,
            canvasPx: rev?.canvasPx ?? null,
            blobHash: rev?.normalizedBlobHash ?? null,
            clipCount: clipCounts.get(a.assetId) ?? 0,
            trashedAt: a.trashedAt,
            updatedAt: a.updatedAt
          }
        })

      return { total: items.length, assets: items }
    }
  )

  ctx.registerTool(
    'asset_get',
    {
      title: 'Xem chi tiết tài nguyên',
      description: 'Lấy đầy đủ thông tin một asset, toàn bộ lịch sử revision và danh sách animation clips liên quan.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        assetId: z.string().min(1)
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const asset = state.assets.find((a) => a.assetId === args.assetId)
      if (!asset) throw new Error(`Không tìm thấy asset "${args.assetId}".`)
      const revisions = state.revisions.filter((r) => r.assetId === args.assetId)
      const clips = state.clips.filter((c) => c.assetId === args.assetId)
      return { asset, revisions, clips }
    }
  )

  ctx.registerTool(
    'asset_create_folder',
    {
      title: 'Tạo thư mục tài nguyên',
      description: 'Tạo một thư mục mới để tổ chức tài nguyên trong dự án.',
      inputSchema: {
        name: z.string().min(1),
        parentId: z.string().nullable().optional()
      }
    },
    (args) => {
      const id = makeId('fld')
      const folder = {
        id,
        name: args.name.trim(),
        parentId: args.parentId ?? null,
        kind: 'folder' as const,
        createdAt: new Date().toISOString()
      }
      ctx.service.upsertEntityDirect('folder', id, folder)
      return { ok: true, folder }
    }
  )

  ctx.registerTool(
    'asset_bulk_edit',
    {
      title: 'Chỉnh sửa hàng loạt tài nguyên',
      description: 'Đổi tên (khi chọn 1 asset), cập nhật mô tả, thêm/bớt tags hoặc di chuyển thư mục cho nhiều asset cùng lúc (hỗ trợ Undo).',
      inputSchema: {
        assetIds: z.array(z.string().min(1)).min(1),
        name: z.string().optional(),
        description: z.string().optional(),
        addTags: z.array(z.string()).optional(),
        removeTags: z.array(z.string()).optional(),
        folderId: z.string().nullable().optional()
      }
    },
    (args) => {
      const state = ctx.service.bulkEditAssets(args)
      const updated = state.assets.filter((a) => args.assetIds.includes(a.assetId))
      return { ok: true, updatedCount: updated.length, assets: updated }
    }
  )

  ctx.registerTool(
    'asset_duplicate',
    {
      title: 'Nhân bản tài nguyên',
      description: 'Tạo bản sao độc lập của một tài nguyên kèm revision hiện tại.',
      inputSchema: {
        assetId: z.string().min(1),
        newName: z.string().optional()
      }
    },
    (args) => {
      const res = ctx.service.duplicateAsset(args.assetId, args.newName)
      return { ok: true, asset: res.asset }
    }
  )

  ctx.registerTool(
    'asset_trash',
    {
      title: 'Chuyển tài nguyên vào thùng rác',
      description: 'Xóa mềm một tài nguyên vào thùng rác và báo cáo các scene/clip đang tham chiếu tới nó.',
      inputSchema: {
        assetId: z.string().min(1)
      }
    },
    (args) => {
      const res = ctx.service.trashAsset(args.assetId)
      return { ok: true, assetId: args.assetId, referencingIds: res.referencingIds }
    }
  )

  ctx.registerTool(
    'asset_restore_trashed',
    {
      title: 'Khôi phục tài nguyên từ thùng rác',
      description: 'Khôi phục một tài nguyên đã chuyển vào thùng rác.',
      inputSchema: {
        assetId: z.string().min(1)
      }
    },
    (args) => {
      ctx.service.restoreTrashedAsset(args.assetId)
      return { ok: true, restoredAssetId: args.assetId }
    }
  )

  ctx.registerTool(
    'revision_approve',
    {
      title: 'Duyệt phiên bản (Approve Revision)',
      description: 'Đánh dấu một revision cụ thể làm phiên bản chính thức (approved) của asset để sẵn sàng xuất sang Unity.',
      inputSchema: {
        assetId: z.string().min(1),
        revisionId: z.string().min(1)
      }
    },
    (args) => {
      const state = ctx.service.approveRevision(args.assetId, args.revisionId)
      const asset = state.assets.find((a) => a.assetId === args.assetId)
      return { ok: true, assetId: args.assetId, approvedRevisionId: asset?.approvedRevisionId }
    }
  )

  ctx.registerTool(
    'revision_restore',
    {
      title: 'Khôi phục phiên bản cũ thành bản nháp mới',
      description: 'Tạo một revision nháp mới từ một revision lịch sử (không phá hủy lịch sử cũ).',
      inputSchema: {
        assetId: z.string().min(1),
        revisionId: z.string().min(1)
      }
    },
    (args) => {
      const state = ctx.service.restoreRevision(args.assetId, args.revisionId)
      const asset = state.assets.find((a) => a.assetId === args.assetId)
      return { ok: true, assetId: args.assetId, latestRevisionId: asset?.latestRevisionId }
    }
  )

  ctx.registerTool(
    'blob_export_png',
    {
      title: 'Đọc hoặc xuất ảnh PNG từ blob SHA-256',
      description:
        'Đọc ảnh PNG từ kho blob bất biến theo `sha256` (hoặc tự động lấy ảnh hiện tại của `assetId`). Có thể ghi ra tệp cục bộ (`outputPath`) và/hoặc trả trực tiếp ảnh MCP để agent quan sát.',
      annotations: { readOnlyHint: false },
      inputSchema: {
        sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
        assetId: z.string().optional().describe('Nếu không truyền sha256, tự lấy ảnh mới nhất/đã duyệt của assetId'),
        outputPath: z.string().optional().describe('Đường dẫn tệp PNG để ghi ra đĩa'),
        includeImage: z.boolean().optional().default(true).describe('Trả kèm nội dung ảnh MCP (image/png)')
      }
    },
    (args) => {
      let hash = args.sha256
      if (!hash && args.assetId) {
        const store = ctx.service.requireStore()
        const state = store.getFullState()
        const asset = state.assets.find((a) => a.assetId === args.assetId)
        if (!asset) throw new Error(`Không tìm thấy asset "${args.assetId}".`)
        const revId = asset.latestRevisionId ?? asset.approvedRevisionId
        const rev = revId ? state.revisions.find((r) => r.revisionId === revId) : null
        hash = rev?.normalizedBlobHash ?? undefined
      }
      if (!hash) {
        throw new Error('Cần truyền `sha256` hoặc `assetId` có revision ảnh.')
      }

      const b64 = ctx.service.readBlobBase64(hash)
      let writtenPath: string | null = null
      if (args.outputPath) {
        writtenPath = path.resolve(args.outputPath)
        fs.mkdirSync(path.dirname(writtenPath), { recursive: true })
        fs.writeFileSync(writtenPath, Buffer.from(b64, 'base64'))
      }

      const meta = { ok: true, sha256: hash, bytes: Buffer.byteLength(b64, 'base64'), writtenPath }
      if (args.includeImage) {
        return ctx.okImageAndJson(b64, meta)
      }
      return meta
    }
  )
}
