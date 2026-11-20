import fs from 'node:fs'
import path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z, type ZodRawShape } from 'zod'
import { redactDeep } from '@domain/security/redactor'
import type { StudioService } from '../app/main/ipc/studioService'
import type { ProjectFullState } from '../app/main/db/projectStore'

export interface RegisteredToolInvoker {
  name: string
  description: string
  invoke: (args: Record<string, unknown>) => Promise<CallToolResult>
}

export class PiartMcpContext {
  public readonly server: McpServer
  public readonly service: StudioService
  private readonly toolRegistry = new Map<string, RegisteredToolInvoker>()

  constructor(server: McpServer, service: StudioService) {
    this.server = server
    this.service = service
  }

  /**
   * Registers a tool on McpServer AND records it in the internal registry
   * so macro tools like `studio_batch_execute` can invoke any tool safely.
   */
  registerTool<Shape extends ZodRawShape>(
    name: string,
    options: {
      title?: string
      description: string
      inputSchema?: Shape
      annotations?: ToolAnnotations
    },
    handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown> | unknown
  ): void {
    const schemaObj = options.inputSchema ? z.object(options.inputSchema) : z.object({})

    const execute = async (rawArgs: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        const parsed = schemaObj.parse(rawArgs ?? {})
        const result = await handler(parsed as z.infer<z.ZodObject<Shape>>)
        if (isCallToolResult(result)) {
          return this.redactToolResult(result)
        }
        return this.okJson(result)
      } catch (err) {
        return this.errJson(err)
      }
    }

    this.toolRegistry.set(name, {
      name,
      description: options.description,
      invoke: execute
    })

    if (options.inputSchema) {
      ;(this.server.registerTool as Function)(
        name,
        {
          title: options.title,
          description: options.description,
          inputSchema: options.inputSchema,
          annotations: options.annotations
        },
        async (args: Record<string, unknown>) => execute(args)
      )
    } else {
      ;(this.server.registerTool as Function)(
        name,
        {
          title: options.title,
          description: options.description,
          annotations: options.annotations
        },
        async () => execute({})
      )
    }
  }

  getToolInvoker(name: string): RegisteredToolInvoker | undefined {
    return this.toolRegistry.get(name)
  }

  listRegisteredTools(): Array<{ name: string; description: string }> {
    return [...this.toolRegistry.values()].map((t) => ({
      name: t.name,
      description: t.description
    }))
  }

  redact<T>(value: T): T {
    return redactDeep(value, this.service.secretStore.getAllSecretValues())
  }

  okJson(payload: unknown): CallToolResult {
    const safe = this.redact(payload)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(safe, null, 2)
        }
      ]
    }
  }

  okImageAndJson(pngBase64: string, metadata: unknown): CallToolResult {
    const safe = this.redact(metadata)
    return {
      content: [
        {
          type: 'image',
          data: pngBase64,
          mimeType: 'image/png'
        },
        {
          type: 'text',
          text: JSON.stringify(safe, null, 2)
        }
      ]
    }
  }

  errJson(err: unknown): CallToolResult {
    const message = err instanceof Error ? err.message : String(err)
    const safeMsg = this.redact(message)
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: false, error: safeMsg }, null, 2)
        }
      ]
    }
  }

  private redactToolResult(res: CallToolResult): CallToolResult {
    const secrets = this.service.secretStore.getAllSecretValues()
    return {
      ...res,
      content: res.content.map((item) =>
        item.type === 'text' ? { ...item, text: redactDeep(item.text, secrets) } : item
      )
    }
  }

  /**
   * Reads PNG bytes from either a local file path or base64 string.
   */
  readPngBase64Input(input: { pngBase64?: string; filePath?: string }): string {
    if (input.pngBase64 && input.pngBase64.trim()) {
      return input.pngBase64.replace(/^data:image\/png;base64,/, '').trim()
    }
    if (input.filePath && input.filePath.trim()) {
      const abs = path.resolve(input.filePath)
      if (!fs.existsSync(abs)) {
        throw new Error(`Không tìm thấy tệp PNG tại: ${abs}`)
      }
      return fs.readFileSync(abs).toString('base64')
    }
    throw new Error('Cần cung cấp `filePath` hoặc `pngBase64`.')
  }

  summarizeProject(state: ProjectFullState) {
    const activeAssets = state.assets.filter((a) => !a.trashedAt)
    const trashedAssets = state.assets.filter((a) => Boolean(a.trashedAt))
    const approvedAssets = activeAssets.filter((a) => Boolean(a.approvedRevisionId))
    const draftAssets = activeAssets.filter((a) => !a.approvedRevisionId)

    return {
      projectId: state.config.projectId,
      name: state.config.name,
      rootDir: state.rootDir,
      schemaVersion: state.config.schemaVersion,
      tileSizePx: state.config.tileSizePx,
      pixelsPerUnit: state.config.pixelsPerUnit,
      defaultCanvasPx: state.config.defaultCanvasPx,
      defaultPerspective: state.config.defaultPerspective,
      activePaletteId: state.config.activePaletteId,
      activePresetId: state.config.activePresetId,
      undoRedo: state.undoRedo,
      counts: {
        activeAssets: activeAssets.length,
        approvedAssets: approvedAssets.length,
        draftAssets: draftAssets.length,
        trashedAssets: trashedAssets.length,
        revisions: state.revisions.length,
        clips: state.clips.length,
        tilesets: state.tilesets.length,
        scenes: state.scenes.length,
        dialogues: state.dialogues.length,
        quests: state.quests.length,
        dataTables: state.dataTables.length,
        uiScreens: state.uiScreens.length,
        vfxConfigs: state.vfxConfigs.length,
        cutscenes: state.cutscenes.length,
        stateFlags: state.stateFlags.length,
        folders: state.folders.length,
        palettes: state.palettes.length,
        presets: state.presets.length,
        promptTemplates: state.promptTemplates.length,
        jobs: state.jobs.length
      }
    }
  }
}

function isCallToolResult(val: unknown): val is CallToolResult {
  return (
    typeof val === 'object' &&
    val !== null &&
    'content' in val &&
    Array.isArray((val as CallToolResult).content)
  )
}
