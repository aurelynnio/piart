import { z } from 'zod'
import type { PiartMcpContext } from '../context'

export function registerAllPrompts(ctx: PiartMcpContext): void {
  const { server } = ctx

  server.registerPrompt(
    'create_character_workflow',
    {
      title: 'Quy trình tạo nhân vật Pixel Art 4 hướng + Duyệt + Xuất Unity',
      description: 'Hướng dẫn Codex tạo mới nhân vật 2D pixel art đầy đủ các hướng đi, kiểm tra QC và duyệt bản chính thức.',
      argsSchema: {
        characterDescription: z.string().describe('Mô tả nhân vật cần tạo (tiếng Việt hoặc tiếng Anh)'),
        spriteSize: z.string().optional().describe('Kích thước sprite, VD: 32x48'),
        fps: z.string().optional().describe('Tốc độ khung hình, VD: 8')
      }
    },
    ({ characterDescription, spriteSize, fps }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Hãy thực hiện quy trình tạo nhân vật 2D pixel art trong AI Pixel Studio:`,
              `- Mô tả: ${characterDescription}`,
              `- Kích thước: ${spriteSize ?? '32x48'} · FPS: ${fps ?? '8'}`,
              ``,
              `Các bước chuẩn:`,
              `1. Gọi \`studio_status\` và \`project_get_summary\` để kiểm tra dự án đang mở, bảng màu và StylePreset.`,
              `2. Gọi \`prompt_preview_plan\` với mode="create", contentType="character" để kiểm tra xung đột thông số.`,
              `3. Nếu có conflicts, chốt rõ ràng rồi gọi \`prompt_run_workflow\`.`,
              `4. Gọi \`pixel_analyze_sprite\` trên asset mới tạo để kiểm tra QC (semiTransparentPixels, touchesEdge, offPaletteColors).`,
              `5. Nếu đạt chuẩn, gọi \`revision_approve\` để duyệt phiên bản chính thức và báo cáo lại danh sách assetId/clipIds đã tạo.`
            ].join('\n')
          }
        }
      ]
    })
  )

  server.registerPrompt(
    'mask_edit_animation_frame',
    {
      title: 'Chỉnh sửa cục bộ 1 Frame hoạt cảnh bằng Mask',
      description: 'Quy trình chuẩn sửa đúng 1 frame trong clip mà vẫn giữ nguyên 100% hash các frame khác.',
      argsSchema: {
        clipId: z.string().describe('ID của clip cần chỉnh'),
        frameIndex: z.string().describe('Chỉ số frame (bắt đầu từ 0)'),
        editInstruction: z.string().describe('Mô tả thay đổi cần áp dụng trong vùng mask')
      }
    },
    ({ clipId, frameIndex, editInstruction }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Hãy chỉnh sửa cục bộ frame #${Number(frameIndex) + 1} (index=${frameIndex}) của clip "${clipId}":`,
              `- Yêu cầu sửa: ${editInstruction}`,
              ``,
              `Quy trình:`,
              `1. Gọi \`clip_get\` để kiểm tra kích thước canvasPx và hash của các frame hiện tại.`,
              `2. Chuẩn bị mask PNG đúng kích thước canvasPx (vùng cần sửa tô alpha > 0).`,
              `3. Gọi \`prompt_run_workflow\` với mode="edit", targetClipId="${clipId}", targetFrameIndex=${frameIndex} kèm maskPngBase64/maskFilePath.`,
              `4. Gọi lại \`clip_get\` để xác minh chỉ frame #${Number(frameIndex) + 1} đổi hash còn mọi frame khác giữ nguyên 100%.`
            ].join('\n')
          }
        }
      ]
    })
  )

  server.registerPrompt(
    'programmatic_pixel_art_pipeline',
    {
      title: 'Dựng Sprite Pixel Art hoàn toàn bằng mã (Offline / Deterministic)',
      description: 'Hướng dẫn Codex vẽ sprite bằng tọa độ pixel, ép bảng màu dự án, kiểm tra QC và duyệt.',
      argsSchema: {
        spriteName: z.string().describe('Tên sprite mới'),
        width: z.string().optional().describe('Chiều rộng px, VD: 32'),
        height: z.string().optional().describe('Chiều cao px, VD: 32')
      }
    },
    ({ spriteName, width, height }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Hãy tạo sprite pixel art "${spriteName}" (${width ?? '32'}×${height ?? '32'} px) bằng công cụ vẽ tất định:`,
              `1. Đọc \`piart://project/palettes\` để lấy đúng mã màu hex của dự án.`,
              `2. Gọi \`pixel_create_blank_sprite\` kèm mảng \`operations\` (fill_rect, line, set_pixel, outline) để dựng hình sạch sẽ.`,
              `3. Gọi \`pixel_transform\` với op="quantize" nếu cần ép 100% theo bảng màu dự án.`,
              `4. Gọi \`pixel_analyze_sprite\` để xác minh không có lỗi QC, sau đó \`revision_approve\`.`
            ].join('\n')
          }
        }
      ]
    })
  )

  server.registerPrompt(
    'build_and_validate_scene',
    {
      title: 'Dựng Bản đồ, Mô phỏng Hội thoại & Kiểm tra Gameplay',
      description: 'Kiểm tra toàn bộ Scene, Dialogue, Quest và DataTable trong dự án.',
      argsSchema: {
        sceneId: z.string().optional().describe('ID scene cụ thể (nếu biết)')
      }
    },
    ({ sceneId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Hãy kiểm tra và hoàn thiện dữ liệu thế giới & gameplay${sceneId ? ` cho scene "${sceneId}"` : ''}:`,
              `1. Gọi \`world_list_entities\` cho \`scene\`, \`dialogue\`, \`quest\`, \`data_table\`.`,
              `2. Gọi \`world_validate_scene\`, \`world_dialogue_validate\`, \`world_quest_validate\` và \`world_table_add_row_and_validate\` (appendRows=[]).`,
              `3. Dùng \`world_dialogue_simulate\` để kiểm chứng ít nhất 2 nhánh điều kiện túi đồ/cờ trạng thái khác nhau.`,
              `4. Tổng hợp danh sách lỗi (nếu có) và sửa trực tiếp bằng \`world_scene_paint_tiles\`, \`world_scene_place_asset\` hoặc \`world_upsert_entity\`.`
            ].join('\n')
          }
        }
      ]
    })
  )

  server.registerPrompt(
    'full_unity_export_audit',
    {
      title: 'Kiểm tra tiền xuất, Xuất gói Unity & Xác minh SHA-256',
      description: 'Tự động hóa trọn quy trình duyệt bản nháp, preflight, xuất Unity và kiểm tra checksum.',
      argsSchema: {
        targetDir: z.string().describe('Thư mục đích lưu gói xuất Unity'),
        approveDraftsFirst: z.string().optional().describe('true hoặc false')
      }
    },
    ({ targetDir, approveDraftsFirst }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Hãy chạy quy trình xuất gói tài nguyên sang Unity vào thư mục "${targetDir}":`,
              `1. Gọi \`studio_full_export_pipeline\` với targetDir="${targetDir}", approveDraftsFirst=${approveDraftsFirst === 'true'}.`,
              `2. Nếu giai đoạn preflight báo lỗi, đọc kỹ danh sách \`issues\`, khắc phục từng lỗi trong dự án rồi chạy lại.`,
              `3. Báo cáo kết quả cuối cùng: số lượng tệp đã xuất, đường dẫn \`manifest.json\` và trạng thái xác minh SHA-256.`
            ].join('\n')
          }
        }
      ]
    })
  )
}
