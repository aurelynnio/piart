import crypto from 'node:crypto'
import { PNG } from 'pngjs'
import type { Direction, PaletteColor, RectPx } from '@domain/schemas/types'

export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array // length = width * height * 4
}

export interface SpriteAnalysisMetrics {
  width: number
  height: number
  opaquePixels: number
  semiTransparentPixels: number
  isEmpty: boolean
  touchesEdge: boolean
  bounds: RectPx | null
  footAnchorX: number
  footAnchorY: number
  offPaletteColors: number
}

export function computeSha256(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export function decodePng(buffer: Buffer): RgbaImage {
  const png = PNG.sync.read(buffer)
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data)
  }
}

export function encodePng(img: RgbaImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data)
  return PNG.sync.write(png, { colorType: 6 })
}

export function createBlankImage(width: number, height: number): RgbaImage {
  return {
    width,
    height,
    data: new Uint8Array(width * height * 4)
  }
}

export function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) : 255
  return [r, g, b, a]
}

export function rgbaToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

export function setPixel(
  img: RgbaImage,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255
): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  const i = (y * img.width + x) * 4
  img.data[i] = r
  img.data[i + 1] = g
  img.data[i + 2] = b
  img.data[i + 3] = a
}

export function fillRect(
  img: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
  hex: string
): void {
  const [r, g, b, a] = hexToRgba(hex)
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      setPixel(img, px, py, r, g, b, a)
    }
  }
}

export function drawOutline(img: RgbaImage, hex: string): void {
  const [r, g, b, a] = hexToRgba(hex)
  const copy = new Uint8Array(img.data)
  const isOpaque = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false
    return copy[(y * img.width + x) * 4 + 3] > 127
  }
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (isOpaque(x, y)) continue
      if (
        isOpaque(x - 1, y) ||
        isOpaque(x + 1, y) ||
        isOpaque(x, y - 1) ||
        isOpaque(x, y + 1)
      ) {
        setPixel(img, x, y, r, g, b, a)
      }
    }
  }
}

/**
 * Pixel-exact nearest-neighbor resize (never introduces blurry bilinear artifacts).
 */
export function resizeNearestNeighbor(
  src: RgbaImage,
  targetW: number,
  targetH: number
): RgbaImage {
  if (src.width === targetW && src.height === targetH) {
    return { width: src.width, height: src.height, data: new Uint8Array(src.data) }
  }
  const dst = createBlankImage(targetW, targetH)
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / targetH))
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / targetW))
      const si = (sy * src.width + sx) * 4
      const di = (y * targetW + x) * 4
      dst.data[di] = src.data[si]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = src.data[si + 3]
    }
  }
  return dst
}

/**
 * Removes solid border background via flood-fill color key and hardens pixel-art alpha edges.
 */
