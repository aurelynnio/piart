import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const PALETTE = {
  '.': [0, 0, 0, 0], // Transparent outer corners
  'k': [14, 14, 12, 255], // Outer pixel outline (#0E0E0C)
  'h': [62, 60, 53, 255], // Top/left bevel highlight (#3E3C35)
  's': [20, 20, 18, 255], // Bottom/right bevel shadow (#141412)
  'b': [32, 32, 29, 255], // Studio panel body (#20201D)
  'w': [18, 19, 17, 255], // Recessed canvas well (#121311)
  'f': [53, 52, 46, 255], // Canvas grid frame (#35342E)

  // 3x3 Pixel Artboard Swatches (each with highlight + base)
  'U': [149, 191, 224, 255], // Sky blue highlight
  'u': [108, 152, 188, 255], // Sky blue base
  'E': [147, 222, 168, 255], // Emerald highlight
  'e': [107, 196, 141, 255], // Emerald base
  'C': [255, 252, 245, 255], // Cream highlight
  'c': [226, 221, 210, 255], // Cream base
  'N': [200, 148, 99, 255], // Wood highlight
  'n': [154, 103, 68, 255], // Wood base
  'R': [240, 140, 101, 255], // Terracotta highlight
  'r': [217, 107, 67, 255], // Terracotta base
  'I': [123, 146, 184, 255], // Indigo highlight
  'i': [86, 107, 142, 255], // Indigo base
  'V': [186, 152, 224, 255], // Lavender highlight
  'v': [142, 110, 184, 255], // Lavender base

  // Amber Accent & Active Pixel + Sparkle
  'A': [255, 242, 204, 255], // Bright amber core (#FFF2CC)
  'a': [241, 190, 107, 255], // Primary amber (#F1BE6B)
  'o': [204, 142, 56, 255], // Deep amber (#CC8E38)

  // Diagonal Pixel Stylus / Pencil (clean longitudinal bands)
  'P': [244, 147, 172, 255], // Eraser cap highlight (#F493AC)
  'p': [226, 109, 138, 255], // Eraser cap base (#E26D8A)
  'L': [224, 220, 210, 255], // Silver ferrule highlight
  'l': [162, 158, 148, 255], // Silver ferrule shade
  'M': [232, 184, 120, 255], // Stylus shaft upper-left highlight
  'm': [184, 122, 75, 255], // Stylus shaft mid-tone wood
  'd': [117, 72, 43, 255] // Stylus shaft lower-right shadow
}

// 32x32 hand-crafted pixel-art master icon:
// A recessed 3x3 pixel-art mosaic canvas being painted by a diagonal pixel stylus with an amber tip.
const GRID_32 = [
  '....kkkkkkkkkkkkkkkkkkkkkkkk....',
  '..kkhhhhhhhhhhhhhhhhhhhhhhhhkk..',
  '.khbbbbbbbbbbbbbbbbbbbbbbbbbbhk.',
  '.kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.',
  'khbbbbAbbbbbbbbbbbbbbbbbbkkkbbhk',
  'kbbbbAaAbbbbbbbbbbbbbbbbkPPpkbbk',
  'kbbbbbAbbbbbbbbbbbbbbbbkPPpppkbk',
  'kbbbbbbbbbbbbbbbbbbbbbkLLlpppkbk',
  'kbbbbffffffffffffffffbkMMllppkbk',
  'kbbbbfUUUUfEEEEfCCCCfkMMmllkkbbk',
  'kbbbbfUuuufEeeefCccckMMmmdkbbbbk',
  'kbbbbfUuuufEeeefCcckMMmmdkbbbbbk',
  'kbbbbfuuuufeeeefcckMMmmdkbbbbbbk',
  'kbbbbffffffffffffkMMmmdkbbbbbbbk',
  'kbbbbfNNNNfAAAAfkMMmmdkbbbbbbbbk',
  'kbbbbfNnnnfAaaakMMmmdkbbbbbbbbbk',
  'kbbbbfNnnnfAaakAAmmdkbbbbbbbbbbk',
  'kbbbbfnnnnfaaakAaaokfbbbbbbbbbbk',
  'kbbbbffffffffkAaaokffbbbbbbbbbbk',
  'kbbbbfRRRRfAAkAaokIIfbbbbbbbbbbk',
  'kbbbbfRrrrfAakaokIiifbbbbbbbbbbk',
  'kbbbbfRrrrfAaaokIiiifbbbbbbbbbbk',
  'kbbbbfrrrrfaaaofiiiifbbbbbbbbbbk',
  'kbbbbffffffffffffffffbbbbbbbbbbk',
  'kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk',
  'kbbbbbfaaafbfaaafbfaaafbbbbbbbbk',
  'kbbbbbfaaafbfaaafbfaaafbbbbbbbbk',
  'ksbbbbfffffffffffffffffbbbbbbbsk',
  '.kbbbbbbbbbbbbbbbbbbbbbbbbbbbbk.',
  '.kssssssssssssssssssssssssssssk.',
  '..kksssssssssssssssssssssssskk..',
  '....kkkkkkkkkkkkkkkkkkkkkkkk....'
]

