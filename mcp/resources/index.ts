import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PiartMcpContext } from '../context'

function jsonResource(uri: URL, data: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2)
      }
    ]
  }
}

export function registerAllResources(ctx: PiartMcpContext): void {
  const { server, service } = ctx

  // ---- Static Resources ----

  server.registerResource(
    'studio_status',
    'piart://status',
    {
      title: 'Trạng thái AI Pixel Studio',
      description: 'Cấu hình ứng dụng, provider, model và tóm tắt dự án đang mở.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const boot = service.getAppBootstrap()
      return jsonResource(
        uri,
        ctx.redact({
          settings: boot.settings,
          providerKeys: boot.providerKeys,
          sampleWorkshopAvailable: boot.sampleWorkshopAvailable,
          currentProject: boot.currentProject ? ctx.summarizeProject(boot.currentProject) : null
        })
      )
    }
  )

  server.registerResource(
    'project_summary',
    'piart://project/summary',
    {
      title: 'Tóm tắt dự án hiện tại',
      description: 'Cấu hình dự án và thống kê số lượng tài nguyên/clip/scene/job.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const state = service.requireStore().getFullState()
      return jsonResource(uri, ctx.summarizeProject(state))
    }
  )

  server.registerResource(
    'project_config',
    'piart://project/config',
    {
      title: 'Cấu hình dự án (project.json / config)',
      description: 'Thông số tileSizePx, pixelsPerUnit, góc nhìn mặc định, bảng màu & preset đang dùng.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const state = service.requireStore().getFullState()
      return jsonResource(uri, state.config)
    }
  )

  server.registerResource(
    'project_assets',
    'piart://project/assets',
    {
      title: 'Danh sách tài nguyên (Assets)',
      description: 'Toàn bộ tài nguyên chưa xóa trong dự án hiện tại.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const state = service.requireStore().getFullState()
      return jsonResource(
        uri,
        state.assets.filter((a) => !a.trashedAt)
      )
    }
  )

  server.registerResource(
    'project_clips',
    'piart://project/clips',
    {
      title: 'Danh sách Animation Clips',
      description: 'Toàn bộ animation clips trong dự án hiện tại.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const state = service.requireStore().getFullState()
      return jsonResource(uri, state.clips)
    }
  )

  server.registerResource(
    'project_palettes',
    'piart://project/palettes',
    {
      title: 'Bảng màu dự án (Palettes)',
      description: 'Danh sách bảng màu pixel art trong dự án.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const state = service.requireStore().getFullState()
      return jsonResource(uri, state.palettes)
    }
  )

  server.registerResource(
    'project_presets',
    'piart://project/presets',
    {
      title: 'StylePresets của dự án',
      description: 'Danh sách StylePreset định nghĩa phong cách pixel art.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const state = service.requireStore().getFullState()
      return jsonResource(uri, state.presets)
    }
  )

  server.registerResource(
    'project_jobs',
    'piart://project/jobs',
    {
      title: 'Hàng đợi Job & Nhật ký tác vụ',
      description: 'Danh sách tác vụ AI và xử lý cục bộ trong dự án.',
      mimeType: 'application/json'
    },
    async (uri) => {
      const state = service.requireStore().getFullState()
      return jsonResource(uri, ctx.redact(state.jobs))
    }
  )

  server.registerResource(
    'project_diagnostics',
    'piart://project/diagnostics',
    {
      title: 'Báo cáo chẩn đoán đã lọc bí mật',
      description: 'Trạng thái hệ thống, toàn vẹn SQLite và log gần đây (redacted).',
      mimeType: 'application/json'
    },
    async (uri) => {
      return jsonResource(uri, service.generateDiagnosticReport())
    }
  )

  // ---- Dynamic Resource Templates ----

  server.registerResource(
    'asset_detail',
    new ResourceTemplate('piart://asset/{assetId}', {
      list: async () => {
        const store = service.getCurrentStore()
        if (!store) return { resources: [] }
        const state = store.getFullState()
        return {
          resources: state.assets
            .filter((a) => !a.trashedAt)
            .map((a) => ({
              uri: `piart://asset/${a.assetId}`,
              name: a.name,
              description: `${a.type} (${a.assetId})`,
              mimeType: 'application/json'
            }))
        }
      }
    }),
    {
      title: 'Chi tiết tài nguyên theo assetId',
      description: 'Đọc đầy đủ asset, revisions và clips liên quan.',
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const assetId = String(variables.assetId ?? '')
      const state = service.requireStore().getFullState()
      const asset = state.assets.find((a) => a.assetId === assetId)
      if (!asset) throw new Error(`Không tìm thấy asset "${assetId}".`)
      return jsonResource(uri, {
        asset,
        revisions: state.revisions.filter((r) => r.assetId === assetId),
        clips: state.clips.filter((c) => c.assetId === assetId)
      })
    }
  )

  server.registerResource(
    'clip_detail',
    new ResourceTemplate('piart://clip/{clipId}', {
      list: async () => {
        const store = service.getCurrentStore()
        if (!store) return { resources: [] }
        const state = store.getFullState()
        return {
          resources: state.clips.map((c) => ({
            uri: `piart://clip/${c.clipId}`,
            name: c.name,
            description: `${c.action} (${c.direction}) · ${c.frames.length}f @ ${c.fps}fps`,
            mimeType: 'application/json'
          }))
        }
      }
    }),
    {
      title: 'Chi tiết Animation Clip theo clipId',
      description: 'Đọc toàn bộ frames, thời lượng và mốc sự kiện của một clip.',
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const clipId = String(variables.clipId ?? '')
      const state = service.requireStore().getFullState()
      const clip = state.clips.find((c) => c.clipId === clipId)
      if (!clip) throw new Error(`Không tìm thấy clip "${clipId}".`)
      return jsonResource(uri, clip)
    }
  )

  server.registerResource(
    'blob_png',
    new ResourceTemplate('piart://blob/{sha256}', {
      list: undefined
    }),
    {
      title: 'Ảnh PNG nhị phân từ kho Blob bất biến',
      description: 'Đọc trực tiếp dữ liệu ảnh PNG base64 theo mã SHA-256.',
      mimeType: 'image/png'
    },
    async (uri, variables) => {
      const sha256 = String(variables.sha256 ?? '')
      const b64 = service.readBlobBase64(sha256)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'image/png',
            blob: b64
          }
        ]
      }
    }
  )
}
