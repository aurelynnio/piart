import type { ModelCapability } from '@domain/schemas/types'
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

export const OPENAI_CAPABILITIES: ModelCapability[] = [
  {
    modelId: 'gpt-4.1-mini',
    providerId: 'openai',
    displayName: 'OpenAI GPT-4.1 Mini (Lập kế hoạch & Dữ liệu JSON)',
    supportsPlanning: true,
    supportsImageGenerate: false,
    supportsImageEditWithMask: false,
    supportsReferenceImages: true,
    supportsTransparentBackground: false,
    maxInputBytes: 20 * 1024 * 1024,
    isMock: false
  },
  {
    modelId: 'gpt-4.1',
    providerId: 'openai',
    displayName: 'OpenAI GPT-4.1 (Lập kế hoạch nâng cao)',
    supportsPlanning: true,
    supportsImageGenerate: false,
    supportsImageEditWithMask: false,
    supportsReferenceImages: true,
    supportsTransparentBackground: false,
    maxInputBytes: 20 * 1024 * 1024,
    isMock: false
  },
  {
    modelId: 'gpt-image-1',
    providerId: 'openai',
    displayName: 'OpenAI GPT Image 1 (Tạo ảnh, Mask Inpaint & Nền trong suốt)',
    supportsPlanning: false,
    supportsImageGenerate: true,
    supportsImageEditWithMask: true,
    supportsReferenceImages: true,
    supportsTransparentBackground: true,
    maxInputBytes: 25 * 1024 * 1024,
    isMock: false
  },
  {
    modelId: 'dall-e-3',
    providerId: 'openai',
    displayName: 'OpenAI DALL-E 3 (Chỉ tạo ảnh mới — không hỗ trợ mask)',
    supportsPlanning: false,
    supportsImageGenerate: true,
    supportsImageEditWithMask: false,
    supportsReferenceImages: false,
    supportsTransparentBackground: false,
    maxInputBytes: 4 * 1024 * 1024,
    isMock: false
  }
]

function parseRetryAfterMs(headers: Headers): number | null {
  const val = headers.get('retry-after')
  if (!val) return null
  const secs = Number(val)
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000)
  const dateMs = Date.parse(val)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  return null
}