export function removeBackgroundAlpha(
  src: RgbaImage,
  options: {
    colorKeyHex?: string | null
    tolerance?: number
    alphaHardThreshold?: number
  } = {}
): RgbaImage {
  const dst: RgbaImage = { width: src.width, height: src.height, data: new Uint8Array(src.data) }
  const tol = options.tolerance ?? 28
  const threshold = options.alphaHardThreshold ?? 128

  // Determine key color from top-left if not specified and opaque
  let key: [number, number, number] | null = null
  if (options.colorKeyHex) {
    const [r, g, b] = hexToRgba(options.colorKeyHex)
    key = [r, g, b]
  } else if (dst.data[3] > 200) {
    key = [dst.data[0], dst.data[1], dst.data[2]]
  }

  if (key) {
    const visited = new Uint8Array(dst.width * dst.height)
    const queue: number[] = []
    const matchesKey = (idx: number) => {
      const i = idx * 4
      if (dst.data[i + 3] === 0) return true
      const dr = Math.abs(dst.data[i] - key![0])
      const dg = Math.abs(dst.data[i + 1] - key![1])
      const db = Math.abs(dst.data[i + 2] - key![2])
      return dr <= tol && dg <= tol && db <= tol
    }

    // Seed from all four borders
    for (let x = 0; x < dst.width; x++) {
      for (const y of [0, dst.height - 1]) {
        const idx = y * dst.width + x
        if (!visited[idx] && matchesKey(idx)) {
          visited[idx] = 1
          queue.push(idx)
        }
      }
    }
    for (let y = 0; y < dst.height; y++) {
      for (const x of [0, dst.width - 1]) {
        const idx = y * dst.width + x
        if (!visited[idx] && matchesKey(idx)) {
          visited[idx] = 1
          queue.push(idx)
        }
      }
    }

    while (queue.length > 0) {
      const idx = queue.shift()!
      const i = idx * 4
      dst.data[i] = 0
      dst.data[i + 1] = 0
      dst.data[i + 2] = 0
      dst.data[i + 3] = 0
      const x = idx % dst.width
      const y = Math.floor(idx / dst.width)
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ]
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= dst.width || ny >= dst.height) continue
        const nIdx = ny * dst.width + nx
        if (!visited[nIdx] && matchesKey(nIdx)) {
          visited[nIdx] = 1
          queue.push(nIdx)
        }
      }
    }
  }

  // Harden alpha to crisp 0 or 255 for clean pixel art
  for (let i = 0; i < dst.data.length; i += 4) {
    if (dst.data[i + 3] < threshold) {
      dst.data[i] = 0
      dst.data[i + 1] = 0
      dst.data[i + 2] = 0
      dst.data[i + 3] = 0
    } else {
      dst.data[i + 3] = 255
    }
  }

  return dst
}

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const srgb = [r, g, b].map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  const x = (srgb[0] * 0.4124 + srgb[1] * 0.3576 + srgb[2] * 0.1805) / 0.95047
  const y = (srgb[0] * 0.2126 + srgb[1] * 0.7152 + srgb[2] * 0.0722) / 1.0
  const z = (srgb[0] * 0.0193 + srgb[1] * 0.1192 + srgb[2] * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/**
 * Deterministic perceptual CIELAB palette mapping with optional ordered Bayer dithering.
 */
export function quantizeToPalette(
  src: RgbaImage,
  paletteColors: PaletteColor[],
  options: { dither?: boolean } = {}
): RgbaImage {
  if (paletteColors.length === 0) {
    return { width: src.width, height: src.height, data: new Uint8Array(src.data) }
  }
  const paletteRgb = paletteColors.map((c) => {
    const [r, g, b] = hexToRgba(c.hex)
    return { r, g, b, lab: rgbToLab(r, g, b) }
  })
  const dst = createBlankImage(src.width, src.height)
  const useDither = Boolean(options.dither)

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const a = src.data[i + 3]
      if (a === 0) continue

      const bias = useDither ? ((BAYER_4X4[y & 3][x & 3] / 16 - 0.5) * 18) : 0
      const r = Math.max(0, Math.min(255, src.data[i] + bias))
      const g = Math.max(0, Math.min(255, src.data[i + 1] + bias))
      const b = Math.max(0, Math.min(255, src.data[i + 2] + bias))
      const [L, A, B] = rgbToLab(r, g, b)

      let best = paletteRgb[0]
      let bestDist = Infinity
      for (const c of paletteRgb) {
        const dL = L - c.lab[0]
        const dA = A - c.lab[1]
        const dB = B - c.lab[2]
        const dist = dL * dL + dA * dA + dB * dB
        if (dist < bestDist) {
          bestDist = dist
          best = c
        }
      }

      dst.data[i] = best.r
      dst.data[i + 1] = best.g
      dst.data[i + 2] = best.b
      dst.data[i + 3] = a
    }
  }
  return dst
}

/**
 * Pixel-exact masked compositing: guarantees 100% byte identity outside masked pixels.
 */
