import { z } from 'zod'
import type { PiartMcpContext } from '../context'

export function registerAutomationTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'studio_approve_all_drafts',
    {
      title: 'Duyệt hàng loạt bản nháp (Approve Drafts)',
      description:
        'Tự động duyệt (approve) revision mới nhất cho toàn bộ asset đang ở trạng thái nháp (hoặc danh sách `assetIds` chỉ định) để sẵn sàng xuất sang Unity.',
      inputSchema: {
        assetIds: z.array(z.string().min(1)).optional().describe('Bỏ trống sẽ duyệt tất cả asset nháp chưa bị xóa')
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const targetSet = args.assetIds ? new Set(args.assetIds) : null
      const approved: Array<{ assetId: string; name: string; revisionId: string }> = []

      for (const a of state.assets) {
        if (a.trashedAt) continue
        if (targetSet && !targetSet.has(a.assetId)) continue
        const candidateRev = a.latestRevisionId
        if (candidateRev && a.approvedRevisionId !== candidateRev) {
          ctx.service.approveRevision(a.assetId, candidateRev)
          approved.push({ assetId: a.assetId, name: a.name, revisionId: candidateRev })
        }
      }

      return { ok: true, approvedCount: approved.length, approved }
    }
  )

  ctx.registerTool(
    'studio_full_export_pipeline',
    {
      title: 'Pipeline Xuất Unity Trọn Gói (Approve → Preflight → Export → Verify)',
      description:
        'Tự động hóa trọn quy trình xuất Unity trong một lần gọi: tùy chọn duyệt bản nháp → kiểm tra tiền xuất (preflight) → xuất gói Unity → xác minh SHA-256 checksum.',
      inputSchema: {
        targetDir: z.string().min(1),
        scopeKind: z.enum(['project', 'scene', 'asset', 'collection']).default('project'),
        rootIds: z.array(z.string()).optional().default([]),
        approveDraftsFirst: z.boolean().optional().default(false),
        includeAtlas: z.boolean().optional().default(true),
        atlasPaddingPx: z.number().int().min(2).max(16).optional().default(2)
      }
    },
    (args) => {
      const approvedList: Array<{ assetId: string; revisionId: string }> = []
      if (args.approveDraftsFirst) {
        const state = ctx.service.requireStore().getFullState()
        for (const a of state.assets) {
          if (a.trashedAt) continue
          if (a.latestRevisionId && a.approvedRevisionId !== a.latestRevisionId) {
            ctx.service.approveRevision(a.assetId, a.latestRevisionId)
            approvedList.push({ assetId: a.assetId, revisionId: a.latestRevisionId })
          }
        }
      }

      const preflight = ctx.service.preflightExport(args.scopeKind, args.rootIds)
      if (!preflight.ok) {
        return {
          ok: false,
          stage: 'preflight',
          approvedCount: approvedList.length,
          preflight
        }
      }

      const exported = ctx.service.exportToUnity({
        scopeKind: args.scopeKind,
        rootIds: args.rootIds,
        targetDir: args.targetDir,
        includeAtlas: args.includeAtlas,
        atlasPaddingPx: args.atlasPaddingPx
      })

      const verification = ctx.service.verifyExportPackage(exported.result.targetDir)

      return {
        ok: verification.valid,
        stage: 'completed',
        approvedCount: approvedList.length,
        targetDir: exported.result.targetDir,
        manifestPath: exported.result.manifestPath,
        filesWritten: exported.result.filesWritten,
        manifestEntries: exported.result.manifest.entries.length,
        preflight,
        verification
      }
    }
  )

  ctx.registerTool(
    'studio_batch_execute',
    {
      title: 'Thực thi chuỗi nhiều công cụ MCP liên tiếp (Pipeline Batch)',
      description:
        'Chạy tuần tự một danh sách nhiều bước gọi MCP tool khác nhau trong một lần gọi duy nhất (tối ưu hóa tự động hóa cho Codex). Hỗ trợ dừng ngay khi lỗi (`stopOnError=true`).',
      inputSchema: {
        steps: z
          .array(
            z.object({
              id: z.string().optional(),
              tool: z.string().min(1).describe('Tên MCP tool cần gọi, VD: pixel_create_blank_sprite'),
              arguments: z.record(z.unknown()).optional().default({})
            })
          )
          .min(1)
          .max(50),
        stopOnError: z.boolean().optional().default(true)
      }
    },
    async (args) => {
      const results: Array<{
        stepIndex: number
        id: string
        tool: string
        ok: boolean
        output: unknown
      }> = []

      for (let i = 0; i < args.steps.length; i++) {
        const step = args.steps[i]
        const stepId = step.id ?? `step_${i + 1}`

        if (step.tool === 'studio_batch_execute') {
          results.push({
            stepIndex: i,
            id: stepId,
            tool: step.tool,
            ok: false,
            output: { error: 'Không hỗ trợ gọi lồng đệ quy studio_batch_execute.' }
          })
          if (args.stopOnError) break
          continue
        }

        const invoker = ctx.getToolInvoker(step.tool)
        if (!invoker) {
          results.push({
            stepIndex: i,
            id: stepId,
            tool: step.tool,
            ok: false,
            output: { error: `Không tìm thấy tool "${step.tool}".` }
          })
          if (args.stopOnError) break
          continue
        }

        const res = await invoker.invoke(step.arguments)
        const textBlock = res.content.find((c) => c.type === 'text')
        let parsedOutput: unknown = textBlock && 'text' in textBlock ? textBlock.text : res.content
        if (typeof parsedOutput === 'string') {
          try {
            parsedOutput = JSON.parse(parsedOutput)
          } catch {
            // Keep raw string
          }
        }

        const ok = !res.isError
        results.push({
          stepIndex: i,
          id: stepId,
          tool: step.tool,
          ok,
          output: parsedOutput
        })

        if (!ok && args.stopOnError) break
      }

      const succeeded = results.filter((r) => r.ok).length
      return {
        ok: succeeded === args.steps.length,
        totalSteps: args.steps.length,
        executedSteps: results.length,
        succeededSteps: succeeded,
        results
      }
    }
  )
}
