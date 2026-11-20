import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { maskApiKey } from '@domain/security/redactor'

export interface StoredProviderKeyMeta {
  providerId: string
  configured: boolean
  maskedKey: string
  verifiedAt: string | null
  storageBackend: 'electron-safeStorage-dpapi' | 'local-aes-gcm' | 'memory'
}

interface PersistedSecretsFile {
  version: 1
  entries: Record<
    string,
    {
      encoding: 'safeStorage' | 'aes-256-gcm'
      ciphertextBase64: string
      ivBase64?: string
      tagBase64?: string
      verifiedAt: string | null
    }
  >
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export class SecretStore {
  private readonly filePath: string
  private readonly safeStorage: SafeStorageLike | null
  private readonly fallbackKey: Buffer
  private readonly memoryCache = new Map<string, { key: string; verifiedAt: string | null }>()

  constructor(storageDir: string, safeStorage?: SafeStorageLike | null) {
    fs.mkdirSync(storageDir, { recursive: true })
    this.filePath = path.join(storageDir, 'secrets.enc.json')
    this.safeStorage = safeStorage ?? null
    // Machine-scoped fallback key only used in headless test mode when Electron safeStorage is absent
    const seed = `${process.env.COMPUTERNAME ?? 'local'}:${process.env.USERNAME ?? 'user'}:ai-pixel-studio-v1`
    this.fallbackKey = crypto.createHash('sha256').update(seed).digest()
    this.loadFromDisk()
  }

  private canUseSafeStorage(): boolean {
    try {
      return Boolean(this.safeStorage && this.safeStorage.isEncryptionAvailable())
    } catch {
      return false
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) return
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as PersistedSecretsFile
      if (!raw || raw.version !== 1 || !raw.entries) return
      for (const [providerId, entry] of Object.entries(raw.entries)) {
        try {
          if (entry.encoding === 'safeStorage' && this.canUseSafeStorage()) {
            const plain = this.safeStorage!.decryptString(
              Buffer.from(entry.ciphertextBase64, 'base64')
            )
            this.memoryCache.set(providerId, { key: plain, verifiedAt: entry.verifiedAt })
          } else if (entry.encoding === 'aes-256-gcm' && entry.ivBase64 && entry.tagBase64) {
            const decipher = crypto.createDecipheriv(
              'aes-256-gcm',
              this.fallbackKey,
              Buffer.from(entry.ivBase64, 'base64')
            )
            decipher.setAuthTag(Buffer.from(entry.tagBase64, 'base64'))
            const dec = Buffer.concat([
              decipher.update(Buffer.from(entry.ciphertextBase64, 'base64')),
              decipher.final()
            ])
            this.memoryCache.set(providerId, {
              key: dec.toString('utf-8'),
              verifiedAt: entry.verifiedAt
            })
          }
        } catch {
          // Ignore corrupted entry rather than crashing app startup
        }
      }
    } catch {
      // Ignore unreadable file
    }
  }

  private persistToDisk(): void {
    const payload: PersistedSecretsFile = { version: 1, entries: {} }
    const useSafe = this.canUseSafeStorage()

    for (const [providerId, { key, verifiedAt }] of this.memoryCache.entries()) {
      if (useSafe) {
        const enc = this.safeStorage!.encryptString(key)
        payload.entries[providerId] = {
          encoding: 'safeStorage',
          ciphertextBase64: enc.toString('base64'),
          verifiedAt
        }
      } else {
        const iv = crypto.randomBytes(12)
        const cipher = crypto.createCipheriv('aes-256-gcm', this.fallbackKey, iv)
        const enc = Buffer.concat([cipher.update(key, 'utf-8'), cipher.final()])
        const tag = cipher.getAuthTag()
        payload.entries[providerId] = {
          encoding: 'aes-256-gcm',
          ciphertextBase64: enc.toString('base64'),
          ivBase64: iv.toString('base64'),
          tagBase64: tag.toString('base64'),
          verifiedAt
        }
      }
    }

    const tmpPath = `${this.filePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8')
    fs.renameSync(tmpPath, this.filePath)
  }

  setKey(providerId: string, apiKey: string): StoredProviderKeyMeta {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      throw new Error('API key không được để trống.')
    }
    this.memoryCache.set(providerId, { key: trimmed, verifiedAt: null })
    this.persistToDisk()
    return this.getStatus(providerId)
  }

  markVerified(providerId: string): StoredProviderKeyMeta {
    const existing = this.memoryCache.get(providerId)
    if (existing) {
      existing.verifiedAt = new Date().toISOString()
      this.persistToDisk()
    }
    return this.getStatus(providerId)
  }

  deleteKey(providerId: string): StoredProviderKeyMeta {
    this.memoryCache.delete(providerId)
    this.persistToDisk()
    return this.getStatus(providerId)
  }

  /**
   * Main-process-only secret retrieval. Never expose over IPC!
   */
  getPlainKey(providerId: string): string | null {
    return this.memoryCache.get(providerId)?.key ?? null
  }

  getAllSecretValues(): string[] {
    return [...this.memoryCache.values()].map((v) => v.key).filter(Boolean)
  }

  getStatus(providerId: string): StoredProviderKeyMeta {
    const entry = this.memoryCache.get(providerId)
    return {
      providerId,
      configured: Boolean(entry?.key),
      maskedKey: entry?.key ? maskApiKey(entry.key) : '',
      verifiedAt: entry?.verifiedAt ?? null,
      storageBackend: this.canUseSafeStorage() ? 'electron-safeStorage-dpapi' : 'local-aes-gcm'
    }
  }
}
