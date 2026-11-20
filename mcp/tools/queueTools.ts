import { z } from 'zod'
import type { PiartMcpContext } from '../context'

export function registerQueueTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'queue_list_jobs',
    {
      title: 'Liệt kê Hàng đợi Tác vụ (Jobs)',
      description: 'Xem danh sách job trong dự án đang mở (có thể lọc theo trạng thái queued, running, succeeded, failed, cancelled, ambiguous).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'ambiguous', 'all']).optional().default('all'),
        limit: z.number().int().min(1).max(100).optional().default(25)
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const filtered = state.jobs
        .filter((j) => args.status === 'all' || j.status === args.status)
        .slice(0, args.limit)
        .map((j) => ({
          jobId: j.jobId,
          status: j.status,
          mode: j.snapshot.mode,
          contentType: j.snapshot.contentType,
          promptText: j.snapshot.promptText,
          stepCount: j.steps.length,
          succeededSteps: j.steps.filter((s) => s.status === 'succeeded').length,
          failedSteps: j.steps.filter((s) => s.status === 'failed').length,
          createdAt: j.createdAt,
          updatedAt: j.updatedAt
        }))
      return { total: filtered.length, jobs: filtered }
    }
  )

  ctx.registerTool(
    'queue_get_job',
    {
      title: 'Xem chi tiết Job → Step → Output',
      description: 'Lấy chi tiết đầy đủ của một job bao gồm toàn bộ bước, lỗi bước, đầu ra asset/clip và snapshot tham số.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        jobId: z.string().min(1)
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const job = state.jobs.find((j) => j.jobId === args.jobId)
      if (!job) throw new Error(`Không tìm thấy job "${args.jobId}".`)
      return { job }
    }
  )

  ctx.registerTool(
    'queue_cancel_job',
    {
      title: 'Hủy tác vụ đang chờ hoặc đang chạy',
      description: 'Hủy một job đang chạy/chờ mà vẫn giữ nguyên các bước đã hoàn tất.',
      inputSchema: {
        jobId: z.string().min(1)
      }
    },
    (args) => {
      ctx.service.cancelJob(args.jobId)
      return { ok: true, cancelledJobId: args.jobId }
    }
  )

  ctx.registerTool(
    'queue_retry_job',
    {
      title: 'Thử lại các bước lỗi của Job',
      description: 'Chạy lại chỉ những bước bị lỗi của job mà không chạy lại bước đã thành công.',
      inputSchema: {
        jobId: z.string().min(1)
      }
    },
    async (args) => {
      const res = await ctx.service.retryJob(args.jobId)
      return { ok: res.job.status === 'succeeded', job: res.job }
    }
  )

  ctx.registerTool(
    'queue_resume_jobs',
    {
      title: 'Tiếp tục các Job bị gián đoạn từ Checkpoint',
      description: 'Khôi phục và tiếp tục chạy các tác vụ bị gián đoạn trong dự án từ checkpoint SQLite.',
    },
    async () => {
      const state = await ctx.service.resumeInterruptedJobs()
      return { ok: true, totalJobs: state.jobs.length }
    }
  )

  ctx.registerTool(
    'usage_get_ledger',
    {
      title: 'Xem Nhật ký sử dụng Token & Ảnh (Usage Ledger)',
      description: 'Thống kê số lượt gọi, tổng số ảnh đã sinh, tổng token đầu vào/đầu ra và danh sách các bản ghi gần nhất.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().default(30)
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const totals = state.usageLedger.reduce(
        (acc, u) => ({
          calls: acc.calls + 1,
          images: acc.images + u.imageCount,
          inputTokens: acc.inputTokens + u.inputTokens,
          outputTokens: acc.outputTokens + u.outputTokens
        }),
        { calls: 0, images: 0, inputTokens: 0, outputTokens: 0 }
      )
      return {
        totals,
        recent: state.usageLedger.slice(0, args.limit)
      }
    }
  )
}
