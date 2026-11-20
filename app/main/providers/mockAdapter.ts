import type { ModelCapability, ProviderErrorCategory } from '@domain/schemas/types'
import {
  decodePng,
  encodePng,
  fillRect,
  renderProceduralSprite
} from '../imaging/pixelEngine'
import {
  ProviderError,
  type ConnectionCheckResult,
  type ImageEditRequest,
  type ImageEditResponse,
  type ImageGenerateRequest,
  type ImageGenerateResponse,
  type PlanGenerateRequest,
  type PlanGenerateResponse,
  type ProviderAdapter
} from './adapter'

export interface MockFaultRule {
  category: ProviderErrorCategory
  statusCode?: number
  retryAfterMs?: number
  message?: string
  remainingTriggers?: number
}

export const MOCK_CAPABILITIES: ModelCapability[] = [
  {
    modelId: 'mock-planner-v1',
    providerId: 'mock',
    displayName: '[Mock Kiểm thử] Planner JSON xác định',
    supportsPlanning: true,
    supportsImageGenerate: false,
    supportsImageEditWithMask: false,
    supportsReferenceImages: true,
    supportsTransparentBackground: false,
    maxInputBytes: 25 * 1024 * 1024,
    isMock: true
  },
  {
    modelId: 'mock-image-v1',
    providerId: 'mock',
    displayName: '[Mock Kiểm thử] Pixel Art Generator & Mask Inpaint',
    supportsPlanning: false,
    supportsImageGenerate: true,
    supportsImageEditWithMask: true,
    supportsReferenceImages: true,
    supportsTransparentBackground: true,
    maxInputBytes: 25 * 1024 * 1024,
    isMock: true
  },
  {
    modelId: 'mock-image-nomask-v1',
    providerId: 'mock',
    displayName: '[Mock Kiểm thử] Chỉ tạo ảnh (không hỗ trợ mask)',
    supportsPlanning: false,
    supportsImageGenerate: true,
    supportsImageEditWithMask: false,
    supportsReferenceImages: false,
    supportsTransparentBackground: true,
    maxInputBytes: 4 * 1024 * 1024,
    isMock: true
  }
]

function inferProceduralKind(prompt: string, hintKind?: string) {
  const lower = `${hintKind ?? ''} ${prompt}`.toLowerCase()
  if (lower.includes('portrait') || lower.includes('chân dung')) return 'portrait' as const
  if (lower.includes('outfit') || lower.includes('trang phục')) return 'outfit' as const
  if (lower.includes('cabinet') || lower.includes('tủ')) return 'furniture_cabinet' as const
  if (lower.includes('table') || lower.includes('bàn')) return 'furniture_table' as const
  if (lower.includes('chair') || lower.includes('ghế')) return 'furniture_chair' as const
  if (lower.includes('icon')) return 'icon_hammer' as const
  if (lower.includes('hammer') || lower.includes('búa') || lower.includes('vật phẩm')) {
    return 'item_hammer' as const
  }
  if (lower.includes('tileset') || lower.includes('sàn') || lower.includes('gỗ')) {
    return 'tile_wood_floor' as const
  }
  if (lower.includes('tường') || lower.includes('wall')) return 'tile_wall' as const
  if (lower.includes('vfx') || lower.includes('bụi') || lower.includes('khói')) {
    return 'vfx_dust' as const
  }
  if (lower.includes('nút') || lower.includes('button')) return 'ui_button' as const
  if (lower.includes('ui') || lower.includes('khung') || lower.includes('panel')) {
    return 'ui_box' as const
  }
  return 'character' as const
}

export class MockTestAdapter implements ProviderAdapter {
  readonly providerId = 'mock'
  readonly displayName = 'Mock Test Adapter (Chế độ kiểm thử)'
  readonly isMock = true
  readonly maxConcurrency = 2

  public counters = {
    planCalls: 0,
    imageGenerateCalls: 0,
    imageEditCalls: 0
  }

  public artificialDelayMs = 0
  private faultQueue: MockFaultRule[] = []

  reset(): void {
    this.counters = { planCalls: 0, imageGenerateCalls: 0, imageEditCalls: 0 }
    this.artificialDelayMs = 0
    this.faultQueue = []
  }

  enqueueFault(rule: MockFaultRule): void {
    this.faultQueue.push({ ...rule, remainingTriggers: rule.remainingTriggers ?? 1 })
  }