export function compositeWithMask(
  source: RgbaImage,
  edited: RgbaImage,
  mask: RgbaImage
): RgbaImage {
  const alignedEdited = resizeNearestNeighbor(edited, source.width, source.height)
  const alignedMask = resizeNearestNeighbor(mask, source.width, source.height)
  const out: RgbaImage = {
    width: source.width,
    height: source.height,
    data: new Uint8Array(source.data)
  }

  for (let i = 0; i < out.data.length; i += 4) {
    // Mask active if alpha > 127 AND (any RGB channel > 127 or solid mask alpha)
    const maskActive = alignedMask.data[i + 3] > 127
    if (maskActive) {
      out.data[i] = alignedEdited.data[i]
      out.data[i + 1] = alignedEdited.data[i + 1]
      out.data[i + 2] = alignedEdited.data[i + 2]
      out.data[i + 3] = alignedEdited.data[i + 3]
    }
  }
  return out
}

export function cropAndResizeCanvas(
  src: RgbaImage,
  targetW: number,
  targetH: number,
  anchor:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'middle-left'
    | 'center'
    | 'middle-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right' = 'bottom-center'
): { image: RgbaImage; clippedOpaquePixels: number } {
  const dst = createBlankImage(targetW, targetH)
  let ox = 0
  let oy = 0

  if (anchor.includes('center') && !anchor.includes('left') && !anchor.includes('right')) {
    ox = Math.floor((targetW - src.width) / 2)
  } else if (anchor.includes('right')) {
    ox = targetW - src.width
  }

  if (anchor.startsWith('middle') || anchor === 'center') {
    oy = Math.floor((targetH - src.height) / 2)
  } else if (anchor.startsWith('bottom')) {
    oy = targetH - src.height
  }

  let clippedOpaquePixels = 0
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const si = (sy * src.width + sx) * 4
      const a = src.data[si + 3]
      const dx = sx + ox
      const dy = sy + oy
      if (dx < 0 || dy < 0 || dx >= targetW || dy >= targetH) {
        if (a > 0) clippedOpaquePixels += 1
        continue
      }
      const di = (dy * targetW + dx) * 4
      dst.data[di] = src.data[si]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = a
    }
  }

  return { image: dst, clippedOpaquePixels }
}

export function flipImage(src: RgbaImage, axis: 'horizontal' | 'vertical'): RgbaImage {
  const dst = createBlankImage(src.width, src.height)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const dx = axis === 'horizontal' ? src.width - 1 - x : x
      const dy = axis === 'vertical' ? src.height - 1 - y : y
      const si = (y * src.width + x) * 4
      const di = (dy * src.width + dx) * 4
      dst.data[di] = src.data[si]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = src.data[si + 3]
    }
  }
  return dst
}

export function rotate90Image(src: RgbaImage, clockwise = true): RgbaImage {
  const dst = createBlankImage(src.height, src.width)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const dx = clockwise ? src.height - 1 - y : y
      const dy = clockwise ? x : src.width - 1 - x
      const si = (y * src.width + x) * 4
      const di = (dy * dst.width + dx) * 4
      dst.data[di] = src.data[si]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = src.data[si + 3]
    }
  }
  return dst
}

export function composeLayers(
  width: number,
  height: number,
  layers: Array<{ image: RgbaImage; visible: boolean; opacity: number }>
): RgbaImage {
  const out = createBlankImage(width, height)
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue
    const img = resizeNearestNeighbor(layer.image, width, height)
    for (let i = 0; i < out.data.length; i += 4) {
      const sa = (img.data[i + 3] / 255) * layer.opacity
      if (sa <= 0) continue
      const da = out.data[i + 3] / 255
      const outA = sa + da * (1 - sa)
      if (outA <= 0) continue
      out.data[i] = Math.round((img.data[i] * sa + out.data[i] * da * (1 - sa)) / outA)
      out.data[i + 1] = Math.round((img.data[i + 1] * sa + out.data[i + 1] * da * (1 - sa)) / outA)
      out.data[i + 2] = Math.round((img.data[i + 2] * sa + out.data[i + 2] * da * (1 - sa)) / outA)
      out.data[i + 3] = Math.round(outA * 255)
    }
  }
  return out
}

