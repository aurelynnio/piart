import type { PixelStudioApi } from '../../../preload/index'

declare global {
  interface Window {
    pixelStudio: PixelStudioApi
  }
}

export {}
