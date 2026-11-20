import { parentPort } from 'node:worker_threads'
import {
  analyzeSpriteMetrics,
  compositeWithMask,
  computeSha256,
  decodePng,
  encodePng,
  packTextureAtlas,
  quantizeToPalette,
  removeBackgroundAlpha,
  resizeNearestNeighbor
} from './pixelEngine'
import type { PaletteColor } from '@domain/schemas/types'

export type ImagingWorkerRequest =
  | { id: string; op: 'sha256'; pngBase64: string }
  | {
      id: string
      op: 'quantize'
      pngBase64: string
      palette: PaletteColor[]
      dither?: boolean
    }
  | {
      id: string
      op: 'compositeMask'
      sourceBase64: string
      editedBase64: string
      maskBase64: string
    }
  | {
      id: string
      op: 'removeBg'
      pngBase64: string
      colorKeyHex?: string | null
      tolerance?: number
      alphaHardThreshold?: number
    }
  | {
      id: string
      op: 'resize'
      pngBase64: string
      width: number
      height: number
    }
  | {
      id: string
      op: 'analyze'
      pngBase64: string
      palette?: PaletteColor[]
    }
  | {
      id: string
      op: 'packAtlas'
      entries: Array<{ id: string; pngBase64: string }>
      padding?: number
      maxWidth?: number
      extrude?: boolean
    }

function handleRequest(req: ImagingWorkerRequest): unknown {
  switch (req.op) {
    case 'sha256':
      return { sha256: computeSha256(Buffer.from(req.pngBase64, 'base64')) }
    case 'quantize': {
      const img = decodePng(Buffer.from(req.pngBase64, 'base64'))
      const out = encodePng(quantizeToPalette(img, req.palette, { dither: req.dither }))
      return { pngBase64: out.toString('base64'), sha256: computeSha256(out) }
    }
    case 'compositeMask': {
      const src = decodePng(Buffer.from(req.sourceBase64, 'base64'))
      const edited = decodePng(Buffer.from(req.editedBase64, 'base64'))
      const mask = decodePng(Buffer.from(req.maskBase64, 'base64'))
      const out = encodePng(compositeWithMask(src, edited, mask))
      return { pngBase64: out.toString('base64'), sha256: computeSha256(out) }
    }
    case 'removeBg': {
      const img = decodePng(Buffer.from(req.pngBase64, 'base64'))
      const out = encodePng(
        removeBackgroundAlpha(img, {
          colorKeyHex: req.colorKeyHex,
          tolerance: req.tolerance,
          alphaHardThreshold: req.alphaHardThreshold
        })
      )
      return { pngBase64: out.toString('base64'), sha256: computeSha256(out) }
    }
    case 'resize': {
      const img = decodePng(Buffer.from(req.pngBase64, 'base64'))
      const out = encodePng(resizeNearestNeighbor(img, req.width, req.height))
      return { pngBase64: out.toString('base64'), sha256: computeSha256(out) }
    }
    case 'analyze': {
      const img = decodePng(Buffer.from(req.pngBase64, 'base64'))
      return analyzeSpriteMetrics(img, req.palette)
    }
    case 'packAtlas': {
      const decoded = req.entries.map((e) => ({
        id: e.id,
        image: decodePng(Buffer.from(e.pngBase64, 'base64'))
      }))
      const packed = packTextureAtlas(decoded, {
        padding: req.padding,
        maxWidth: req.maxWidth,
        extrude: req.extrude
      })
      const out = encodePng(packed.atlas)
      return {
        pngBase64: out.toString('base64'),
        sha256: computeSha256(out),
        width: packed.atlas.width,
        height: packed.atlas.height,
        placements: packed.placements
      }
    }
  }
}

if (parentPort) {
  parentPort.on('message', (req: ImagingWorkerRequest) => {
    try {
      const data = handleRequest(req)
      parentPort!.postMessage({ id: req.id, ok: true, data })
    } catch (err) {
      parentPort!.postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  })
}
