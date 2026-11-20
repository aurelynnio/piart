# AI Pixel Studio (`piart`) — MCP Server

MCP Server chuẩn **Model Context Protocol (JSON-RPC 2.0 over stdio)** cho **AI Pixel Studio**, cho phép **OpenAI Codex CLI** (hoặc bất kỳ MCP client nào) tự động hóa toàn bộ quy trình sản xuất tài nguyên game 2D pixel art và xuất gói kiểm chứng SHA-256 sang Unity 6 — dùng chung trực tiếp `StudioService`, SQLite WAL, `pixelEngine` và `unityExporter` với ứng dụng desktop Electron.

---

## 1. Build & Kết nối nhanh vào OpenAI Codex

### Bước 1: Build bundle MCP
```powershell
npm run build:mcp
```
Lệnh trên tạo tệp chạy độc lập tại `out/mcp/index.mjs` (khởi động tức thì trên Node 22+, không cần mở cửa sổ Electron).

### Bước 2: Đăng ký vào Codex CLI
```powershell
codex mcp add piart -- node "C:\Users\cyhin\piact\out\mcp\index.mjs"
```

Hoặc cấu hình trực tiếp trong `~/.codex/config.toml`:
```toml
[mcp_servers.piart]
command = "node"
args = [
  "C:/Users/cyhin/piact/out/mcp/index.mjs",
  "--provider", "mock"
]

[mcp_servers.piart.env]
# Tùy chọn: tự động mở sẵn một dự án khi khởi động MCP
# AI_PIXEL_STUDIO_PROJECT_DIR = "C:/Users/cyhin/Documents/MyPixelGame"
# Tùy chọn: dùng API thật với OpenAI (đổi --provider thành "openai")
# OPENAI_API_KEY = "sk-..."
```

> **Lưu ý bảo mật:** Không bao giờ đưa API key thật vào git. Có thể truyền qua biến môi trường `OPENAI_API_KEY` hoặc gọi tool `provider_set_api_key` với `fromEnvVar: "OPENAI_API_KEY"` để mã hóa vào `SecretStore`.

---

## 2. Danh mục năng lực (57 Tools · 12 Resources · 5 Prompts)

### Tools theo nhóm nghiệp vụ (`mcp/tools/`)
| Nhóm | File nguồn | Các công cụ chính |
| :--- | :--- | :--- |
| **Dự án & Phiên bản** | `projectTools.ts` | `studio_status`, `project_create`, `project_open`, `project_open_sample_workshop`, `project_close`, `project_get_summary`, `project_update_config`, `project_upsert_palette`, `project_upsert_preset`, `project_add_reference_image`, `project_backup_zip`, `project_restore_zip`, `project_undo`, `project_redo` |
| **Provider & Chẩn đoán** | `providerTools.ts` | `provider_get_settings`, `provider_update_settings`, `provider_set_api_key`, `provider_delete_api_key`, `provider_test_connection`, `studio_generate_diagnostics` |
| **Tài nguyên & Revision** | `assetTools.ts` | `asset_list`, `asset_get`, `asset_create_folder`, `asset_bulk_edit`, `asset_duplicate`, `asset_trash`, `asset_restore_trashed`, `revision_approve`, `revision_restore`, `blob_export_png` |
| **Vẽ & Xử lý Pixel Art** | `pixelTools.ts` | `pixel_import_png`, `pixel_create_blank_sprite`, `pixel_paint_canvas` (`set_pixel`/`fill_rect`/`line`/`outline`/`clear_rect`/`clear_all`), `pixel_save_layers`, `pixel_transform` (`flip_h`/`flip_v`/`rotate_cw`/`rotate_ccw`/`quantize`/`remove_bg`/`crop_resize`), `pixel_analyze_sprite` |
| **Animation Timeline** | `animationTools.ts` | `clip_list`, `clip_get`, `clip_update_timing`, `clip_edit_frames` (`toggle_lock`/`move`/`duplicate`/`delete`/`add_event`/`remove_event`), `clip_duplicate_or_reverse`, `clip_import_spritesheet` |
| **Prompt & Luồng AI** | `promptTools.ts` | `prompt_preview_plan`, `prompt_run_workflow`, `prompt_template_list`, `prompt_template_save`, `prompt_template_delete` |
| **Thế giới & Gameplay** | `worldTools.ts` | `world_list_entities`, `world_get_entity`, `world_upsert_entity`, `world_scene_paint_tiles`, `world_scene_place_asset`, `world_validate_scene`, `world_dialogue_validate`, `world_dialogue_simulate`, `world_quest_validate`, `world_table_add_row_and_validate` |
| **Hàng đợi & Usage** | `queueTools.ts` | `queue_list_jobs`, `queue_get_job`, `queue_cancel_job`, `queue_retry_job`, `queue_resume_jobs`, `usage_get_ledger` |
| **Xuất Unity & Bảo mật** | `exportTools.ts` | `unity_preflight_export`, `unity_export_package`, `unity_verify_export`, `project_read_file` |
| **Tự động hóa nâng cao** | `automationTools.ts` | `studio_approve_all_drafts`, `studio_full_export_pipeline`, `studio_batch_execute` |

### MCP Resources (`mcp/resources/index.ts`)
- Tĩnh: `piart://status`, `piart://project/summary`, `piart://project/config`, `piart://project/assets`, `piart://project/clips`, `piart://project/palettes`, `piart://project/presets`, `piart://project/jobs`, `piart://project/diagnostics`
- Động (Resource Templates): `piart://asset/{assetId}`, `piart://clip/{clipId}`, `piart://blob/{sha256}` (trả trực tiếp ảnh `image/png`)

### MCP Prompts (`mcp/prompts/index.ts`)
- `create_character_workflow`
- `mask_edit_animation_frame`
- `programmatic_pixel_art_pipeline`
- `build_and_validate_scene`
- `full_unity_export_audit`

---

## 3. Cách mở rộng thêm Tool / Pipeline mới

Kiến trúc MCP được tách module rõ ràng:
1. Tạo tệp mới trong `mcp/tools/<tenNhom>Tools.ts` và export hàm `register<TenNhom>Tools(ctx: PiartMcpContext)`.
2. Dùng `ctx.registerTool(name, { description, inputSchema }, handler)` — mọi tool đăng ký qua `ctx.registerTool` tự động:
   - Xác thực tham số bằng Zod
   - Lọc bí mật (`redactDeep`) khỏi đầu ra
   - Có thể được gọi trong chuỗi tự động hóa `studio_batch_execute`!
3. Thêm hàm đăng ký vào mảng `TOOL_MODULES` tại `mcp/tools/index.ts`.
4. Chạy `npm run typecheck && npm run build:mcp && npm run test:mcp`.
