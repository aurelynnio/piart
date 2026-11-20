import { z } from 'zod'
import type { PiartMcpContext } from '../context'

export function registerProviderTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'provider_get_settings',
    {
      title: 'Xem cấu hình Provider & Model',
      description: 'Xem provider đang dùng (openai/mock), trạng thái ngoại tuyến, trạng thái API key (đã che) và ma trận năng lực model.',
      annotations: { readOnlyHint: true }
    },
    () => {
      const boot = ctx.service.getAppBootstrap()
      return {
        settings: boot.settings,
        providerKeys: boot.providerKeys,
        capabilities: boot.capabilities
      }
    }
  )

  ctx.registerTool(
    'provider_update_settings',
    {
      title: 'Cập nhật Provider, Ngoại tuyến & Model',
      description: 'Chuyển đổi giữa OpenAI và MockTestAdapter, bật/tắt chế độ ngoại tuyến hoặc chọn model cho planner/imageGenerate/imageEdit.',
      inputSchema: {
        activeProviderId: z.enum(['openai', 'mock']).optional(),
        offlineMode: z.boolean().optional(),
        models: z
          .object({
            planner: z.string().min(1).optional(),
            imageGenerate: z.string().min(1).optional(),
            imageEdit: z.string().min(1).optional()
          })
          .optional()
      }
    },
    (args) => {
      const current = ctx.service.getAppBootstrap().settings
      const updated = ctx.service.updateAppSettings({
        activeProviderId: args.activeProviderId,
        offlineMode: args.offlineMode,
        models: args.models
          ? {
              planner: args.models.planner ?? current.models.planner,
              imageGenerate: args.models.imageGenerate ?? current.models.imageGenerate,
              imageEdit: args.models.imageEdit ?? current.models.imageEdit
            }
          : undefined
      })
      return { ok: true, settings: updated.settings }
    }
  )

  ctx.registerTool(
    'provider_set_api_key',
    {
      title: 'Lưu API Key an toàn',
      description:
        'Lưu API key mã hóa vào SecretStore (chỉ trả về dạng che). Có thể truyền trực tiếp `apiKey` hoặc chỉ định `fromEnvVar` (VD: "OPENAI_API_KEY") để không phải lộ key trong lịch sử hội thoại.',
      inputSchema: {
        providerId: z.enum(['openai', 'mock']),
        apiKey: z.string().optional().describe('API key (nên ưu tiên dùng fromEnvVar)'),
        fromEnvVar: z.string().optional().describe('Tên biến môi trường chứa API key, VD: OPENAI_API_KEY')
      }
    },
    (args) => {
      const resolved = args.fromEnvVar ? process.env[args.fromEnvVar] : args.apiKey
      if (!resolved || !resolved.trim()) {
        throw new Error(
          args.fromEnvVar
            ? `Biến môi trường ${args.fromEnvVar} chưa được thiết lập hoặc rỗng.`
            : 'Cần cung cấp `apiKey` hoặc `fromEnvVar`.'
        )
      }
      const meta = ctx.service.setApiKey(args.providerId, resolved)
      return { ok: true, keyStatus: meta }
    }
  )

  ctx.registerTool(
    'provider_delete_api_key',
    {
      title: 'Xóa API Key đã lưu',
      description: 'Xóa API key của provider khỏi SecretStore.',
      inputSchema: {
        providerId: z.enum(['openai', 'mock'])
      }
    },
    (args) => {
      const meta = ctx.service.deleteApiKey(args.providerId)
      return { ok: true, keyStatus: meta }
    }
  )

  ctx.registerTool(
    'provider_test_connection',
    {
      title: 'Kiểm tra kết nối Provider',
      description: 'Kiểm tra thông tin xác thực và năng lực model của provider (openai hoặc mock).',
      inputSchema: {
        providerId: z.enum(['openai', 'mock'])
      }
    },
    async (args) => {
      const res = await ctx.service.testProviderConnection(args.providerId)
      return { ok: res.ok, result: res }
    }
  )

  ctx.registerTool(
    'studio_generate_diagnostics',
    {
      title: 'Tạo báo cáo chẩn đoán đã lọc bí mật',
      description: 'Tạo báo cáo chẩn đoán hệ thống, tính toàn vẹn SQLite và log gần đây (đã lọc 100% API key và thông tin nhạy cảm).',
      annotations: { readOnlyHint: true }
    },
    () => ctx.service.generateDiagnosticReport()
  )
}
