import { z } from 'zod'
import type { PiartMcpContext } from '../context'

export function registerExportTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'unity_preflight_export',
    {
      title: 'Kiểm tra tiền xuất Unity (Preflight)',
      description:
        'Kiểm tra đầy đủ phụ thuộc, độ hợp lệ của asset/clip/scene/dialogue/quest trước khi xuất gói sang Unity.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        scopeKind: z.enum(['project', 'scene', 'asset', 'collection']).default('project'),
        rootIds: z.array(z.string()).optional().default([])
      }
    },
    (args) => {
      const report = ctx.service.preflightExport(args.scopeKind, args.rootIds)
      return report
    }
  )

  ctx.registerTool(
    'unity_export_package',
    {
      title: 'Xuất gói tài nguyên sang Unity (Manifest v1 + SHA-256)',
      description:
        'Xuất gói tài nguyên hoàn chỉnh (textures, frames, tilesets, atlas, scenes, gameplay JSON, manifest.json kèm SHA-256 checksum) vào targetDir để nhập trực tiếp vào Unity 6.',
      inputSchema: {
        targetDir: z.string().min(1).describe('Thư mục đích lưu gói xuất Unity'),
        scopeKind: z.enum(['project', 'scene', 'asset', 'collection']).default('project'),
        rootIds: z.array(z.string()).optional().default([]),
        includeAtlas: z.boolean().optional().default(true),
        atlasPaddingPx: z.number().int().min(2).max(16).optional().default(2)
      }
    },
    (args) => {
      const res = ctx.service.exportToUnity({
        scopeKind: args.scopeKind,
        rootIds: args.rootIds,
        targetDir: args.targetDir,
        includeAtlas: args.includeAtlas,
        atlasPaddingPx: args.atlasPaddingPx
      })
      return {
        ok: true,
        targetDir: res.result.targetDir,
        manifestPath: res.result.manifestPath,
        filesWritten: res.result.filesWritten,
        manifestEntries: res.result.manifest.entries.length,
        preflight: res.result.preflight
      }
    }
  )

  ctx.registerTool(
    'unity_verify_export',
    {
      title: 'Xác minh tính toàn vẹn gói xuất Unity',
      description: 'Kiểm tra `manifest.json` và đối chiếu checksum SHA-256 của toàn bộ tệp trong thư mục gói xuất Unity.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        exportDir: z.string().min(1)
      }
    },
    (args) => {
      return ctx.service.verifyExportPackage(args.exportDir)
    }
  )

  ctx.registerTool(
    'project_read_file',
    {
      title: 'Đọc tệp văn bản bên trong thư mục dự án (có PathGuard)',
      description: 'Đọc an toàn một tệp văn bản theo đường dẫn tương đối bên trong thư mục gốc của dự án đang mở (chặn path traversal).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        relPath: z.string().min(1).describe('Đường dẫn tương đối tính từ thư mục dự án, VD: project.json')
      }
    },
    (args) => {
      const content = ctx.service.readProjectRelativeFile(args.relPath)
      return { relPath: args.relPath, content }
    }
  )
}