function classifyHttpError(
  status: number,
  bodyText: string,
  headers: Headers
): ProviderError {
  const reqId = headers.get('x-request-id')
  const retryAfterMs = parseRetryAfterMs(headers)
  const lower = bodyText.toLowerCase()

  if (status === 401) {
    return new ProviderError({
      category: 'AUTH_INVALID',
      statusCode: 401,
      providerRequestId: reqId,
      message: 'API key OpenAI không hợp lệ hoặc đã bị thu hồi (HTTP 401).'
    })
  }
  if (status === 403) {
    return new ProviderError({
      category: 'PERMISSION_DENIED',
      statusCode: 403,
      providerRequestId: reqId,
      message: 'Tài khoản OpenAI chưa có quyền truy cập model này hoặc chưa xác minh tổ chức (HTTP 403).'
    })
  }
  if (status === 429) {
    return new ProviderError({
      category: 'RATE_LIMITED',
      statusCode: 429,
      retryAfterMs: retryAfterMs ?? 5000,
      providerRequestId: reqId,
      message: 'Đã chạm giới hạn tốc độ hoặc hạn mức gọi API OpenAI (HTTP 429).'
    })
  }
  if (status === 400 || status === 413) {
    if (lower.includes('safety') || lower.includes('policy') || lower.includes('moderation')) {
      return new ProviderError({
        category: 'CONTENT_POLICY_REJECTED',
        statusCode: status,
        providerRequestId: reqId,
        message: 'Yêu cầu bị bộ lọc chính sách nội dung của OpenAI từ chối.'
      })
    }
    return new ProviderError({
      category: 'PAYLOAD_INVALID',
      statusCode: status,
      providerRequestId: reqId,
      message: `Tham số hoặc dung lượng ảnh vượt giới hạn API OpenAI (HTTP ${status}).`
    })
  }
  if (status >= 500) {
    return new ProviderError({
      category: 'PROVIDER_SERVER_ERROR',
      statusCode: status,
      providerRequestId: reqId,
      message: `Dịch vụ OpenAI tạm thời gặp lỗi máy chủ (HTTP ${status}).`
    })
  }
  return new ProviderError({
    category: 'INTERNAL_ERROR',
    statusCode: status,
    providerRequestId: reqId,
    message: `Lỗi OpenAI không xác định (HTTP ${status}).`
  })
}

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly providerId = 'openai'
  readonly displayName = 'OpenAI'
  readonly isMock = false
  readonly maxConcurrency = 2

  constructor(private readonly baseUrl = 'https://api.openai.com/v1') {}

  listCapabilities(): ModelCapability[] {
    return OPENAI_CAPABILITIES.map((c) => ({ ...c }))
  }

  private requireKey(apiKey: string | null): string {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError({
        category: 'AUTH_INVALID',
        statusCode: 401,
        message: 'Chưa cấu hình OpenAI API key. Hãy nhập key trong Cài đặt → Provider & Model.'
      })
    }
    return apiKey.trim()
  }

  async validateCredentials(
    apiKey: string | null,
    signal?: AbortSignal
  ): Promise<ConnectionCheckResult> {
    const start = Date.now()
    if (!apiKey || !apiKey.trim()) {
      return {
        ok: false,
        providerId: this.providerId,
        latencyMs: 0,
        capabilities: [],
        errorCategory: 'AUTH_INVALID',
        message: 'Chưa nhập API key cho OpenAI.'
      }
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal
      })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const err = classifyHttpError(res.status, body, res.headers)
        return {
          ok: false,
          providerId: this.providerId,
          latencyMs,
          capabilities: [],
          errorCategory: err.category,
          message: err.message
        }
      }
      const json = (await res.json()) as { data?: Array<{ id: string }> }
      const availableIds = new Set((json.data ?? []).map((m) => m.id))
      const matched = OPENAI_CAPABILITIES.filter(
        (c) => availableIds.size === 0 || availableIds.has(c.modelId)
      )
      return {
        ok: true,
        providerId: this.providerId,
        latencyMs,
        capabilities: matched.length > 0 ? matched : this.listCapabilities(),
        message: `Kết nối OpenAI thành công (${latencyMs} ms), phát hiện ${matched.length} model tương thích.`
      }
    } catch (err) {
      if (signal?.aborted) {
        return {
          ok: false,
          providerId: this.providerId,
          latencyMs: Date.now() - start,
          capabilities: [],
          errorCategory: 'CANCELLED',
          message: 'Đã hủy kiểm tra kết nối.'
        }
      }
      return {
        ok: false,
        providerId: this.providerId,
        latencyMs: Date.now() - start,
        capabilities: [],
        errorCategory: 'NETWORK_ERROR',
        message: `Không thể kết nối tới OpenAI: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  async generatePlan(
    req: PlanGenerateRequest,
    apiKey: string | null
  ): Promise<PlanGenerateResponse> {
    const key = this.requireKey(apiKey)
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: req.modelId || 'gpt-4.1-mini',
          response_format: { type: 'json_object' },
          temperature: 0.2,
          messages: [
            { role: 'system', content: req.systemPrompt },
            {
              role: 'user',
              content: JSON.stringify({
                projectContext: req.projectContext,
                userPrompt: req.userPrompt
              })
            }
          ]
        }),
        signal: req.signal
      })

      if (!res.ok) {
        throw classifyHttpError(res.status, await res.text().catch(() => ''), res.headers)
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = json.choices?.[0]?.message?.content ?? '{}'
      return {
        jsonText: content,
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
          imageCount: 0,
          isEstimated: !json.usage,
          providerRequestId: res.headers.get('x-request-id')
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err
      if (req.signal?.aborted) {
        throw new ProviderError({ category: 'CANCELLED', message: 'Tác vụ lập kế hoạch đã bị hủy.' })
      }
      throw new ProviderError({
        category: 'NETWORK_ERROR',
        message: `Lỗi mạng khi gọi lập kế hoạch OpenAI: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  async generateImage(
    req: ImageGenerateRequest,
    apiKey: string | null
  ): Promise<ImageGenerateResponse> {
    const key = this.requireKey(apiKey)
    const model = req.modelId || 'gpt-image-1'
    const n = Math.max(1, Math.min(4, req.variantCount ?? 1))

    // Pre-flight validation
    if (req.prompt.length > 32000) {
      throw new ProviderError({
        category: 'PAYLOAD_INVALID',
        statusCode: 400,
        message: 'Prompt vượt quá độ dài tối đa cho phép của OpenAI Images API.'
      })
    }

    const body: Record<string, unknown> = {
      model,
      prompt: req.prompt,
      n,
      size: '1024x1024'
    }
    if (model === 'gpt-image-1') {
      body.output_format = 'png'
      if (req.transparentBackground !== false) {
        body.background = 'transparent'
      }
    } else {
      body.response_format = 'b64_json'
    }

    try {
      const res = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: req.signal
      })

      if (!res.ok) {
        throw classifyHttpError(res.status, await res.text().catch(() => ''), res.headers)
      }

      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      const images: Buffer[] = []
      for (const item of json.data ?? []) {
        if (item.b64_json) {
          images.push(Buffer.from(item.b64_json, 'base64'))
        } else if (item.url) {
          const imgRes = await fetch(item.url, { signal: req.signal })
          images.push(Buffer.from(await imgRes.arrayBuffer()))
        }
      }
      if (images.length === 0) {
        throw new ProviderError({
          category: 'AMBIGUOUS_OUTCOME',
          message: 'OpenAI trả về thành công nhưng không có dữ liệu ảnh.'
        })
      }

      return {
        images,
        usage: {
          inputTokens: json.usage?.input_tokens ?? 0,
          outputTokens: json.usage?.output_tokens ?? 0,
          imageCount: images.length,
          isEstimated: !json.usage,
          providerRequestId: res.headers.get('x-request-id')
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err
      if (req.signal?.aborted) {
        throw new ProviderError({ category: 'CANCELLED', message: 'Đã hủy yêu cầu tạo ảnh.' })
      }
      throw new ProviderError({
        category: 'NETWORK_ERROR',
        message: `Lỗi mạng khi gọi OpenAI Images API: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  async editImage(req: ImageEditRequest, apiKey: string | null): Promise<ImageEditResponse> {
    const key = this.requireKey(apiKey)
    const model = req.modelId || 'gpt-image-1'
    if (req.sourcePng.byteLength > 25 * 1024 * 1024 || req.maskPng.byteLength > 25 * 1024 * 1024) {
      throw new ProviderError({
        category: 'PAYLOAD_INVALID',
        statusCode: 413,
        message: 'Ảnh gốc hoặc ảnh mask vượt quá giới hạn 25 MB của OpenAI.'
      })
    }

    const formData = new FormData()
    formData.append('model', model)
    formData.append('prompt', req.prompt)
    formData.append('size', '1024x1024')
    formData.append(
      'image',
      new Blob([new Uint8Array(req.sourcePng)], { type: 'image/png' }),
      'source.png'
    )
    formData.append(
      'mask',
      new Blob([new Uint8Array(req.maskPng)], { type: 'image/png' }),
      'mask.png'
    )

    try {
      const res = await fetch(`${this.baseUrl}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: formData,
        signal: req.signal
      })

      if (!res.ok) {
        throw classifyHttpError(res.status, await res.text().catch(() => ''), res.headers)
      }

      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      const first = json.data?.[0]
      let buf: Buffer | null = null
      if (first?.b64_json) buf = Buffer.from(first.b64_json, 'base64')
      else if (first?.url) {
        const imgRes = await fetch(first.url, { signal: req.signal })
        buf = Buffer.from(await imgRes.arrayBuffer())
      }
      if (!buf) {
        throw new ProviderError({
          category: 'AMBIGUOUS_OUTCOME',
          message: 'OpenAI không trả về dữ liệu ảnh đã chỉnh sửa.'
        })
      }

      return {
        image: buf,
        usage: {
          inputTokens: json.usage?.input_tokens ?? 0,
          outputTokens: json.usage?.output_tokens ?? 0,
          imageCount: 1,
          isEstimated: !json.usage,
          providerRequestId: res.headers.get('x-request-id')
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err
      if (req.signal?.aborted) {
        throw new ProviderError({ category: 'CANCELLED', message: 'Đã hủy yêu cầu chỉnh vùng ảnh.' })
      }
      throw new ProviderError({
        category: 'NETWORK_ERROR',
        message: `Lỗi mạng khi gọi OpenAI Image Edit API: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }
}
