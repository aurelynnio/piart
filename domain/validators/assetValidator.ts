import type {
  Asset,
  AssetRevision,
  Clip,
  DialogueGraph,
  ExportManifest,
  Palette,
  Quest,
  Scene,
  StateFlag,
  TileSet,
  ValidationIssue
} from '../schemas/types'
import { ExportManifestSchema } from '../schemas/types'
import { validateDialogueGraph, validateQuest } from './gameplayValidator'

export interface SpriteCheckInput {
  asset: Asset
  revision: AssetRevision
  actualWidth?: number
  actualHeight?: number
  semiTransparentPixelCount?: number
  offPaletteColorCount?: number
  palette?: Palette | null
  enforcePalette?: boolean
  blobExists?: boolean
}

/**
 * F110: Kiểm tra kích thước, alpha, màu, rect và pivot của sprite được chọn.
 */
export function validateSprite(input: SpriteCheckInput): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { asset, revision } = input

  if (input.blobExists === false || !revision.normalizedBlobHash) {
    issues.push({
      code: 'SPRITE_MISSING_BLOB',
      severity: 'error',
      targetId: asset.assetId,
      targetType: 'asset',
      message: `Sprite "${asset.name}" thiếu tệp ảnh chuẩn hóa (${revision.revisionId}).`
    })
  }

  if (
    input.actualWidth !== undefined &&
    input.actualHeight !== undefined &&
    (input.actualWidth !== revision.canvasPx.w || input.actualHeight !== revision.canvasPx.h)
  ) {
    issues.push({
      code: 'SPRITE_SIZE_MISMATCH',
      severity: 'error',
      targetId: asset.assetId,
      targetType: 'asset',
      message: `Ảnh thực tế (${input.actualWidth}×${input.actualHeight}) không khớp canvas khai báo (${revision.canvasPx.w}×${revision.canvasPx.h}).`
    })
  }

  if (
    revision.pivotPx.x < 0 ||
    revision.pivotPx.x > revision.canvasPx.w ||
    revision.pivotPx.y < 0 ||
    revision.pivotPx.y > revision.canvasPx.h
  ) {
    issues.push({
      code: 'SPRITE_PIVOT_OUT_OF_BOUNDS',
      severity: 'error',
      targetId: asset.assetId,
      targetType: 'asset',
      message: `Điểm neo (${revision.pivotPx.x}, ${revision.pivotPx.y}) nằm ngoài biên canvas ${revision.canvasPx.w}×${revision.canvasPx.h}.`
    })
  }

  if (revision.collisionBox) {
    const cb = revision.collisionBox
    if (cb.x + cb.w > revision.canvasPx.w || cb.y + cb.h > revision.canvasPx.h) {
      issues.push({
        code: 'SPRITE_COLLISION_OUT_OF_BOUNDS',
        severity: 'warning',
        targetId: asset.assetId,
        targetType: 'asset',
        message: `Hộp va chạm vượt ngoài biên canvas của "${asset.name}".`
      })
    }
  }

  if (input.semiTransparentPixelCount && input.semiTransparentPixelCount > 0) {
    issues.push({
      code: 'SPRITE_SEMI_TRANSPARENT_PIXELS',
      severity: 'warning',
      targetId: asset.assetId,
      targetType: 'asset',
      message: `Phát hiện ${input.semiTransparentPixelCount} pixel bán trong suốt (alpha 1..254) trên "${asset.name}".`
    })
  }

  if (input.enforcePalette && input.offPaletteColorCount && input.offPaletteColorCount > 0) {
    issues.push({
      code: 'SPRITE_OFF_PALETTE',
      severity: 'warning',
      targetId: asset.assetId,
      targetType: 'asset',
      message: `Sprite "${asset.name}" có ${input.offPaletteColorCount} màu chưa khớp palette "${input.palette?.name ?? ''}".`
    })
  }

  return issues
}

/**
 * F111: Kiểm tra số frame, thời lượng, clip, hướng và tài nguyên thiếu.
 */
