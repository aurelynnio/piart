import type {
  ClipFrame,
  NineSliceBorders,
  PointPx,
  RectPx,
  SizePx
} from '../schemas/types'

export interface UnityRect {
  x: number
  y: number
  width: number
  height: number
}

export interface UnityPivot {
  x: number
  y: number
}

export interface UnityCell {
  x: number
  y: number
  z: number
}

export interface UnityNineSliceBorder {
  x: number // left
  y: number // bottom
  z: number // right
  w: number // top
}

export interface UnityAnimationKeyframe {
  timeSec: number
  frameId: string
  slotIndex: number
  blobHash: string
  isTerminalHold?: boolean
}

/**
 * Studio origin is top-left (0,0). Unity Sprite Rect origin is bottom-left (0,0).
 */
export function studioRectToUnityRect(rect: RectPx, textureHeight: number): UnityRect {
  if (rect.y + rect.h > textureHeight) {
    throw new Error(
      `Rect (${rect.x},${rect.y},${rect.w},${rect.h}) exceeds texture height ${textureHeight}`
    )
  }
  return {
    x: rect.x,
    y: textureHeight - rect.y - rect.h,
    width: rect.w,
    height: rect.h
  }
}

export function unityRectToStudioRect(rect: UnityRect, textureHeight: number): RectPx {
  return {
    x: rect.x,
    y: textureHeight - rect.y - rect.height,
    w: rect.width,
    h: rect.height
  }
}

/**
 * Studio pivot is pixel coordinate (px, py) from top-left of sprite.
 * Unity normalized pivot is [0..1] from bottom-left.
 */
export function studioPivotToUnityPivot(pivot: PointPx, spriteSize: SizePx): UnityPivot {
  return {
    x: Number((pivot.x / spriteSize.w).toFixed(6)),
    y: Number((1 - pivot.y / spriteSize.h).toFixed(6))
  }
}

export function unityPivotToStudioPivot(pivot: UnityPivot, spriteSize: SizePx): PointPx {
  return {
    x: Math.round(pivot.x * spriteSize.w),
    y: Math.round((1 - pivot.y) * spriteSize.h)
  }
}

/**
 * Studio tilemap grid has row = 0 at top edge.
 * Unity Tilemap cell has y = rows - 1 - row so north is +Y.
 */
export function studioTileToUnityCell(col: number, row: number, totalRows: number): UnityCell {
  return {
    x: col,
    y: totalRows - 1 - row,
    z: 0
  }
}

export function unityCellToStudioTile(cell: UnityCell, totalRows: number): { col: number; row: number } {
  return {
    col: cell.x,
    row: totalRows - 1 - cell.y
  }
}

/**
 * Studio 9-slice is (left, top, right, bottom).
 * Unity SpriteMetaData.border Vector4 is (left, bottom, right, top).
 */
export function studioNineSliceToUnityBorder(borders: NineSliceBorders): UnityNineSliceBorder {
  return {
    x: borders.left,
    y: borders.bottom,
    z: borders.right,
    w: borders.top
  }
}

/**
 * Exact integer millisecond scaling for speed factor changes.
 * Example: "chậm hơn 20%" -> speedFactor = 0.8 -> duration multiplier = 1 / 0.8 = 1.25.
 * 120 ms -> 150 ms; 125 ms -> 156 ms.
 */
export function scaleFrameDurationMs(durationMs: number, speedFactor: number): number {
  if (!Number.isFinite(speedFactor) || speedFactor <= 0) {
    throw new Error(`Invalid speedFactor: ${speedFactor}`)
  }
  return Math.max(1, Math.round(durationMs / speedFactor))
}

export function fpsToFrameDurationMs(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`Invalid fps: ${fps}`)
  }
  return Math.max(1, Math.round(1000 / fps))
}

/**
 * Converts studio integer-ms clip frames into Unity ObjectReferenceKeyframe timestamps (seconds),
 * including an explicit terminal hold keyframe so the final frame displays for its full duration.
 */
export function clipFramesToUnityKeyframes(frames: ClipFrame[]): {
  keyframes: UnityAnimationKeyframe[]
  totalDurationMs: number
  totalDurationSec: number
} {
  const keyframes: UnityAnimationKeyframe[] = []
  let cumulativeMs = 0

  for (const frame of frames) {
    keyframes.push({
      timeSec: Number((cumulativeMs / 1000).toFixed(6)),
      frameId: frame.frameId,
      slotIndex: frame.slotIndex,
      blobHash: frame.blobHash
    })
    cumulativeMs += frame.durationMs
  }

  if (frames.length > 0) {
    const last = frames[frames.length - 1]
    keyframes.push({
      timeSec: Number((cumulativeMs / 1000).toFixed(6)),
      frameId: last.frameId,
      slotIndex: last.slotIndex,
      blobHash: last.blobHash,
      isTerminalHold: true
    })
  }

  return {
    keyframes,
    totalDurationMs: cumulativeMs,
    totalDurationSec: Number((cumulativeMs / 1000).toFixed(6))
  }
}

export function slugifyAscii(input: string): string {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'asset'
}

export function buildUnityClipName(assetSlug: string, action: string, direction: string): string {
  return `${slugifyAscii(assetSlug)}_${slugifyAscii(action)}_${slugifyAscii(direction)}.anim`
}
