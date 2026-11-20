import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test.describe('AI Pixel Studio — Electron UI E2E (A01, A02, A05, A07, A11, A12)', () => {
  test('full desktop UI workflow: create project in accented path, resolve conflict A02, edit clip speed A05, simulate dialogue A07, offline export A12', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-e2e-'))
    const appDataDir = path.join(tmpRoot, 'appdata')
    const accentedProjDir = path.join(tmpRoot, 'Dự án Xưởng Mộc E2E')
    const exportDir = path.join(tmpRoot, 'Unity Export E2E')

    const electronApp = await electron.launch({
      args: [path.resolve(process.cwd(), 'out/main/index.js')],
      env: {
        ...process.env,
        AI_PIXEL_STUDIO_DATA_DIR: appDataDir
      }
    })

    try {
      const page = await electronApp.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      // 1) A01: Create project in Vietnamese accented path with spaces
      await page.getByTestId('input-project-name').fill('Xưởng Mộc E2E')
      await page.getByTestId('input-project-dir').fill(accentedProjDir)
      await page.getByTestId('btn-create-project').click()
      await expect(page.getByTestId('btn-open-export')).toBeVisible({ timeout: 15000 })

      // 2) A02: Prompt vs Form conflict (32x32 selected vs "Tạo NPC 64 × 64")
      await page.getByTestId('select-content-type').selectOption('character')
      await page.getByTestId('input-sprite-w').fill('32')
      await page.getByTestId('input-sprite-h').fill('32')
      await page.getByTestId('textarea-prompt').fill('Tạo NPC 64 × 64')
      await page.getByTestId('btn-run-prompt').click()

      await expect(page.getByTestId('conflict-box')).toBeVisible()
      await page.getByTestId('resolve-conflict-form-spriteSize').click()
      await page.getByTestId('btn-run-prompt').click()
      await expect(page.getByTestId('status-pill')).toContainText(/Hoàn thành|Nháp|duyệt/i, { timeout: 15000 })

      // 3) Open Sample Workshop via IPC inside app to test A05, A07, A11, A12 through UI!
      const wsDir = path.join(tmpRoot, 'Workshop E2E')
      await page.evaluate(async (dir) => {
        await (globalThis as unknown as { pixelStudio: { openSampleWorkshop(d: string): Promise<unknown> } }).pixelStudio.openSampleWorkshop(dir)
      }, wsDir)
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('asset-item-character_carpenter')).toBeVisible({ timeout: 15000 })

      // 4) A05: Deterministic clip speed edit via UI ("Cho clip đi trái chậm hơn 20%.")
      await page.getByTestId('asset-item-character_carpenter').click()
      await page.getByTestId('clip-item-clip_carpenter_walk_left').click()
      await page.getByTestId('tab-mode-edit').click()
      await page.getByTestId('textarea-prompt').fill('Cho clip đi trái chậm hơn 20%.')
      await page.getByTestId('btn-run-prompt').click()
      await expect(page.getByTestId('status-pill')).toContainText(/Hoàn thành/i, { timeout: 10000 })

      // 5) A07: Dialogue Branch Simulator in UI (missing hammer vs has hammer)
      await page.getByTestId('asset-item-asset_dialogue_hammer').click()
      await expect(page.getByTestId('dialogue-simulator')).toBeVisible()
      await page.getByTestId('sim-edge-e_missing').click()
      await expect(page.getByTestId('sim-current-text')).toContainText(/Chưa có/i)

      await page.getByTestId('checkbox-sim-hammer').check()
      await page.getByTestId('sim-edge-e_has').click()
      await expect(page.getByTestId('sim-current-text')).toContainText(/Cảm ơn/i)

      // 6) A12: Toggle Offline Mode & Export valid Unity package through Export Modal
      await page.getByTestId('btn-offline-toggle').click()
      await page.getByTestId('btn-open-export').click()
      await page.getByTestId('input-export-dir').fill(exportDir)
      await page.getByTestId('btn-run-preflight').click()
      await page.getByTestId('btn-confirm-export').click()
      await expect(page.getByTestId('export-success-box')).toBeVisible({ timeout: 15000 })
      expect(fs.existsSync(path.join(exportDir, 'manifest.json'))).toBe(true)
    } finally {
      await electronApp.close()
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})
