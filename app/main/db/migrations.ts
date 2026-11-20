import fs from 'node:fs'
import path from 'node:path'
import type { SqliteConnection } from './sqliteDriver'
import { SCHEMA_VERSION } from '@domain/schemas/types'

interface Migration {
  version: number
  name: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '0001_init',
    sql: `
      CREATE TABLE IF NOT EXISTS kv_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entities (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);

      CREATE TABLE IF NOT EXISTS revisions (
        revision_id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        parent_revision_id TEXT,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_revisions_asset ON revisions(asset_id);

      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_steps (
        step_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        idempotency_key TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_job_steps_job ON job_steps(job_id);

      CREATE TABLE IF NOT EXISTS usage_ledger (
        usage_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        is_estimated INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS export_runs (
        export_run_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_history (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        tx_id TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        undone INTEGER NOT NULL DEFAULT 0,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: '0002_migration_audit_and_staging_wal',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS staging_journal (
        journal_id TEXT PRIMARY KEY,
        target_rel_path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
      VALUES (1, '0001_init', datetime('now'));
    `
  }
]

export interface MigrationResult {
  fromVersion: number
  toVersion: number
  applied: string[]
  backupPath: string | null
}

export function runMigrations(
  conn: SqliteConnection,
  projectRootDir: string
): MigrationResult {
  const currentVersion = conn.getUserVersion()
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version
  )

  if (pending.length === 0) {
    return {
      fromVersion: currentVersion,
      toVersion: currentVersion,
      applied: [],
      backupPath: null
    }
  }

  let backupPath: string | null = null
  if (currentVersion > 0 && fs.existsSync(conn.filePath)) {
    const backupsDir = path.join(projectRootDir, 'backups')
    fs.mkdirSync(backupsDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    backupPath = path.join(backupsDir, `pre_migration_v${currentVersion}_${ts}.sqlite`)
    conn.flush()
    fs.copyFileSync(conn.filePath, backupPath)
  }

  const applied: string[] = []
  for (const mig of pending) {
    conn.transaction(() => {
      conn.exec(mig.sql)
      conn.setUserVersion(mig.version)
      if (mig.version >= 2) {
        conn.run(
          'INSERT OR REPLACE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          [mig.version, mig.name, new Date().toISOString()]
        )
      }
    })
    applied.push(mig.name)
  }

  return {
    fromVersion: currentVersion,
    toVersion: Math.max(currentVersion, SCHEMA_VERSION),
    applied,
    backupPath
  }
}
