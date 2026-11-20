import path from 'node:path'
import fs from 'node:fs'
import { app, BrowserWindow, safeStorage } from 'electron'
import { StudioService } from './ipc/studioService'
import { registerIpcHandlers } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null
let service: StudioService | null = null

function resolveSampleWorkshopDir(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'examples', 'workshop'),
    path.resolve(__dirname, '../../examples/workshop'),
    path.resolve(process.cwd(), 'examples', 'workshop')
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'studio.sqlite'))) return c
  }
  return path.resolve(process.cwd(), 'examples', 'workshop')
}

function resolveAppIconPath(): string | undefined {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const candidates = [
    path.join(process.resourcesPath ?? '', 'build', iconFile),
    path.resolve(__dirname, '../../build', iconFile),
    path.resolve(process.cwd(), 'build', iconFile),
    path.resolve(__dirname, '../renderer/icon.png')
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return undefined
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/index.js')
  if (!fs.existsSync(preloadPath)) {
    console.error(`[AI Pixel Studio] Missing preload script at: ${preloadPath}`)
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: '#181816',
    title: 'AI Pixel Studio',
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show()
    mainWindow.focus()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  const dataDir =
    process.env.AI_PIXEL_STUDIO_DATA_DIR || path.join(app.getPath('userData'), 'studio-data')
  service = new StudioService({
    appDataDir: dataDir,
    sampleWorkshopDir: resolveSampleWorkshopDir(),
    safeStorage
  })
  registerIpcHandlers(service, () => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (service) service.closeProject()
  if (process.platform !== 'darwin') app.quit()
})
