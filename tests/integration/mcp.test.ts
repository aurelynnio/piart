import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createPiartMcpServer } from '../../mcp/server'

function parseJsonText(result: { content: Array<{ type: string; text?: string }> }): any {
  const txt = result.content.find((c) => c.type === 'text')
  if (!txt || !txt.text) throw new Error('Expected text content in MCP tool result')
  return JSON.parse(txt.text)
}

describe('AI Pixel Studio MCP Server — Full Automation Suite', () => {
  it('exposes complete tools/resources/prompts and automates full pixel art + gameplay + Unity export workflow', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piart-mcp-test-'))
    const appDataDir = path.join(tmpRoot, 'appdata')
    const workshopDir = path.join(tmpRoot, 'Workshop MCP')
    const exportDir = path.join(tmpRoot, 'Unity Export MCP')
    const exportedPng = path.join(tmpRoot, 'sword_preview.png')

    const { server, close } = await createPiartMcpServer({
      appDataDir,
      sampleWorkshopDir: path.resolve(process.cwd(), 'examples/workshop'),
      providerId: 'mock'
    })

    const client = new Client({ name: 'codex-test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      // 1) Discovery: tools, resources, resource templates, prompts
      const toolsList = await client.listTools()
      expect(toolsList.tools.length).toBeGreaterThanOrEqual(55)
      const toolNames = new Set(toolsList.tools.map((t) => t.name))
      expect(toolNames.has('studio_status')).toBe(true)
      expect(toolNames.has('pixel_paint_canvas')).toBe(true)
      expect(toolNames.has('studio_batch_execute')).toBe(true)
      expect(toolNames.has('studio_full_export_pipeline')).toBe(true)

      const resourcesList = await client.listResources()
      expect(resourcesList.resources.some((r) => r.uri === 'piart://status')).toBe(true)
      expect(resourcesList.resources.some((r) => r.uri === 'piart://project/assets')).toBe(true)

      const templatesList = await client.listResourceTemplates()
      expect(templatesList.resourceTemplates.some((t) => t.uriTemplate === 'piart://asset/{assetId}')).toBe(true)

      const promptsList = await client.listPrompts()
      expect(promptsList.prompts.some((p) => p.name === 'create_character_workflow')).toBe(true)
      expect(promptsList.prompts.some((p) => p.name === 'full_unity_export_audit')).toBe(true)

      // 2) Open sample workshop & verify via Resource URI
      const opened = parseJsonText(
        (await client.callTool({
          name: 'project_open_sample_workshop',
          arguments: { targetDir: workshopDir }
        })) as any
      )
      expect(opened.ok).toBe(true)
      expect(opened.project.counts.activeAssets).toBeGreaterThanOrEqual(15)

      const summaryRes = await client.readResource({ uri: 'piart://project/summary' })
      const summaryJson = JSON.parse((summaryRes.contents[0] as { text: string }).text)
      expect(summaryJson.counts.clips).toBeGreaterThanOrEqual(8)

      const carpRes = await client.readResource({ uri: 'piart://asset/character_carpenter' })
      const carpJson = JSON.parse((carpRes.contents[0] as { text: string }).text)
      expect(carpJson.asset.assetId).toBe('character_carpenter')
      expect(carpJson.clips.length).toBeGreaterThanOrEqual(8)

      // 3) Programmatic Pixel Art pipeline via studio_batch_execute
      const created = parseJsonText(
        (await client.callTool({
          name: 'pixel_create_blank_sprite',
          arguments: {
            name: 'Kiếm gỗ MCP',
            width: 16,
            height: 16,
            assetType: 'item',
            operations: [
              { op: 'fill_rect', x: 7, y: 2, w: 2, h: 9, hex: '#C89463' },
              { op: 'fill_rect', x: 5, y: 10, w: 6, h: 2, hex: '#9A6744' },
              { op: 'fill_rect', x: 7, y: 12, w: 2, h: 3, hex: '#3A2820' },
              { op: 'outline', hex: '#21170A' }
            ]
          }
        })) as any
      )
      expect(created.ok).toBe(true)
      const swordId = created.asset.assetId

      const batchRes = parseJsonText(
        (await client.callTool({
          name: 'studio_batch_execute',
          arguments: {
            steps: [
              {
                id: 'paint_gem',
                tool: 'pixel_paint_canvas',
                arguments: {
                  assetId: swordId,
                  operations: [{ op: 'set_pixel', x: 7, y: 10, hex: '#F1BE6B' }],
                  summary: 'Gắn ngọc hổ phách chuôi kiếm'
                }
              },
              {
                id: 'quantize',
                tool: 'pixel_transform',
                arguments: { assetId: swordId, op: 'quantize', autoApprove: true }
              },
              {
                id: 'qc',
                tool: 'pixel_analyze_sprite',
                arguments: { assetId: swordId }
              }
            ]
          }
        })) as any
      )
      expect(batchRes.ok).toBe(true)
      expect(batchRes.succeededSteps).toBe(3)
      expect(batchRes.results[2].output.metrics.opaquePixels).toBeGreaterThan(20)

      // Export PNG blob to file & receive MCP image block
      const pngRes = (await client.callTool({
        name: 'blob_export_png',
        arguments: { assetId: swordId, outputPath: exportedPng, includeImage: true }
      })) as any
      expect(fs.existsSync(exportedPng)).toBe(true)
      expect(pngRes.content.some((c: any) => c.type === 'image' && c.mimeType === 'image/png')).toBe(true)

      // 4) Prompt conflict detection (A02) + Deterministic clip speed edit (A05)
      const conflictPreview = parseJsonText(
        (await client.callTool({
          name: 'prompt_preview_plan',
          arguments: {
            mode: 'create',
            contentType: 'character',
            promptText: 'Tạo NPC 64 × 64',
            spriteWidth: 32,
            spriteHeight: 32,
            spriteSizeMode: 'selected'
          }
        })) as any
      )
      expect(conflictPreview.resolution.canExecute).toBe(false)
      expect(conflictPreview.resolution.conflicts.length).toBeGreaterThan(0)

      const speedEdit = parseJsonText(
        (await client.callTool({
          name: 'prompt_run_workflow',
          arguments: {
            mode: 'edit',
            targetAssetId: 'character_carpenter',
            targetClipId: 'clip_carpenter_walk_left',
            promptText: 'Cho clip đi trái chậm hơn 20%.'
          }
        })) as any
      )
      expect(speedEdit.ok).toBe(true)

      // 5) Dialogue Branch Simulation (A07)
      const dialoguesList = parseJsonText(
        (await client.callTool({
          name: 'world_list_entities',
          arguments: { entityType: 'dialogue' }
        })) as any
      )
      expect(dialoguesList.total).toBeGreaterThanOrEqual(1)
      const dialogueId = dialoguesList.items[0].dialogueId

      const simNoHammer = parseJsonText(
        (await client.callTool({
          name: 'world_dialogue_simulate',
          arguments: {
            dialogueId,
            inventory: {},
            edgeIds: ['e_missing']
          }
        })) as any
      )
      expect(simNoHammer.currentNode.text).toMatch(/Chưa có/i)

      const simWithHammer = parseJsonText(
        (await client.callTool({
          name: 'world_dialogue_simulate',
          arguments: {
            dialogueId,
            inventory: { item_hammer: 1 },
            edgeIds: ['e_has']
          }
        })) as any
      )
      expect(simWithHammer.currentNode.text).toMatch(/Cảm ơn/i)

      // 6) Full Unity Export Pipeline (Approve -> Preflight -> Export -> Verify SHA-256)
      const fullExport = parseJsonText(
        (await client.callTool({
          name: 'studio_full_export_pipeline',
          arguments: {
            targetDir: exportDir,
            scopeKind: 'project',
            approveDraftsFirst: true,
            includeAtlas: true,
            atlasPaddingPx: 2
          }
        })) as any
      )
      expect(fullExport.ok).toBe(true)
      expect(fullExport.verification.valid).toBe(true)
      expect(fs.existsSync(path.join(exportDir, 'manifest.json'))).toBe(true)
    } finally {
      await client.close()
      await close()
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('connects cleanly over real stdio transport using compiled out/mcp/index.mjs (Codex CLI mode)', async () => {
    const builtEntry = path.resolve(process.cwd(), 'out/mcp/index.mjs')
    if (!fs.existsSync(builtEntry)) {
      throw new Error(`Missing compiled MCP bundle at ${builtEntry}. Run npm run build:mcp first.`)
    }

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piart-mcp-stdio-'))
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [builtEntry, '--provider', 'mock', '--data-dir', path.join(tmpRoot, 'appdata')],
      stderr: 'pipe'
    })
    const client = new Client({ name: 'codex-stdio-smoke', version: '1.0.0' })

    try {
      await client.connect(transport)
      const tools = await client.listTools()
      expect(tools.tools.length).toBeGreaterThanOrEqual(55)

      const status = parseJsonText(
        (await client.callTool({ name: 'studio_status', arguments: {} })) as any
      )
      expect(status.settings.activeProviderId).toBe('mock')
      expect(status.sampleWorkshopAvailable).toBe(true)
    } finally {
      await client.close()
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})
