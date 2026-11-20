import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

await build({
  entryPoints: [path.join(root, 'mcp/index.ts')],
  outfile: path.join(root, 'out/mcp/index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node'
  },
  // Keep native/dynamic runtime packages external so node_modules resolves them cleanly
  external: ['sql.js', 'pngjs', 'fflate', '@modelcontextprotocol/sdk', 'zod'],
  alias: {
    '@domain': path.join(root, 'domain'),
    '@main': path.join(root, 'app/main')
  },
  logLevel: 'info'
})
