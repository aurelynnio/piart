import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@domain': resolve(__dirname, 'domain'),
        '@main': resolve(__dirname, 'app/main')
      }
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'app/main/index.ts'),
          'imaging-worker': resolve(__dirname, 'app/main/imaging/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@domain': resolve(__dirname, 'domain')
      }
    },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'app/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'app/renderer'),
    resolve: {
      alias: {
        '@domain': resolve(__dirname, 'domain'),
        '@renderer': resolve(__dirname, 'app/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'app/renderer/index.html')
        }
      }
    }
  }
})