if (GRID_32.length !== 32 || GRID_32.some((row) => row.length !== 32)) {
  throw new Error('GRID_32 must be strictly 32x32 characters.')
}

function renderBase32() {
  const data = new Uint8Array(32 * 32 * 4)
  for (let y = 0; y < 32; y++) {
    const row = GRID_32[y]
    for (let x = 0; x < 32; x++) {
      const ch = row[x]
      const rgba = PALETTE[ch]
      if (!rgba) throw new Error(`Unknown palette key "${ch}" at (${x}, ${y})`)
      const i = (y * 32 + x) * 4
      data[i] = rgba[0]
      data[i + 1] = rgba[1]
      data[i + 2] = rgba[2]
      data[i + 3] = rgba[3]
    }
  }
  return { width: 32, height: 32, data }
}

function scaleNearest(src, targetSize) {
  const out = new Uint8Array(targetSize * targetSize * 4)
  for (let y = 0; y < targetSize; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / targetSize))
    for (let x = 0; x < targetSize; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / targetSize))
      const si = (sy * src.width + sx) * 4
      const di = (y * targetSize + x) * 4
      out[di] = src.data[si]
      out[di + 1] = src.data[si + 1]
      out[di + 2] = src.data[si + 2]
      out[di + 3] = src.data[si + 3]
    }
  }
  return { width: targetSize, height: targetSize, data: out }
}

function encodePngBuffer(img) {
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data)
  return PNG.sync.write(png, { colorType: 6 })
}

function buildIcoBuffer(entries) {
  const count = entries.length
  const headerSize = 6
  const dirEntrySize = 16
  let offset = headerSize + count * dirEntrySize

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const dirBuffers = []
  const dataBuffers = []

  for (const { size, pngBuf } of entries) {
    const dir = Buffer.alloc(dirEntrySize)
    dir.writeUInt8(size >= 256 ? 0 : size, 0)
    dir.writeUInt8(size >= 256 ? 0 : size, 1)
    dir.writeUInt8(0, 2)
    dir.writeUInt8(0, 3)
    dir.writeUInt16LE(1, 4)
    dir.writeUInt16LE(32, 6)
    dir.writeUInt32LE(pngBuf.length, 8)
    dir.writeUInt32LE(offset, 12)
    offset += pngBuf.length
    dirBuffers.push(dir)
    dataBuffers.push(pngBuf)
  }

  return Buffer.concat([header, ...dirBuffers, ...dataBuffers])
}

const base32 = renderBase32()

const buildDir = path.join(root, 'build')
const rendererPublicDir = path.join(root, 'app/renderer/public')
fs.mkdirSync(buildDir, { recursive: true })
fs.mkdirSync(rendererPublicDir, { recursive: true })

const png512 = encodePngBuffer(scaleNearest(base32, 512))
fs.writeFileSync(path.join(buildDir, 'icon.png'), png512)

const png128 = encodePngBuffer(scaleNearest(base32, 128))
fs.writeFileSync(path.join(rendererPublicDir, 'icon.png'), png128)

const icoSizes = [16, 32, 48, 64, 256]
const icoEntries = icoSizes.map((size) => ({
  size,
  pngBuf: encodePngBuffer(scaleNearest(base32, size))
}))
fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIcoBuffer(icoEntries))

console.log('Generated pixel-art app icons:')
console.log(' - build/icon.png (512x512)')
console.log(' - build/icon.ico (16/32/48/64/256)')
console.log(' - app/renderer/public/icon.png (128x128)')
