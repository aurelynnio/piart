import type {
  Direction,
  ModelCapability,
  ProviderErrorCategory
} from '@domain/schemas/types'

export class ProviderError extends Error {
  public readonly category: ProviderErrorCategory
  public readonly statusCode: number | null
  public readonly retryAfterMs: number | null
  public readonly providerRequestId: string | null

  constructor(params: {
    category: ProviderErrorCategory
    message: string
    statusCode?: number | null
    retryAfterMs?: number | null
    providerRequestId?: string | null
  }) {
    super(params.message)
    this.name = 'ProviderError'
    this.category = params.category
    this.statusCode = params.statusCode ?? null
    this.retryAfterMs = params.retryAfterMs ?? null
    this.providerRequestId = params.providerRequestId ?? null
  }

  get isRetryable(): boolean {
    return (
      this.category === 'RATE_LIMITED' ||
      this.category === 'NETWORK_ERROR' ||
      this.category === 'PROVIDER_SERVER_ERROR'
    )
  }
}

export interface ProviderUsageMetrics {
  inputTokens: number
  outputTokens: number
  imageCount: number
  isEstimated: boolean
  providerRequestId?: string | null
}

export interface ConnectionCheckResult {
  ok: boolean
  providerId: string
  latencyMs: number
  capabilities: ModelCapability[]
  errorCategory?: ProviderErrorCategory
  message: string
}

export interface ImageGenerateRequest {
  modelId: string
  prompt: string
  width: number
  height: number
  transparentBackground?: boolean
  referencePngs?: Buffer[]
  variantCount?: number
  hintKind?: string
  direction?: Direction
  frameIndex?: number
  totalFrames?: number
  stateName?: string
  signal?: AbortSignal
}

export interface ImageGenerateResponse {
  images: Buffer[]
  usage: ProviderUsageMetrics
}

export interface ImageEditRequest {
  modelId: string
  prompt: string
  sourcePng: Buffer
  maskPng: Buffer
  width: number
  height: number
  referencePngs?: Buffer[]
  signal?: AbortSignal
}

export interface ImageEditResponse {
  image: Buffer
  usage: ProviderUsageMetrics
}

export interface PlanGenerateRequest {
  modelId: string
  systemPrompt: string
  projectContext: Record<string, unknown>
  userPrompt: string
  signal?: AbortSignal
}

export interface PlanGenerateResponse {
  jsonText: string
  usage: ProviderUsageMetrics
}

export interface ProviderAdapter {
  readonly providerId: string
  readonly displayName: string
  readonly isMock: boolean
  readonly maxConcurrency: number
  listCapabilities(): ModelCapability[]
  validateCredentials(apiKey: string | null, signal?: AbortSignal): Promise<ConnectionCheckResult>
  generatePlan(req: PlanGenerateRequest, apiKey: string | null): Promise<PlanGenerateResponse>
  generateImage(req: ImageGenerateRequest, apiKey: string | null): Promise<ImageGenerateResponse>
  editImage(req: ImageEditRequest, apiKey: string | null): Promise<ImageEditResponse>
}
