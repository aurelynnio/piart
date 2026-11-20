import { z } from 'zod'
import { makeId } from '../../app/main/db/projectStore'
import type { Clip, RectPx } from '@domain/schemas/types'
import type { PiartMcpContext } from '../context'

export function registerAnimationTools(ctx: PiartMcpContext): void {
  ctx.registerTool(
    'clip_list',
    {
      title: 'Liệt kê Animation Clips',
      description: 'Liệt kê tất cả clip hoạt cảnh trong dự án, có thể lọc theo assetId, action hoặc direction.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        assetId: z.string().optional(),
        action: z.string().optional(),
        direction: z.enum(['down', 'up', 'left', 'right', 'down_left', 'down_right', 'up_left', 'up_right']).optional()
      }
    },
    (args) => {
      const state = ctx.service.requireStore().getFullState()
      const clips = state.clips
        .filter((c) => {
          if (args.assetId && c.assetId !== args.assetId) return false
          if (args.action && c.action !== args.action) return false
          if (args.direction && c.direction !== args.direction) return false
          return true
        })
        .map((c) => ({
          clipId: c.clipId,
          assetId: c.assetId,
          name: c.name,
          action: c.action,
          direction: c.direction,
          fps: c.fps,
          loopMode: c.loopMode,
          playbackSpeed: c.playbackSpeed,
          canvasPx: c.canvasPx,
          frameCount: c.frames.length,
          totalDurationMs: c.frames.reduce((acc, f) => acc + f.durationMs, 0),
          eventCount: c.events.length,
          status: c.status
        }))
      return { total: clips.length, clips }
    }
  )

  ctx.registerTool(
    'clip_get',
    {
      title: 'Xem chi tiết Animation Clip',
      description: 'Lấy toàn bộ cấu trúc clip bao gồm danh sách frame (durationMs, blobHash, isLocked, qcWarnings) và các mốc sự kiện (events).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        clipId: z.string().min(1)
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const clip = store.getEntity<Clip>('clip', args.clipId)
      if (!clip) throw new Error(`Không tìm thấy clip "${args.clipId}".`)
      return {
        clip,
        totalDurationMs: clip.frames.reduce((acc, f) => acc + f.durationMs, 0)
      }
    }
  )

  ctx.registerTool(
    'clip_update_timing',
    {
      title: 'Chỉnh tốc độ, FPS, kiểu lặp và thời lượng frame của Clip',
      description:
        'Cập nhật fps, loopMode, playbackSpeed, status hoặc thời lượng từng frame (frameDurationsMs / scaleFactor) của clip (hỗ trợ Undo).',
      inputSchema: {
        clipId: z.string().min(1),
        fps: z.number().min(1).max(60).optional(),
        loopMode: z.enum(['loop', 'once', 'ping_pong']).optional(),
        playbackSpeed: z.number().min(0.1).max(10).optional(),
        status: z.enum(['draft', 'approved']).optional(),
        frameDurationsMs: z
          .array(z.object({ frameIndex: z.number().int().min(0), durationMs: z.number().int().min(10).max(10000) }))
          .optional(),
        uniformDurationMs: z.number().int().min(10).max(10000).optional()
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const clip = store.getEntity<Clip>('clip', args.clipId)
      if (!clip) throw new Error(`Không tìm thấy clip "${args.clipId}".`)

      const durMap = new Map<number, number>()
      for (const item of args.frameDurationsMs ?? []) {
        durMap.set(item.frameIndex, item.durationMs)
      }

      const nextFrames = clip.frames.map((f, idx) => {
        if (durMap.has(idx)) return { ...f, durationMs: durMap.get(idx)! }
        if (args.uniformDurationMs !== undefined) return { ...f, durationMs: args.uniformDurationMs }
        return f
      })

      const nextClip: Clip = {
        ...clip,
        fps: args.fps ?? clip.fps,
        loopMode: args.loopMode ?? clip.loopMode,
        playbackSpeed: args.playbackSpeed ?? clip.playbackSpeed,
        status: args.status ?? clip.status,
        frames: nextFrames
      }

      ctx.service.saveClip(nextClip, `Cập nhật timing clip ${clip.name}`)
      return {
        ok: true,
        clipId: nextClip.clipId,
        fps: nextClip.fps,
        loopMode: nextClip.loopMode,
        playbackSpeed: nextClip.playbackSpeed,
        totalDurationMs: nextFrames.reduce((acc, f) => acc + f.durationMs, 0)
      }
    }
  )

  ctx.registerTool(
    'clip_edit_frames',
    {
      title: 'Thao tác Frame & Mốc sự kiện trên Timeline',
      description:
        'Khóa/mở khóa frame, di chuyển thứ tự frame, nhân bản frame, xóa frame hoặc thêm/xóa animation event markers (VD: footstep, attack_hit).',
      inputSchema: {
        clipId: z.string().min(1),
        action: z.enum(['toggle_lock', 'move', 'duplicate', 'delete', 'add_event', 'remove_event']),
        frameIndex: z.number().int().min(0).optional(),
        targetIndex: z.number().int().min(0).optional().describe('Dùng cho action=move'),
        eventName: z.string().optional().describe('Dùng cho action=add_event'),
        eventId: z.string().optional().describe('Dùng cho action=remove_event')
      }
    },
    (args) => {
      const store = ctx.service.requireStore()
      const clip = store.getEntity<Clip>('clip', args.clipId)
      if (!clip) throw new Error(`Không tìm thấy clip "${args.clipId}".`)

      let frames = [...clip.frames]
      let events = [...clip.events]
      let label = `Chỉnh sửa frame clip ${clip.name}`

      if (args.action === 'toggle_lock') {
        const idx = args.frameIndex ?? 0
        frames = frames.map((f, i) => (i === idx ? { ...f, isLocked: !f.isLocked } : f))
        label = `Khóa/mở khóa frame #${idx + 1}`
      } else if (args.action === 'move') {
        const from = args.frameIndex ?? 0
        const to = args.targetIndex ?? 0
        if (from < 0 || from >= frames.length || to < 0 || to >= frames.length) {
          throw new Error('Chỉ số frameIndex/targetIndex vượt phạm vi.')
        }
        const [item] = frames.splice(from, 1)
        frames.splice(to, 0, item)
        frames = frames.map((f, i) => ({ ...f, slotIndex: i }))
        label = `Dời frame #${from + 1} → #${to + 1}`
      } else if (args.action === 'duplicate') {
        const idx = args.frameIndex ?? 0
        const src = frames[idx]
        if (!src) throw new Error('Không tìm thấy frame cần nhân bản.')
        const copy = { ...src, frameId: makeId('frm'), isIntentionalHold: true }
        frames = [...frames.slice(0, idx + 1), copy, ...frames.slice(idx + 1)].map((f, i) => ({ ...f, slotIndex: i }))
        label = `Nhân bản frame #${idx + 1}`
      } else if (args.action === 'delete') {
        const idx = args.frameIndex ?? 0
        if (frames.length <= 1) throw new Error('Clip phải có ít nhất 1 frame.')
        const removed = frames[idx]
        frames = frames.filter((_, i) => i !== idx).map((f, i) => ({ ...f, slotIndex: i }))
        if (removed) events = events.filter((e) => e.frameId !== removed.frameId)
        label = `Xóa frame #${idx + 1}`
      } else if (args.action === 'add_event') {
        const idx = args.frameIndex ?? 0
        const target = frames[idx]
        if (!target) throw new Error('Không tìm thấy frame để gắn sự kiện.')
        if (!args.eventName?.trim()) throw new Error('Cần truyền `eventName`.')
        const timeMs = frames.slice(0, idx).reduce((acc, f) => acc + f.durationMs, 0)
        events.push({
          eventId: makeId('evt'),
          name: args.eventName.trim(),
          frameId: target.frameId,
          timeMs,
          payload: {}
        })
        label = `Gắn sự kiện "${args.eventName.trim()}"`
      } else if (args.action === 'remove_event') {
        if (!args.eventId) throw new Error('Cần truyền `eventId`.')
        events = events.filter((e) => e.eventId !== args.eventId)
        label = `Xóa sự kiện ${args.eventId}`
      }

      // Recompute event timestamps based on current frame ordering
      let acc = 0
      const startMap = new Map<string, number>()
      for (const f of frames) {
        startMap.set(f.frameId, acc)
        acc += f.durationMs
      }
      events = events.map((ev) => ({ ...ev, timeMs: startMap.get(ev.frameId) ?? ev.timeMs }))

      ctx.service.saveClip({ ...clip, frames, events }, label)
      return { ok: true, clipId: clip.clipId, frameCount: frames.length, events }
    }
  )

  ctx.registerTool(
    'clip_duplicate_or_reverse',
    {
      title: 'Nhân bản hoặc Đảo ngược Clip',
      description: 'Tạo một clip mới bằng cách sao chép hoặc đảo ngược thứ tự toàn bộ frame của clip hiện có.',
      inputSchema: {
        clipId: z.string().min(1),
        reverse: z.boolean().default(false),
        newActionName: z.string().optional()
      }
    },
    (args) => {
      const res = ctx.service.duplicateOrReverseClip(args.clipId, args.reverse, args.newActionName)
      return { ok: true, clip: res.clip }
    }
  )

  ctx.registerTool(
    'clip_import_spritesheet',
    {
      title: 'Tách Sprite Sheet thành Animation Clip',
      description:
        'Nhập ảnh sprite sheet (filePath hoặc pngBase64) và tách thành animation clip bằng lưới đều (frameWidth/frameHeight/frameCount) hoặc danh sách tọa độ rects tường minh.',
      inputSchema: {
        assetId: z.string().min(1),
        name: z.string().min(1),
        action: z.string().min(1),
        direction: z.enum(['down', 'up', 'left', 'right', 'down_left', 'down_right', 'up_left', 'up_right']).default('down'),
        fps: z.number().min(1).max(60).default(8),
        filePath: z.string().optional(),
        pngBase64: z.string().optional(),
        rects: z
          .array(z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) }))
          .optional(),
        grid: z
          .object({
            frameWidth: z.number().int().min(4),
            frameHeight: z.number().int().min(4),
            cols: z.number().int().min(1),
            rows: z.number().int().min(1).default(1),
            frameCount: z.number().int().min(1).optional()
          })
          .optional()
      }
    },
    (args) => {
      const pngBase64 = ctx.readPngBase64Input(args)
      let rects: RectPx[] = args.rects ?? []
      if (rects.length === 0 && args.grid) {
        const total = args.grid.frameCount ?? args.grid.cols * args.grid.rows
        for (let i = 0; i < total; i++) {
          const col = i % args.grid.cols
          const row = Math.floor(i / args.grid.cols)
          rects.push({
            x: col * args.grid.frameWidth,
            y: row * args.grid.frameHeight,
            w: args.grid.frameWidth,
            h: args.grid.frameHeight
          })
        }
      }
      if (rects.length === 0) {
        throw new Error('Cần truyền `rects` hoặc `grid` để tách sprite sheet.')
      }
      const res = ctx.service.importSpriteSheetAsClip({
        assetId: args.assetId,
        name: args.name,
        action: args.action,
        direction: args.direction,
        pngBase64,
        rects,
        fps: args.fps
      })
      return { ok: true, clip: res.clip }
    }
  )
}
