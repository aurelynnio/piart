import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createPiartMcpServer } from './server'

function parseCliArgs(argv: string[]): {
  projectDir?: string
  dataDir?: string
  provider?: 'openai' | 'mock'
} {
  const out: { projectDir?: string; dataDir?: string; provider?: 'openai' | 'mock' } = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === '--project' || arg === '-p') && argv[i + 1]) {
      out.projectDir = argv[++i]
    } else if ((arg === '--data-dir' || arg === '-d') && argv[i + 1]) {
      out.dataDir = argv[++i]
    } else if (arg === '--provider' && (argv[i + 1] === 'openai' || argv[i + 1] === 'mock')) {
      out.provider = argv[++i] as 'openai' | 'mock'
    }
  }
  return out
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2))
  const envProvider =
    process.env.AI_PIXEL_STUDIO_PROVIDER === 'openai' ||
    process.env.AI_PIXEL_STUDIO_PROVIDER === 'mock'
      ? process.env.AI_PIXEL_STUDIO_PROVIDER
      : undefined

  const { server, close } = await createPiartMcpServer({
    appDataDir: cli.dataDir ?? process.env.AI_PIXEL_STUDIO_DATA_DIR,
    initialProjectDir: cli.projectDir ?? process.env.AI_PIXEL_STUDIO_PROJECT_DIR,
    providerId: cli.provider ?? envProvider,
    openaiApiKey: process.env.OPENAI_API_KEY
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Always write operational logs to stderr (stdout is reserved strictly for MCP JSON-RPC frames)
  console.error('[piart-mcp] AI Pixel Studio MCP server ready on stdio.')

  const shutdown = async () => {
    await close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[piart-mcp] Fatal startup error:', err)
  process.exit(1)
})