export function sliceSpriteSheet(
  sheet: RgbaImage,
  rects: RectPx[]
): RgbaImage[] {
  return rects.map((r) => {
    const out = createBlankImage(r.w, r.h)
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const sx = r.x + x
        const sy = r.y + y
        if (sx < 0 || sy < 0 || sx >= sheet.width || sy >= sheet.height) continue
        const si = (sy * sheet.width + sx) * 4
        const di = (y * r.w + x) * 4
        out.data[di] = sheet.data[si]
        out.data[di + 1] = sheet.data[si + 1]
        out.data[di + 2] = sheet.data[si + 2]
        out.data[di + 3] = sheet.data[si + 3]
      }
    }
    return out
  })
}

export function packHorizontalStrip(frames: RgbaImage[], padding = 0): {
  sheet: RgbaImage
  rects: RectPx[]
} {
  if (frames.length === 0) {
    return { sheet: createBlankImage(1, 1), rects: [] }
  }
  const maxH = Math.max(...frames.map((f) => f.height))
  const totalW =
    frames.reduce((acc, f) => acc + f.width, 0) + padding * Math.max(0, frames.length - 1)
  const sheet = createBlankImage(totalW, maxH)
  const rects: RectPx[] = []
  let cursorX = 0
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const si = (y * frame.width + x) * 4
        const di = (y * sheet.width + (cursorX + x)) * 4
        sheet.data[di] = frame.data[si]
        sheet.data[di + 1] = frame.data[si + 1]
        sheet.data[di + 2] = frame.data[si + 2]
        sheet.data[di + 3] = frame.data[si + 3]
      }
    }
    rects.push({ x: cursorX, y: 0, w: frame.width, h: frame.height })
    cursorX += frame.width + padding
  }
  return { sheet, rects }
}

/**
 * Shelf-packing Texture Atlas with configurable padding + 1px edge extrusion
 * to eliminate seam bleeding in Unity Tilemap / Sprite rendering.
 */
export function packTextureAtlas(
  entries: Array<{ id: string; image: RgbaImage }>,
  options: { padding?: number; maxWidth?: number; extrude?: boolean } = {}
): {
  atlas: RgbaImage
  placements: Array<{ id: string; rect: RectPx }>
} {
  const padding = Math.max(0, options.padding ?? 2)
  const maxWidth = options.maxWidth ?? 2048
  const extrude = options.extrude ?? padding >= 2

  const sorted = [...entries].sort((a, b) => b.image.height - a.image.height)
  const placements: Array<{ id: string; rect: RectPx; image: RgbaImage }> = []

  let cursorX = padding
  let cursorY = padding
  let shelfH = 0
  let usedW = padding * 2
  let usedH = padding * 2

  for (const item of sorted) {
    const w = item.image.width
    const h = item.image.height
    if (cursorX + w + padding > maxWidth && cursorX > padding) {
      cursorX = padding
      cursorY += shelfH + padding
      shelfH = 0
    }
    placements.push({
      id: item.id,
      rect: { x: cursorX, y: cursorY, w, h },
      image: item.image
    })
    cursorX += w + padding
    shelfH = Math.max(shelfH, h)
    usedW = Math.max(usedW, cursorX)
    usedH = Math.max(usedH, cursorY + shelfH + padding)
  }

  // Round to clean dimensions (multiples of 4)
  const atlasW = Math.max(4, Math.ceil(usedW / 4) * 4)
  const atlasH = Math.max(4, Math.ceil(usedH / 4) * 4)
  const atlas = createBlankImage(atlasW, atlasH)

  const copyPx = (src: RgbaImage, sx: number, sy: number, dx: number, dy: number) => {
    if (dx < 0 || dy < 0 || dx >= atlas.width || dy >= atlas.height) return
    const si = (sy * src.width + sx) * 4
    const di = (dy * atlas.width + dx) * 4
    atlas.data[di] = src.data[si]
    atlas.data[di + 1] = src.data[si + 1]
    atlas.data[di + 2] = src.data[si + 2]
    atlas.data[di + 3] = src.data[si + 3]
  }

  for (const p of placements) {
    const { x: ox, y: oy, w, h } = p.rect
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        copyPx(p.image, x, y, ox + x, oy + y)
      }
    }
    if (extrude && w > 0 && h > 0) {
      for (let x = 0; x < w; x++) {
        copyPx(p.image, x, 0, ox + x, oy - 1)
        copyPx(p.image, x, h - 1, ox + x, oy + h)
      }
      for (let y = 0; y < h; y++) {
        copyPx(p.image, 0, y, ox - 1, oy + y)
        copyPx(p.image, w - 1, y, ox + w, oy + y)
      }
    }
  }

  return {
    atlas,
    placements: placements.map(({ id, rect }) => ({ id, rect }))
  }
}