export function validateClip(
  clip: Clip,
  existingBlobs?: Set<string>,
  expectedFrameCount?: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (clip.frames.length === 0) {
    issues.push({
      code: 'CLIP_EMPTY',
      severity: 'error',
      targetId: clip.clipId,
      targetType: 'clip',
      message: `Clip "${clip.name}" chưa có frame nào.`
    })
    return issues
  }

  if (expectedFrameCount !== undefined && clip.frames.length !== expectedFrameCount) {
    issues.push({
      code: 'CLIP_FRAME_COUNT_MISMATCH',
      severity: 'error',
      targetId: clip.clipId,
      targetType: 'clip',
      message: `Clip "${clip.name}" có ${clip.frames.length} frame, khác kế hoạch ${expectedFrameCount} frame.`
    })
  }

  const frameIds = new Set<string>()
  for (const frame of clip.frames) {
    frameIds.add(frame.frameId)
    if (frame.durationMs <= 0) {
      issues.push({
        code: 'FRAME_INVALID_DURATION',
        severity: 'error',
        targetId: frame.frameId,
        targetType: 'frame',
        message: `Frame #${frame.slotIndex + 1} của "${clip.name}" có thời lượng không hợp lệ (${frame.durationMs} ms).`
      })
    }
    if (existingBlobs && !existingBlobs.has(frame.blobHash)) {
      issues.push({
        code: 'FRAME_MISSING_BLOB',
        severity: 'error',
        targetId: frame.frameId,
        targetType: 'frame',
        message: `Frame #${frame.slotIndex + 1} của "${clip.name}" thiếu tệp ảnh blob (${frame.blobHash.slice(0, 10)}).`
      })
    }
  }

  for (const ev of clip.events) {
    if (!frameIds.has(ev.frameId)) {
      issues.push({
        code: 'EVENT_ORPHAN_FRAME',
        severity: 'warning',
        targetId: ev.eventId,
        targetType: 'event',
        message: `Marker sự kiện "${ev.name}" trỏ tới frame không còn tồn tại trong "${clip.name}".`
      })
    }
  }

  return issues
}

/**
 * F112 & F073: Kiểm tra liên kết map, footprint, NPC, trigger, hội thoại và nhiệm vụ trước khi xuất.
 */
