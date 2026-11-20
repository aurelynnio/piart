const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // OpenAI / sk-proj / generic sk- keys
  { regex: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_\-]{12,}\b/g, replacement: '[REDACTED_API_KEY]' },
  // Bearer auth headers
  { regex: /(Bearer\s+)[A-Za-z0-9._\-]{10,}/gi, replacement: '$1[REDACTED_TOKEN]' },
  // Authorization header token value (keeps trailing log context readable)
  { regex: /(Authorization\s*[:=]\s*(?:Bearer\s+)?)[A-Za-z0-9._\-+=\/]{6,}/gi, replacement: '$1[REDACTED_AUTH]' },
  // Generic api_key / apiKey JSON or query assignments
  { regex: /(["']?(?:api[_-]?key|x-api-key|secret|token)["']?\s*[:=]\s*["']?)([A-Za-z0-9_\-./+]{12,})(["']?)/gi, replacement: '$1[REDACTED_SECRET]$3' },
  // Windows user home path redaction
  { regex: /([A-Za-z]:\\Users\\)([^\\/:*?"<>|\r\n]+)/g, replacement: '$1<user>' },
  { regex: /([A-Za-z]:\/Users\/)([^\/:*?"<>|\r\n]+)/g, replacement: '$1<user>' }
]

export function maskApiKey(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '••••••••'
  const prefix = trimmed.slice(0, 3)
  const suffix = trimmed.slice(-4)
  return `${prefix}••••••${suffix}`
}

export function redactString(input: string, extraSecrets: string[] = []): string {
  let out = input
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 6) {
      out = out.split(secret).join('[REDACTED_API_KEY]')
    }
  }
  for (const { regex, replacement } of SECRET_PATTERNS) {
    out = out.replace(regex, replacement)
  }
  return out
}

export function redactDeep<T>(value: T, extraSecrets: string[] = []): T {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return redactString(value, extraSecrets) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, extraSecrets)) as unknown as T
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(authorization|api[_-]?key|secret|password|token)$/i.test(k)) {
        result[k] = '[REDACTED_SECRET]'
      } else {
        result[k] = redactDeep(v, extraSecrets)
      }
    }
    return result as T
  }
  return value
}
