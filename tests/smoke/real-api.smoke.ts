/**
 * Real-API Smoke Test (requires OPENAI_API_KEY in environment).
 * Run with: OPENAI_API_KEY=sk-... npm run test:smoke:real-api
 */
import { OpenAIProviderAdapter } from '../../app/main/providers/openaiAdapter'

async function main() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.log('[SKIP] OPENAI_API_KEY chưa được thiết lập trong biến môi trường.')
    console.log('Cách chạy smoke test API thật:')
    console.log('  $env:OPENAI_API_KEY="sk-..."; npm run test:smoke:real-api')
    process.exit(0)
  }

  const adapter = new OpenAIProviderAdapter()
  console.log('1) Kiểm tra kết nối OpenAI...')
  const conn = await adapter.validateCredentials(apiKey)
  console.log('Kết quả:', conn.message)
  if (!conn.ok) process.exit(1)

  console.log('2) Kiểm tra lập kế hoạch JSON (gpt-4.1-mini)...')
  const planRes = await adapter.generatePlan(
    {
      modelId: 'gpt-4.1-mini',
      systemPrompt: 'Return valid JSON object with keys {"ok": true, "operation": "generate_sprite"}.',
      projectContext: { tileSizePx: 32 },
      userPrompt: 'Tạo nhân vật thợ mộc 32x48'
    },
    apiKey
  )
  console.log('Plan usage:', planRes.usage)
  JSON.parse(planRes.jsonText)

  console.log('3) Kiểm tra sinh ảnh thật (gpt-image-1)...')
  const imgRes = await adapter.generateImage(
    {
      modelId: 'gpt-image-1',
      prompt: '32x48 2D pixel art carpenter wearing brown apron, 3/4 RPG view, transparent background',
      width: 32,
      height: 48,
      transparentBackground: true,
      variantCount: 1
    },
    apiKey
  )
  console.log(`Nhận ${imgRes.images.length} ảnh (${imgRes.images[0].byteLength} bytes), usage:`, imgRes.usage)
  console.log('[PASS] Smoke test OpenAI API thật hoàn tất!')
}

main().catch((err) => {
  console.error('[FAIL]', err)
  process.exit(1)
})