export function analyzeSpriteMetrics(
  img: RgbaImage,
  paletteColors?: PaletteColor[]
): SpriteAnalysisMetrics {
  const paletteSet = paletteColors
    ? new Set(paletteColors.map((c) => c.hex.slice(0, 7).toUpperCase()))
    : null
  const offPaletteSet = new Set<string>()

  let opaquePixels = 0
  let semiTransparentPixels = 0
  let minX = img.width
  let minY = img.height
  let maxX = -1
  let maxY = -1
  let bottomXSum = 0
  let bottomXCount = 0

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      const a = img.data[i + 3]
      if (a === 0) continue
      if (a < 255) semiTransparentPixels += 1
      opaquePixels += 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (paletteSet) {
        const hex = rgbaToHex(img.data[i], img.data[i + 1], img.data[i + 2])
        if (!paletteSet.has(hex)) offPaletteSet.add(hex)
      }
    }
  }

  if (maxY >= 0) {
    for (let x = minX; x <= maxX; x++) {
      const i = (maxY * img.width + x) * 4
      if (img.data[i + 3] > 0) {
        bottomXSum += x
        bottomXCount += 1
      }
    }
  }

  const isEmpty = opaquePixels === 0
  const bounds: RectPx | null = isEmpty
    ? null
    : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }

  const touchesEdge =
    bounds !== null &&
    (bounds.x === 0 ||
      bounds.y === 0 ||
      bounds.x + bounds.w >= img.width ||
      bounds.y + bounds.h >= img.height)

  return {
    width: img.width,
    height: img.height,
    opaquePixels,
    semiTransparentPixels,
    isEmpty,
    touchesEdge,
    bounds,
    footAnchorX: bottomXCount > 0 ? Math.round(bottomXSum / bottomXCount) : Math.floor(img.width / 2),
    footAnchorY: maxY >= 0 ? maxY : img.height - 1,
    offPaletteColors: offPaletteSet.size
  }
}

export function computePixelDiffRatio(a: RgbaImage, b: RgbaImage): number {
  const alignedB = resizeNearestNeighbor(b, a.width, a.height)
  let diff = 0
  const total = a.width * a.height
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== alignedB.data[i] ||
      a.data[i + 1] !== alignedB.data[i + 1] ||
      a.data[i + 2] !== alignedB.data[i + 2] ||
      a.data[i + 3] !== alignedB.data[i + 3]
    ) {
      diff += 1
    }
  }
  return total > 0 ? diff / total : 0
}

/**
 * Deterministic original pixel-art procedural renderer for the bundled Workshop sample
 * and the MockTestAdapter (produces crisp, recognizable pixel art on transparent backgrounds).
 */