  private async maybeDelayOrFail(signal?: AbortSignal): Promise<void> {
    if (this.artificialDelayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.artificialDelayMs)
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            reject(new ProviderError({ category: 'CANCELLED', message: 'Tác vụ đã bị hủy.' }))
          },
          { once: true }
        )
      })
    }
    if (signal?.aborted) {
      throw new ProviderError({ category: 'CANCELLED', message: 'Tác vụ đã bị hủy.' })
    }
    if (this.faultQueue.length > 0) {
      const rule = this.faultQueue[0]
      rule.remainingTriggers = (rule.remainingTriggers ?? 1) - 1
      if (rule.remainingTriggers <= 0) this.faultQueue.shift()
      throw new ProviderError({
        category: rule.category,
        statusCode: rule.statusCode ?? (rule.category === 'AUTH_INVALID' ? 401 : rule.category === 'RATE_LIMITED' ? 429 : 500),
        retryAfterMs: rule.retryAfterMs ?? (rule.category === 'RATE_LIMITED' ? 50 : null),
        providerRequestId: `mock_req_err_${Date.now()}`,
        message: rule.message ?? `Mô phỏng lỗi ${rule.category} từ MockTestAdapter.`
      })
    }
  }

  listCapabilities(): ModelCapability[] {
    return MOCK_CAPABILITIES.map((c) => ({ ...c }))
  }

  async validateCredentials(
    apiKey: string | null,
    signal?: AbortSignal
  ): Promise<ConnectionCheckResult> {
    try {
      await this.maybeDelayOrFail(signal)
    } catch (err) {
      if (err instanceof ProviderError) {
        return {
          ok: false,
          providerId: this.providerId,
          latencyMs: 5,
          capabilities: [],
          errorCategory: err.category,
          message: err.message
        }
      }
    }
    if (apiKey === 'BAD_KEY_401') {
      return {
        ok: false,
        providerId: this.providerId,
        latencyMs: 5,
        capabilities: [],
        errorCategory: 'AUTH_INVALID',
        message: 'API key không hợp lệ (401).'
      }
    }
    if (apiKey === 'FORBIDDEN_403') {
      return {
        ok: false,
        providerId: this.providerId,
        latencyMs: 5,
        capabilities: [],
        errorCategory: 'PERMISSION_DENIED',
        message: 'Tài khoản thiếu quyền truy cập model ảnh (403).'
      }
    }
    return {
      ok: true,
      providerId: this.providerId,
      latencyMs: 4,
      capabilities: this.listCapabilities(),
      message: 'MockTestAdapter sẵn sàng (Chế độ kiểm thử xác định — không gọi mạng).'
    }
  }

  async generatePlan(req: PlanGenerateRequest): Promise<PlanGenerateResponse> {
    await this.maybeDelayOrFail(req.signal)
    this.counters.planCalls += 1
    return {
      jsonText: JSON.stringify({
        ok: true,
        provider: 'mock',
        prompt: req.userPrompt
      }),
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        imageCount: 0,
        isEstimated: false,
        providerRequestId: `mock_plan_${this.counters.planCalls}`
      }
    }
  }

  async generateImage(req: ImageGenerateRequest): Promise<ImageGenerateResponse> {
    await this.maybeDelayOrFail(req.signal)
    const count = Math.max(1, Math.min(4, req.variantCount ?? 1))
    this.counters.imageGenerateCalls += count
    const kind = inferProceduralKind(req.prompt, req.hintKind)
    const images: Buffer[] = []
    for (let v = 0; v < count; v++) {
      const sprite = renderProceduralSprite({
        kind,
        width: req.width,
        height: req.height,
        direction: req.direction ?? 'down',
        frameIndex: req.frameIndex ?? 0,
        totalFrames: req.totalFrames ?? 6,
        variantSeed: v,
        stateName: req.stateName
      })
      images.push(encodePng(sprite))
    }
    return {
      images,
      usage: {
        inputTokens: 45,
        outputTokens: 0,
        imageCount: count,
        isEstimated: false,
        providerRequestId: `mock_img_${this.counters.imageGenerateCalls}`
      }
    }
  }

  async editImage(req: ImageEditRequest): Promise<ImageEditResponse> {
    await this.maybeDelayOrFail(req.signal)
    this.counters.imageEditCalls += 1
    const src = decodePng(req.sourcePng)
    const mask = decodePng(req.maskPng)
    // Produce an altered image inside masked pixels (e.g., lowered hammer / updated arm pixel details)
    const edited = renderProceduralSprite({
      kind: inferProceduralKind(req.prompt, 'character'),
      width: src.width,
      height: src.height,
      direction: 'left',
      frameIndex: 2,
      totalFrames: 6,
      hammerLow: /thấp\s*xuống|lower|búa/i.test(req.prompt)
    })
    // Ensure visible deterministic modification inside any active mask pixel
    for (let y = 0; y < mask.height && y < edited.height; y++) {
      for (let x = 0; x < mask.width && x < edited.width; x++) {
        const i = (y * mask.width + x) * 4
        if (mask.data[i + 3] > 127) {
          if (edited.data[i + 3] === 0) {
            fillRect(edited, x, y, 1, 1, '#D96B43')
          } else {
            edited.data[i] = Math.min(255, edited.data[i] ^ 0x18)
          }
        }
      }
    }
    return {
      image: encodePng(edited),
      usage: {
        inputTokens: 60,
        outputTokens: 0,
        imageCount: 1,
        isEstimated: false,
        providerRequestId: `mock_edit_${this.counters.imageEditCalls}`
      }
    }
  }
}
