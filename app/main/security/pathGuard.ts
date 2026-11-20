import path from 'node:path'

/**
 * Ensures `targetPath` resolves strictly inside `rootDir` (or equals `rootDir`).
 * Prevents path traversal (`../`, drive escape, null bytes).
 */
export function assertPathInsideRoot(rootDir: string, targetPath: string): string {
  if (!targetPath || targetPath.includes('\0')) {
    throw new Error('Đường dẫn không hợp lệ (chứa ký tự null hoặc rỗng).')
  }
  const resolvedRoot = path.resolve(rootDir)
  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(resolvedRoot, targetPath)

  const rel = path.relative(resolvedRoot, resolvedTarget)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Từ chối truy cập đường dẫn ngoài phạm vi cho phép: "${targetPath}" nằm ngoài "${resolvedRoot}".`
    )
  }
  return resolvedTarget
}

export function assertRelativeSafePath(relPath: string): string {
  if (!relPath || relPath.includes('\0')) {
    throw new Error('Đường dẫn tương đối rỗng hoặc chứa ký tự null.')
  }
  const normalized = relPath.replace(/\\/g, '/')
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Đường dẫn tương đối không an toàn: "${relPath}".`)
  }
  return normalized
}

export function sanitizeWindowsFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/g, '')
    .trim()
  return cleaned || 'unnamed'
}