export const WORKSHOP_PALETTE_HEX = [
  '#1B1717', // Outline dark
  '#3A2820', // Deep wood / boots
  '#6E4730', // Medium wood / apron dark
  '#9A6744', // Warm wood / apron main
  '#C89463', // Light oak / highlight
  '#E8C69B', // Pale wood / parchment
  '#F2C9A0', // Skin base
  '#D69E73', // Skin shadow
  '#4F6D8A', // Slate shirt
  '#7BA0C0', // Shirt highlight
  '#8B9BB4', // Iron hammer head
  '#C0CBDC', // Metal highlight
  '#5A7D4C', // Foliage / accent green
  '#82D9B5', // Mint accent
  '#D96B43', // Warm lantern / ember
  '#F5E9D3'  // Cream text / bright
]

export function renderProceduralSprite(params: {
  kind:
    | 'character'
    | 'portrait'
    | 'outfit'
    | 'furniture_cabinet'
    | 'furniture_table'
    | 'furniture_chair'
    | 'item_hammer'
    | 'icon_hammer'
    | 'tile_wood_floor'
    | 'tile_wall'
    | 'tile_dirt'
    | 'tile_border'
    | 'ui_box'
    | 'ui_button'
    | 'vfx_dust'
  width: number
  height: number
  direction?: Direction
  frameIndex?: number
  totalFrames?: number
  variantSeed?: number
  stateName?: string
  hammerLow?: boolean
}): RgbaImage {
  const {
    kind,
    width,
    height,
    direction = 'down',
    frameIndex = 0,
    totalFrames = 6,
    variantSeed = 0,
    stateName = 'normal',
    hammerLow = false
  } = params

  const img = createBlankImage(width, height)
  const phase = totalFrames > 0 ? (frameIndex / totalFrames) * Math.PI * 2 : 0
  const stride = Math.round(Math.sin(phase) * 2)
  const bob = Math.abs(stride) > 0 ? -1 : 0

  if (kind === 'character') {
    // Draw at canonical 32x48 then scale nearest-neighbor to requested width x height
    const base = createBlankImage(32, 48)
    const shirtHex = variantSeed % 2 === 0 ? '#4F6D8A' : '#5A7D4C'
    const apronHex = '#9A6744'
    const apronDark = '#6E4730'
    const hairHex = '#3A2820'
    const skinHex = '#F2C9A0'
    const skinShade = '#D69E73'
    const bootHex = '#3A2820'

    // Head
    fillRect(base, 11, 7 + bob, 10, 9, skinHex)
    fillRect(base, 10, 5 + bob, 12, 4, hairHex)
    if (direction === 'up') {
      fillRect(base, 11, 8 + bob, 10, 7, hairHex)
    } else if (direction === 'left') {
      fillRect(base, 12, 10 + bob, 2, 2, '#1B1717')
      fillRect(base, 17, 7 + bob, 4, 8, hairHex)
    } else if (direction === 'right') {
      fillRect(base, 18, 10 + bob, 2, 2, '#1B1717')
      fillRect(base, 11, 7 + bob, 4, 8, hairHex)
    } else {
      fillRect(base, 13, 10 + bob, 2, 2, '#1B1717')
      fillRect(base, 17, 10 + bob, 2, 2, '#1B1717')
      fillRect(base, 14, 14 + bob, 4, 1, skinShade)
    }

    // Torso & Brown Carpenter Apron
    fillRect(base, 9, 17 + bob, 14, 14, shirtHex)
    fillRect(base, 11, 18 + bob, 10, 14, apronHex)
    fillRect(base, 11, 27 + bob, 10, 4, apronDark)
    fillRect(base, 12, 17 + bob, 2, 3, apronDark)
    fillRect(base, 18, 17 + bob, 2, 3, apronDark)

    // Arms + Hammer when facing left/down
    const leftArmY = 18 + bob + stride
    const rightArmY = 18 + bob - stride
    fillRect(base, 6, leftArmY, 3, 9, shirtHex)
    fillRect(base, 6, leftArmY + 8, 3, 2, skinHex)
    fillRect(base, 23, rightArmY, 3, 9, shirtHex)
    fillRect(base, 23, rightArmY + 8, 3, 2, skinHex)

    if (direction === 'left') {
      const hy = hammerLow ? leftArmY + 9 : leftArmY + 4
      fillRect(base, 2, hy, 5, 2, '#6E4730')
      fillRect(base, 1, hy - 2, 3, 5, '#8B9BB4')
      fillRect(base, 1, hy - 2, 2, 2, '#C0CBDC')
    }

    // Legs & Boots (anchored near y=45)
    const leftLegH = 11 - Math.max(0, stride)
    const rightLegH = 11 - Math.max(0, -stride)
    fillRect(base, 11, 32, 4, leftLegH, '#3A2820')
    fillRect(base, 10, 32 + leftLegH, 5, 3, bootHex)
    fillRect(base, 17, 32, 4, rightLegH, '#3A2820')
    fillRect(base, 17, 32 + rightLegH, 5, 3, bootHex)

    drawOutline(base, '#1B1717')
    return resizeNearestNeighbor(base, width, height)
  }

  if (kind === 'portrait') {
    const base = createBlankImage(64, 64)
    fillRect(base, 2, 2, 60, 60, '#3A2820')
    fillRect(base, 5, 5, 54, 54, '#E8C69B')
    fillRect(base, 16, 40, 32, 19, '#4F6D8A')
    fillRect(base, 22, 42, 20, 17, '#9A6744')
    fillRect(base, 20, 16, 24, 24, '#F2C9A0')
    fillRect(base, 18, 11, 28, 10, '#3A2820')
    fillRect(base, 25, 25, 4, 4, '#1B1717')
    fillRect(base, 35, 25, 4, 4, '#1B1717')
    fillRect(base, 27, 34, 10, 2, '#6E4730')
    return resizeNearestNeighbor(base, width, height)
  }

  if (kind === 'outfit') {
    const base = createBlankImage(32, 48)
    fillRect(base, 10, 18, 12, 15, '#D96B43')
    fillRect(base, 12, 22, 8, 5, '#E8C69B')
    drawOutline(base, '#1B1717')
    return resizeNearestNeighbor(base, width, height)
  }

  if (kind === 'furniture_cabinet') {
    const base = createBlankImage(64, 48)
    const openRatio = totalFrames > 1 ? frameIndex / (totalFrames - 1) : stateName === 'open' ? 1 : 0
    fillRect(base, 4, 6, 56, 38, '#6E4730')
    fillRect(base, 6, 8, 52, 8, '#C89463')
    fillRect(base, 6, 16, 52, 26, '#9A6744')
    // Interior shelf revealed as doors open
    if (openRatio > 0.05) {
      const gap = Math.round(openRatio * 20)
      fillRect(base, 32 - gap, 18, gap * 2, 22, '#3A2820')
      fillRect(base, 32 - gap + 2, 27, Math.max(0, gap * 2 - 4), 2, '#C89463')
      // Tools inside
      if (gap >= 6) {
        fillRect(base, 29, 21, 6, 4, '#8B9BB4')
      }
    }
    // Handles
    const offset = Math.round(openRatio * 14)
    fillRect(base, Math.max(8, 28 - offset), 26, 2, 4, '#E8C69B')
    fillRect(base, Math.min(54, 34 + offset), 26, 2, 4, '#E8C69B')
    drawOutline(base, '#1B1717')
    return resizeNearestNeighbor(base, width, height)
  }

  if (kind === 'furniture_table') {
    const base = createBlankImage(64, 48)
    fillRect(base, 4, 14, 56, 14, '#C89463')
    fillRect(base, 4, 26, 56, 4, '#9A6744')
    fillRect(base, 8, 30, 6, 14, '#6E4730')
    fillRect(base, 50, 30, 6, 14, '#6E4730')
    drawOutline(base, '#1B1717')
    return resizeNearestNeighbor(base, width, height)
  }

  if (kind === 'furniture_chair') {
    const base = createBlankImage(32, 32)
    fillRect(base, 9, 4, 14, 12, '#9A6744')
    fillRect(base, 8, 16, 16, 6, '#C89463')
    fillRect(base, 9, 22, 3, 8, '#6E4730')
    fillRect(base, 20, 22, 3, 8, '#6E4730')
    drawOutline(base, '#1B1717')
    return resizeNearestNeighbor(base, width, height)
  }

  if (kind === 'item_hammer' || kind === 'icon_hammer') {
    const base = createBlankImage(32, 32)
    for (let i = 0; i < 14; i++) {
      fillRect(base, 7 + i, 22 - i, 3, 3, '#9A6744')
    }
    fillRect(base, 16, 5, 11, 7, '#8B9BB4')
    fillRect(base, 17, 6, 9, 2, '#C0CBDC')
    drawOutline(base, '#1B1717')
    return resizeNearestNeighbor(base, width, height)
  }

  if (kind === 'tile_wood_floor') {
    fillRect(img, 0, 0, width, height, '#9A6744')
    for (let y = 0; y < height; y += 8) {
      fillRect(img, 0, y, width, 1, '#6E4730')
      fillRect(img, 0, y + 1, width, 1, '#C89463')
      const seamX = ((y / 8) % 2 === 0 ? Math.floor(width / 2) : Math.floor(width / 4))
      fillRect(img, seamX, y, 1, 8, '#6E4730')
    }
    return img
  }

  if (kind === 'tile_wall') {
    fillRect(img, 0, 0, width, height, '#3A2820')
    fillRect(img, 0, 0, width, Math.max(4, Math.floor(height * 0.25)), '#6E4730')
    fillRect(img, 0, height - 4, width, 4, '#1B1717')
    for (let x = 0; x < width; x += 8) {
      fillRect(img, x, 4, 1, height - 8, '#1B1717')
    }
    return img
  }

  if (kind === 'tile_dirt') {
    fillRect(img, 0, 0, width, height, '#6E4730')
    for (let y = 2; y < height; y += 6) {
      for (let x = (y % 4) + 2; x < width; x += 7) {
        fillRect(img, x, y, 2, 2, '#9A6744')
      }
    }
    return img
  }

  if (kind === 'tile_border') {
    fillRect(img, 0, 0, width, height, '#9A6744')
    fillRect(img, 0, 0, width, 4, '#3A2820')
    fillRect(img, 0, 4, width, 2, '#C89463')
    return img
  }

  if (kind === 'ui_box' || kind === 'ui_button') {
    const fillHex =
      stateName === 'pressed'
        ? '#6E4730'
        : stateName === 'disabled'
          ? '#4F6D8A'
          : kind === 'ui_button'
            ? '#82D9B5'
            : '#E8C69B'
    fillRect(img, 0, 0, width, height, '#1B1717')
    fillRect(img, 2, 2, width - 4, height - 4, '#6E4730')
    fillRect(img, 4, 4, width - 8, height - 8, fillHex)
    fillRect(img, 5, 5, width - 10, 2, '#F5E9D3')
    return img
  }

  // vfx_dust
  const r = Math.max(2, Math.round((width / 4) * (1 - frameIndex / Math.max(1, totalFrames))))
  const cx = Math.floor(width / 2)
  const cy = Math.floor(height / 2)
  for (let p = 0; p < 5; p++) {
    const ang = (p / 5) * Math.PI * 2 + frameIndex * 0.5
    const dist = 2 + frameIndex * 2
    const px = Math.round(cx + Math.cos(ang) * dist)
    const py = Math.round(cy + Math.sin(ang) * dist)
    fillRect(img, px - Math.floor(r / 2), py - Math.floor(r / 2), r, r, p % 2 === 0 ? '#E8C69B' : '#C89463')
  }
  return img
}