export function validateSceneAndGameplay(input: {
  scene: Scene
  tilesets: TileSet[]
  assets: Asset[]
  dialogues: DialogueGraph[]
  quests: Quest[]
  flags: StateFlag[]
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { scene, tilesets, assets, dialogues, quests, flags } = input
  const activeAssets = assets.filter((a) => !a.trashedAt)
  const assetMap = new Map(activeAssets.map((a) => [a.assetId, a]))
  const assetIds = new Set(activeAssets.map((a) => a.assetId))
  const dialogueMap = new Map(dialogues.map((d) => [d.dialogueId, d]))
  const questMap = new Map(quests.map((q) => [q.questId, q]))

  if (scene.tilesetId && !tilesets.some((t) => t.tilesetId === scene.tilesetId)) {
    issues.push({
      code: 'SCENE_MISSING_TILESET',
      severity: 'error',
      targetId: scene.sceneId,
      targetType: 'scene',
      message: `Bản đồ "${scene.name}" tham chiếu tileset không tồn tại (${scene.tilesetId}).`
    })
  }

  // Footprint overlap & out-of-bounds detection
  const occupied = new Map<string, string>()
  for (const p of scene.placements) {
    if (!assetMap.has(p.assetId)) {
      issues.push({
        code: 'PLACEMENT_MISSING_ASSET',
        severity: 'error',
        targetId: p.placementId,
        targetType: 'placement',
        message: `Vật thể "${p.name}" trên bản đồ trỏ tới asset không tồn tại hoặc đã xóa (${p.assetId}).`
      })
    }
    if (p.linkedDialogueId && !dialogueMap.has(p.linkedDialogueId)) {
      issues.push({
        code: 'PLACEMENT_BROKEN_DIALOGUE',
        severity: 'error',
        targetId: p.placementId,
        targetType: 'placement',
        message: `Vật thể "${p.name}" gắn hội thoại không tồn tại (${p.linkedDialogueId}).`
      })
    }
    if (p.linkedQuestId && !questMap.has(p.linkedQuestId)) {
      issues.push({
        code: 'PLACEMENT_BROKEN_QUEST',
        severity: 'error',
        targetId: p.placementId,
        targetType: 'placement',
        message: `Vật thể "${p.name}" gắn nhiệm vụ không tồn tại (${p.linkedQuestId}).`
      })
    }

    const outOfBounds =
      p.gridX < 0 ||
      p.gridY < 0 ||
      p.gridX + p.footprint.w > scene.cols ||
      p.gridY + p.footprint.h > scene.rows

    if (outOfBounds) {
      issues.push({
        code: 'PLACEMENT_OUT_OF_BOUNDS',
        severity: 'error',
        targetId: p.placementId,
        targetType: 'placement',
        message: `Vật thể "${p.name}" tại (${p.gridX}, ${p.gridY}) với footprint ${p.footprint.w}×${p.footprint.h} vượt biên bản đồ ${scene.cols}×${scene.rows}.`
      })
    } else if (p.blocksMovement) {
      for (let dy = 0; dy < p.footprint.h; dy++) {
        for (let dx = 0; dx < p.footprint.w; dx++) {
          const cellKey = `${p.gridX + dx},${p.gridY + dy}`
          const prev = occupied.get(cellKey)
          if (prev) {
            issues.push({
              code: 'PLACEMENT_FOOTPRINT_OVERLAP',
              severity: 'warning',
              targetId: p.placementId,
              targetType: 'placement',
              message: `Vật thể "${p.name}" chồng lấn footprint tại ô (${cellKey}) với "${prev}".`
            })
          } else {
            occupied.set(cellKey, p.name)
          }
        }
      }
    }
  }

  // Unique marker IDs and bounds
  const markerIds = new Set<string>()
  for (const m of scene.markers) {
    if (markerIds.has(m.markerId)) {
      issues.push({
        code: 'DUPLICATE_MARKER_ID',
        severity: 'error',
        targetId: m.markerId,
        targetType: 'marker',
        message: `Trùng ID marker "${m.markerId}" trên bản đồ "${scene.name}".`
      })
    }
    markerIds.add(m.markerId)
    if (m.gridX < 0 || m.gridY < 0 || m.gridX >= scene.cols || m.gridY >= scene.rows) {
      issues.push({
        code: 'MARKER_OUT_OF_BOUNDS',
        severity: 'error',
        targetId: m.markerId,
        targetType: 'marker',
        message: `Marker "${m.name}" (${m.kind}) nằm ngoài biên bản đồ.`
      })
    }
    if (m.linkedDialogueId && !dialogueMap.has(m.linkedDialogueId)) {
      issues.push({
        code: 'MARKER_BROKEN_DIALOGUE',
        severity: 'error',
        targetId: m.markerId,
        targetType: 'marker',
        message: `Trigger "${m.name}" gắn hội thoại không tồn tại.`
      })
    }
    if (m.linkedQuestId && !questMap.has(m.linkedQuestId)) {
      issues.push({
        code: 'MARKER_BROKEN_QUEST',
        severity: 'error',
        targetId: m.markerId,
        targetType: 'marker',
        message: `Trigger "${m.name}" gắn nhiệm vụ không tồn tại.`
      })
    }
  }

  // Validate linked dialogues & quests
  for (const d of dialogues) {
    issues.push(...validateDialogueGraph(d, { assetIds, flags, quests }))
  }
  for (const q of quests) {
    issues.push(...validateQuest(q, { assetIds, flags, quests }))
  }

  return issues
}

/**
 * F117: Kiểm tra hợp đồng manifest và tính toàn vẹn tham chiếu/checksum.
 */
export function validateManifestObject(
  rawManifest: unknown,
  actualChecksums?: Map<string, string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const parsed = ExportManifestSchema.safeParse(rawManifest)
  if (!parsed.success) {
    for (const err of parsed.error.issues) {
      issues.push({
        code: 'MANIFEST_SCHEMA_INVALID',
        severity: 'error',
        targetId: null,
        targetType: 'manifest',
        message: `Manifest lỗi schema tại "${err.path.join('.')}": ${err.message}`
      })
    }
    return issues
  }

  const manifest: ExportManifest = parsed.data
  const idSet = new Set(manifest.entries.map((e) => e.stableId))

  for (const entry of manifest.entries) {
    if (entry.relativePath.includes('..') || /^[a-zA-Z]:|^\/|^\\/.test(entry.relativePath)) {
      issues.push({
        code: 'MANIFEST_UNSAFE_PATH',
        severity: 'error',
        targetId: entry.stableId,
        targetType: 'manifest',
        message: `Đường dẫn không an toàn trong manifest: "${entry.relativePath}".`
      })
    }
    for (const dep of entry.dependencies) {
      if (!idSet.has(dep)) {
        issues.push({
          code: 'MANIFEST_MISSING_DEPENDENCY',
          severity: 'warning',
          targetId: entry.stableId,
          targetType: 'manifest',
          message: `Mục "${entry.name}" phụ thuộc stableId "${dep}" không nằm trong gói xuất.`
        })
      }
    }
    if (actualChecksums) {
      const actual = actualChecksums.get(entry.relativePath)
      if (!actual) {
        issues.push({
          code: 'MANIFEST_FILE_MISSING',
          severity: 'error',
          targetId: entry.stableId,
          targetType: 'manifest',
          message: `Thiếu tệp "${entry.relativePath}" khai báo trong manifest.`
        })
      } else if (actual !== entry.sha256) {
        issues.push({
          code: 'MANIFEST_CHECKSUM_MISMATCH',
          severity: 'error',
          targetId: entry.stableId,
          targetType: 'manifest',
          message: `Sai checksum SHA-256 cho "${entry.relativePath}" (kỳ vọng ${entry.sha256.slice(0, 12)}, thực tế ${actual.slice(0, 12)}).`
        })
      }
    }
  }

  return issues
}
