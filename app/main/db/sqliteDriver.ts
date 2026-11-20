import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

export interface SqliteConnection {
  readonly filePath: string
  readonly backend: 'node:sqlite' | 'sql.js'
  exec(sql: string): void
  run(sql: string, params?: unknown[]): void
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[]
  transaction<T>(fn: () => T): T
  getUserVersion(): number
  setUserVersion(version: number): void
  flush(): void
  close(): void
}

const require = createRequire(import.meta.url)

function tryLoadNodeSqlite(): { DatabaseSync: new (path: string) => any } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('node:sqlite')
    if (mod && typeof mod.DatabaseSync === 'function') {
      return mod
    }
  } catch {
    return null
  }
  return null
}

class NodeSqliteConnection implements SqliteConnection {
  readonly backend = 'node:sqlite' as const
  private db: any
  private closed = false

  constructor(public readonly filePath: string, DatabaseSync: new (p: string) => any) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.db = new DatabaseSync(filePath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec('PRAGMA busy_timeout = 5000;')
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, params: unknown[] = []): void {
    const stmt = this.db.prepare(sql)
    stmt.run(...params)
  }

  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params)
    return row ? ({ ...row } as T) : undefined
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql)
    return (stmt.all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T)
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const result = fn()
      this.db.exec('COMMIT;')
      return result
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // ignore rollback error
      }
      throw err
    }
  }

  getUserVersion(): number {
    const row = this.get<{ user_version: number }>('PRAGMA user_version;')
    return Number(row?.user_version ?? 0)
  }

  setUserVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${Math.floor(version)};`)
  }

  flush(): void {
    if (this.closed) return
    try {
      this.db.exec('PRAGMA wal_checkpoint(PASSIVE);')
    } catch {
      // ignore
    }
  }

  close(): void {
    if (this.closed) return
    this.flush()
    this.db.close()
    this.closed = true
  }
}

let cachedSqlJs: any = null

async function loadSqlJs(): Promise<any> {
  if (cachedSqlJs) return cachedSqlJs
  const initSqlJs = require('sql.js')
  const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm'))
  cachedSqlJs = await initSqlJs({
    locateFile: (file: string) => path.join(wasmDir, file)
  })
  return cachedSqlJs
}

class SqlJsConnection implements SqliteConnection {
  readonly backend = 'sql.js' as const
  private db: any
  private dirty = false
  private closed = false

  constructor(public readonly filePath: string, SQL: any) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    if (fs.existsSync(filePath)) {
      const bytes = fs.readFileSync(filePath)
      this.db = new SQL.Database(new Uint8Array(bytes))
    } else {
      this.db = new SQL.Database()
    }
    this.db.exec('PRAGMA foreign_keys = ON;')
  }

  exec(sql: string): void {
    this.db.exec(sql)
    this.dirty = true
    this.flush()
  }

  run(sql: string, params: unknown[] = []): void {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      stmt.step()
    } finally {
      stmt.free()
    }
    this.dirty = true
    this.flush()
  }

  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      if (!stmt.step()) return undefined
      return stmt.getAsObject() as T
    } finally {
      stmt.free()
    }
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql)
    const rows: T[] = []
    try {
      stmt.bind(params)
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T)
      }
      return rows
    } finally {
      stmt.free()
    }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN TRANSACTION;')
    try {
      const result = fn()
      this.db.exec('COMMIT;')
      this.dirty = true
      this.flush()
      return result
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // ignore
      }
      throw err
    }
  }

  getUserVersion(): number {
    const row = this.get<{ user_version: number }>('PRAGMA user_version;')
    return Number(row?.user_version ?? 0)
  }

  setUserVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${Math.floor(version)};`)
    this.dirty = true
    this.flush()
  }

  flush(): void {
    if (this.closed || !this.dirty) return
    const data: Uint8Array = this.db.export()
    const tmpPath = `${this.filePath}.tmp`
    fs.writeFileSync(tmpPath, Buffer.from(data))
    fs.renameSync(tmpPath, this.filePath)
    this.dirty = false
  }

  close(): void {
    if (this.closed) return
    this.flush()
    this.db.close()
    this.closed = true
  }
}

export async function openSqliteConnection(filePath: string): Promise<SqliteConnection> {
  const nodeSqlite = tryLoadNodeSqlite()
  if (nodeSqlite) {
    return new NodeSqliteConnection(filePath, nodeSqlite.DatabaseSync)
  }
  const SQL = await loadSqlJs()
  return new SqlJsConnection(filePath, SQL)
}
