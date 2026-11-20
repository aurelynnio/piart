import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StudioService } from '../app/main/ipc/studioService'
import { PiartMcpContext } from './context'
import { registerAllTools } from './tools'
import { registerAllResources } from './resources'
import { registerAllPrompts } from './prompts'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export interface CreatePiartMcpServerOptions {
  /** Directory storing settings.json and encrypted secrets.enc.json */
  appDataDir?: string
  /** Path to the bundled sample workshop project (examples/workshop) */
  sampleWorkshopDir?: string
  /** Optional project directory to open automatically on startup */
  initialProjectDir?: string
  /** Optional provider override ('openai' | 'mock') */
  providerId?: 'openai' | 'mock'
  /** Optional OpenAI API key (e.g. from process.env.OPENAI_API_KEY) */
  openaiApiKey?: string
  /** Optional server version override */
  version?: string
}

export function resolveDefaultSampleWorkshopDir(): string {
  const candidates = [
    path.resolve(currentDir, '../examples/workshop'),
    path.resolve(currentDir, '../../examples/workshop'),
    path.resolve(process.cwd(), 'examples/workshop')
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'studio.sqlite'))) return c
  }
  return path.resolve(process.cwd(), 'examples/workshop')
}

export function resolveDefaultAppDataDir(): string {
  if (process.env.AI_PIXEL_STUDIO_DATA_DIR) {
    return path.resolve(process.env.AI_PIXEL_STUDIO_DATA_DIR)
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'ai-pixel-studio', 'studio-data')
  }
  return path.join(os.homedir(), '.ai-pixel-studio', 'studio-data')
}

export async function createPiartMcpServer(options: CreatePiartMcpServerOptions = {}) {
  const appDataDir = options.appDataDir
    ? path.resolve(options.appDataDir)
    : resolveDefaultAppDataDir()
  const sampleWorkshopDir = options.sampleWorkshopDir
    ? path.resolve(options.sampleWorkshopDir)
    : resolveDefaultSampleWorkshopDir()

  const service = new StudioService({
    appDataDir,
    sampleWorkshopDir,
    safeStorage: null
  })

  if (options.openaiApiKey && options.openaiApiKey.trim()) {
    service.setApiKey('openai', options.openaiApiKey.trim())
  }

  if (options.providerId) {
    service.updateAppSettings({ activeProviderId: options.providerId })
  }

  if (options.initialProjectDir) {
    const absProj = path.resolve(options.initialProjectDir)
    if (fs.existsSync(path.join(absProj, 'studio.sqlite'))) {
      await service.openProject(absProj)
    }
  }

  const server = new McpServer(
    {
      name: 'piart-ai-pixel-studio',
      version: options.version ?? '1.0.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      instructions:
        'AI Pixel Studio (piart) MCP Server — điều khiển toàn bộ quy trình sản xuất tài nguyên game 2D pixel art cục bộ (SQLite WAL), vẽ pixel tất định, animation timeline, bản đồ/hội thoại/nhiệm vụ, luồng AI có kiểm tra xung đột và xuất gói kiểm chứng SHA-256 sang Unity 6.'
    }
  )

  const ctx = new PiartMcpContext(server, service)
  registerAllTools(ctx)
  registerAllResources(ctx)
  registerAllPrompts(ctx)

  const close = async () => {
    try {
      service.closeProject()
    } finally {
      await server.close()
    }
  }

  return { server, service, ctx, close }
}
