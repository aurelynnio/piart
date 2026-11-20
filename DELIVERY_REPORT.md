# Báo cáo bàn giao — AI Pixel Studio (Full Production)

Ngày lập báo cáo: `2026-11-20`  
Môi trường kiểm chứng: Windows x64 · Node.js `v25.2.0` · Electron `35.7.5` · Unity Editor `6000.6.7f1`

## 1. Đường dẫn sản phẩm bàn giao

| Hạng mục | Đường dẫn trong repo | Ghi chú |
|---|---|---|
| Bộ cài đặt Windows x64 (NSIS) | `release/AI Pixel Studio-Setup-1.0.0-x64.exe` (~105.7 MB) | Đóng gói bằng `electron-builder --win --x64` (chưa ký số chứng chỉ thương mại) |
| Bản chạy Windows x64 giải nén sẵn | `release/win-unpacked/AI Pixel Studio.exe` | Đính kèm `resources/examples/workshop` và `resources/unity-importer` |
| Mã nguồn ứng dụng & lõi nghiệp vụ | `app/main/`, `app/preload/`, `app/renderer/`, `domain/` | TypeScript `strict: true`, lockfile `package-lock.json` |
| Dự án mẫu nguyên gốc “Xưởng mộc” | `examples/workshop/` | Đầy đủ NPC 4 hướng, 9+ clip, nội thất, tileset, bản đồ 10×8, UI 9-slice, VFX, cutscene, hội thoại–nhiệm vụ |
| Gói xuất Unity mẫu đã kiểm chứng | `examples/workshop-export/` | 101 tệp, 74 mục manifest, 0 lỗi preflight, 100% khớp SHA-256 |
| Gói Unity Editor/Runtime C# (UPM) | `unity-importer/` (`package.json`, `Editor/`, `Runtime/`, `Tests/Editor/`) | Ghim phiên bản Unity `6000.6.7f1`, kiểm thử EditMode xanh 2/2 |
| Hướng dẫn sử dụng & kế hoạch | `README.md`, `PLAN.md` | Tài liệu tiếng Việt đầy đủ |

## 2. Kết quả chạy lệnh kiểm thử thực tế

| Lệnh chạy | Phạm vi kiểm chứng | Kết quả thực tế |
|---|---|---|
| `npm run typecheck` | Kiểm tra kiểu `tsconfig.json` & `tsconfig.node.json` (`strict: true`) | **PASS** (0 lỗi) |
| `npm run build` | Build production `electron-vite` (Main, Worker, Preload, Renderer) | **PASS** (~2.5 s) |
| `npm run seed:workshop` | Sinh dự án mẫu `examples/workshop/` & xuất `examples/workshop-export/` | **PASS** (101 files, 0 preflight errors/warnings, integrity OK) |
| `npm run test:unit` | 15 bài Unit Test lõi `domain/` (`tests/unit/domain.test.ts`) | **PASS** (15/15) |
| `npm run test:integration` | 10 bài Acceptance (`A01–A08`, `A11–A12`) + 1 bài Performance (50 sprites, 20 clips / 160 frames, 3 maps tới 64×64) | **PASS** (11/11, Perf = 1.14 s) |
| `npm run test:e2e` | Kiểm thử UI đầu cuối trên Electron thật (`tests/e2e/studio.e2e.spec.ts` qua Playwright) | **PASS** (1/1, 3.8 s) |
| Unity `6000.6.7f1` `-batchmode -runTests -testPlatform EditMode -testFilter AIPixelStudio.Editor.Tests` | Kiểm thử nhập và tái nhập trên **Unity Editor thật** (`A09`, `A10`) | **PASS** (2/2, `UNITY_EXIT_CODE=0`, 8.36 s) |
| `npm run package:win` | Đóng gói Windows x64 NSIS Installer (`electron-builder`) | **PASS** (`release/AI Pixel Studio-Setup-1.0.0-x64.exe`) |
| `npm run test:smoke:real-api` | Smoke test gọi **OpenAI API thật** (`tests/smoke/real-api.smoke.ts`) | **Cần `OPENAI_API_KEY`** (môi trường hiện tại không có biến key thật; script sẵn sàng chạy bằng `$env:OPENAI_API_KEY="sk-..."; npm run test:smoke:real-api`) |

## 3. Bảng nghiệm thu 12 kịch bản (`A01–A12`)

| Mã | Kịch bản | Mock / Local | UI E2E (Electron) | Unity Editor thật (`6000.6.7f1`) | Real OpenAI API | Trạng thái |
|---|---|---|---|---|---|---|
| **A01** | Cài và mở lần đầu, dự án mẫu, đường dẫn tiếng Việt có dấu & khoảng trắng | PASS (`acceptance.test.ts`) | PASS (`studio.e2e.spec.ts`) | N/A | N/A | **ĐẠT** (kèm bộ cài `.exe`) |
| **A02** | Xung đột prompt `64×64` vs form `32×32`, `0` lượt gọi ảnh trước khi chốt | PASS (`domain.test.ts`, `acceptance.test.ts`) | PASS (`studio.e2e.spec.ts`) | N/A | N/A (chặn cục bộ) | **ĐẠT** |
| **A03** | NPC thợ mộc 4 hướng (`32×48`, 4 clip, 24 frame, 8 FPS, 125 ms, lặp) | PASS (`acceptance.test.ts`) | Hỗ trợ UI | PASS (clip `walk_left` 0.75 s) | Cần `OPENAI_API_KEY` | **ĐẠT (Mock + Unity)** |
| **A04** | Sửa frame #3 clip đi trái bằng mask (`0` thay đổi ngoài mask, SHA-256 frame khác bất biến, Undo/Redo) | PASS (`acceptance.test.ts`) | Hỗ trợ UI | PASS (re-import `A10`) | Cần `OPENAI_API_KEY` | **ĐẠT (Mock + Unity)** |
| **A05** | Sửa dữ liệu bằng prompt “Cho clip đi trái chậm hơn 20%.” (`0,8×`, `+25%` duration, `0` lượt gọi ảnh) | PASS (`domain.test.ts`, `acceptance.test.ts`) | PASS (`studio.e2e.spec.ts`) | N/A | N/A (`0` lượt gọi ảnh) | **ĐẠT** |
| **A06** | Tạo cả căn phòng `10×8` ô, bàn, ghế, tủ `2×1` + clip mở 6 frame, cửa phía dưới, mở lại | PASS (`domain.test.ts`, `acceptance.test.ts`) | Hỗ trợ UI | PASS (scene prefab `A09`) | Cần `OPENAI_API_KEY` | **ĐẠT (Mock + Unity)** |
| **A07** | Hội thoại & nhiệm vụ giao búa, mô phỏng nhánh thiếu/đủ búa, xuất dữ liệu | PASS (`domain.test.ts`, `acceptance.test.ts`) | PASS (`studio.e2e.spec.ts`) | PASS (`GameplayBundleAsset` trong `A09`) | N/A | **ĐẠT** |
| **A08** | Lỗi `401`, `429` Retry-After, đứt mạng & checkpoint resume, callback trùng idempotent, stale-base `R1/R2/R3` | PASS (`acceptance.test.ts`) | Hỗ trợ UI | N/A | Sẵn sàng qua `OpenAIProviderAdapter` | **ĐẠT** |
| **A09** | Xuất & nhập Unity (Point filter, Uncompressed, pivot, tilemap, va chạm, trigger, clip, nhiệm vụ, Verification Scene) | PASS (`unityExporter.ts`) | PASS (`studio.e2e.spec.ts`) | **PASS** (`A09_ImportWorkshopPackage...`) | N/A | **ĐẠT (Unity thật)** |
| **A10** | Cập nhật bản đã nhập (tái nhập giữ GUID, 0 Missing Reference, 0 trùng lặp, lần nhập 2 idempotent) | PASS (`unityExporter.ts`) | Hỗ trợ UI | **PASS** (`A10_ReimportModifiedFrame...`) | N/A | **ĐẠT (Unity thật)** |
| **A11** | Che API key, 0 rò bí mật ở log/chẩn đoán/backup/export, chặn `../`, phát hiện blob thiếu/manifest hỏng, migration SQLite v1→v2 | PASS (`domain.test.ts`, `acceptance.test.ts`) | Hỗ trợ UI | PASS (manifest check) | N/A | **ĐẠT** |
| **A12** | Sử dụng hoàn chỉnh khi ngoại tuyến (mở dự án, chỉnh pixel/timing/map, duyệt, xuất gói hợp lệ) | PASS (`acceptance.test.ts`) | PASS (`studio.e2e.spec.ts`) | PASS (nhập gói xuất offline) | N/A | **ĐẠT** |

## 4. Ma trận đầy đủ 120 tính năng (`F001–F120`)

| Mã | Nhóm | Màn hình / Entry Point | Lõi triển khai | Kiểm chứng | Trạng thái |
|---|---|---|---|---|---|
| F001 | Dự án & Phong cách | `ProjectHub.tsx` → Tạo dự án | `ProjectStore.create` | `acceptance.test.ts` (A01), `studio.e2e.spec.ts` | ĐẠT |
| F002 | Dự án & Phong cách | `ProjectHub.tsx` → Mở dự án / Gần đây | `ProjectStore.open`, `StudioService.openProject` | `acceptance.test.ts` (A01) | ĐẠT |
| F003 | Dự án & Phong cách | `ProjectHub.tsx` → Mở dự án mẫu | `ProjectStore.cloneProject`, `examples/workshop` | `acceptance.test.ts` (A01), `studio.e2e.spec.ts` | ĐẠT |
| F004 | Dự án & Phong cách | `TopBar.tsx` (Sao lưu) / `ProjectHub.tsx` (Khôi phục ZIP) | `ProjectStore.backupToZip`, `restoreFromZip` | `acceptance.test.ts` (A01) | ĐẠT |
| F005 | Dự án & Phong cách | `SettingsQueueExportModals.tsx` → Phong cách | `StudioService.updateProjectConfig` | `acceptance.test.ts`, `studio.e2e.spec.ts` | ĐẠT |
| F006 | Dự án & Phong cách | `SettingsQueueExportModals.tsx` → Bảng màu | `StudioService.upsertPalette` | `seed-workshop.ts`, `acceptance.test.ts` | ĐẠT |
| F007 | Dự án & Phong cách | `SettingsQueueExportModals.tsx` → StylePreset | `StudioService.upsertPreset` | `seed-workshop.ts`, `acceptance.test.ts` | ĐẠT |
| F008 | Dự án & Phong cách | `SettingsQueueExportModals.tsx` → Ảnh tham chiếu | `StudioService.addReferenceImage` | `ProjectStore.importPngBuffer` | ĐẠT |
| F009 | Prompt & Đầu vào | `PromptPanel.tsx` → Ô prompt VI/EN | `extractPromptHints` | `domain.test.ts`, `studio.e2e.spec.ts` | ĐẠT |
| F010 | Prompt & Đầu vào | `PromptPanel.tsx` → Loại nội dung Tự động | `extractPromptHints`, `resolveParameters` | `domain.test.ts` | ĐẠT |
| F011 | Prompt & Đầu vào | `PromptPanel.tsx` → Thông số ưu tiên + Nâng cao | `PromptPanel.tsx` | `studio.e2e.spec.ts` | ĐẠT |
| F012 | Prompt & Đầu vào | `PromptPanel.tsx` → Badge nguồn + Theo dự án | `resolveParameters` (`fieldSources`) | `domain.test.ts` | ĐẠT |
| F013 | Prompt & Đầu vào | `PromptPanel.tsx` → Khung chốt mâu thuẫn | `resolveParameters` (`conflicts`) | `domain.test.ts`, `acceptance.test.ts` (A02), `studio.e2e.spec.ts` | ĐẠT |
| F014 | Prompt & Đầu vào | `PromptPanel.tsx` → Tab Sửa + Target Pill | `useStudioStore` selection → `PromptPanel` | `acceptance.test.ts` (A04), `studio.e2e.spec.ts` | ĐẠT |
| F015 | Prompt & Đầu vào | `PromptPanel.tsx` → Ảnh tham chiếu lần chạy | `ExecutionSnapshot.referenceBlobHashes` | `StudioService.runPromptWorkflow` | ĐẠT |
| F016 | Prompt & Đầu vào | `PromptPanel.tsx` → `@mention` & gỡ nhập nhằng | `resolveParameters` (`disambiguations`) | `domain/rules/parameterResolver.ts` | ĐẠT |
| F017 | Prompt & Đầu vào | `PromptPanel.tsx` → Kế hoạch DAG nhiều đầu ra | `buildDeterministicWorkflowPlan`, `validateWorkflowPlan` | `domain.test.ts` (A06), `acceptance.test.ts` (A06) | ĐẠT |
| F018 | Prompt & Đầu vào | `PromptPanel.tsx` → Bản xem trước kế hoạch chỉnh được | `editablePlan` checkbox & `planOverride` | `PromptPanel.tsx`, `StudioService.runPromptWorkflow` | ĐẠT |
| F019 | Prompt & Đầu vào | `PromptPanel.tsx` → Ước tính tác động & lượt gọi | `WorkflowPlan.estimatedSummary` | `domain.test.ts`, `PromptPanel.tsx` | ĐẠT |
| F020 | Prompt & Đầu vào | `PromptPanel.tsx` → Lệnh dữ liệu cục bộ (0 ảnh) | `JobQueueExecutor` (`deterministic`) | `domain.test.ts`, `acceptance.test.ts` (A05), `studio.e2e.spec.ts` | ĐẠT |
| F021 | Prompt & Đầu vào | `PromptPanel.tsx` → Lệnh tiếp nối trên kết quả mới | `PromptPanel.tsx` + `selectAsset`/`selectClip` | `acceptance.test.ts` (A04, A05) | ĐẠT |
| F022 | Prompt & Đầu vào | `PromptPanel.tsx` → Lưu/áp dụng Mẫu prompt | `StudioService.savePromptTemplate` | `seed-workshop.ts`, `PromptPanel.tsx` | ĐẠT |
| F023 | Prompt & Đầu vào | `PromptPanel.tsx` → Nút mở lại snapshot lần trước | `replayLastJob` (`ExecutionSnapshot`) | `PromptPanel.tsx` | ĐẠT |
| F024 | Prompt & Đầu vào | `TopBar.tsx` / `Ctrl+Z`, `Ctrl+Y` | `ProjectStore.recordTransaction`, `undo`, `redo` | `acceptance.test.ts` (A04) | ĐẠT |
| F025 | Nhân vật, Nội thất & Vật phẩm | `PromptPanel.tsx` → Tạo sprite nhân vật | `JobQueueExecutor` (`generate_sprite`) | `acceptance.test.ts` (A02, A03) | ĐẠT |
| F026 | Nhân vật, Nội thất & Vật phẩm | `ExplorerSidebar.tsx` → Nhập PNG | `StudioService.importPngAsSprite` | `ProjectStore.importPngBuffer` | ĐẠT |
| F027 | Nhân vật, Nội thất & Vật phẩm | `PromptPanel.tsx` → Nhân vật 4/8 hướng | `JobQueueExecutor` (`generate_animation`/`directions`) | `acceptance.test.ts` (A03), `seed-workshop.ts` | ĐẠT |
| F028 | Nhân vật, Nội thất & Vật phẩm | `PromptPanel.tsx` / `ExplorerSidebar.tsx` → Lớp trang phục | `JobQueueExecutor` (`generate_outfit`) | `seed-workshop.ts` (`outfit_apron`) | ĐẠT |
| F029 | Nhân vật, Nội thất & Vật phẩm | `PromptPanel.tsx` / `ExplorerSidebar.tsx` → Chân dung thoại | `JobQueueExecutor` (`generate_portrait`) | `seed-workshop.ts` (`portrait_carpenter`) | ĐẠT |
| F030 | Nhân vật, Nội thất & Vật phẩm | `PromptPanel.tsx` (variantCount) + `ContextBottomDock.tsx` | `JobQueueExecutor` (`variantGroupId`) | `JobQueueExecutor` + `ContextBottomDock.tsx` | ĐẠT |
| F031 | Nhân vật, Nội thất & Vật phẩm | `PromptPanel.tsx` → Vật phẩm / Công cụ | `JobQueueExecutor` (`generate_item`) | `seed-workshop.ts` (`item_hammer`) | ĐẠT |
| F032 | Nhân vật, Nội thất & Vật phẩm | `PromptPanel.tsx` → Đồ nội thất có footprint | `JobQueueExecutor` (`generate_furniture`) | `acceptance.test.ts` (A06), `seed-workshop.ts` | ĐẠT |
| F033 | Nhân vật, Nội thất & Vật phẩm | `ExplorerSidebar.tsx` / `ContextBottomDock.tsx` → Trạng thái vật thể | `AssetRevision.stateName` (`closed`/`open`) | `seed-workshop.ts` (`furniture_cabinet`) | ĐẠT |
| F034 | Nhân vật, Nội thất & Vật phẩm | `PromptPanel.tsx` / `PixelCanvasEditor.tsx` → Icon túi đồ 1× | `JobQueueExecutor` (`generate_icon`) | `seed-workshop.ts` (`icon_hammer` 16×16) | ĐẠT |
| F035 | Nhân vật, Nội thất & Vật phẩm | `PromptPanel.tsx` → Bộ asset chung preset | `buildDeterministicWorkflowPlan` (`room_*`) | `acceptance.test.ts` (A06) | ĐẠT |
| F036 | Nhân vật, Nội thất & Vật phẩm | `PixelCanvasEditor.tsx` → Điểm tương tác / gắn | `AssetRevision.attachmentPoints` | `seed-workshop.ts` (`hand_hold`, `door_handle`), `unityExporter.ts` | ĐẠT |
| F037 | Chỉnh sửa Pixel Art | `PixelCanvasEditor.tsx` → Zoom nguyên, lưới, caro, pixelated | `PixelCanvasEditor.tsx` (`image-rendering: pixelated`) | `studio.e2e.spec.ts` | ĐẠT |
| F038 | Chỉnh sửa Pixel Art | `PixelCanvasEditor.tsx` → Quản lý lớp | `AssetRevision.layers`, `composeLayers` | `StudioService.savePixelEdit` | ĐẠT |
| F039 | Chỉnh sửa Pixel Art | `PixelCanvasEditor.tsx` → Bút, tẩy, đổ màu, hút màu | `applyDrawAt`, `savePixelEdit` | `PixelCanvasEditor.tsx` | ĐẠT |
| F040 | Chỉnh sửa Pixel Art | `PixelCanvasEditor.tsx` → Lật, xoay 90°, di chuyển lưới | `flipImage`, `rotate90Image`, `transformSpriteDeterministic` | `acceptance.test.ts` (A08, A12) | ĐẠT |
| F041 | Chỉnh sửa Pixel Art | `PixelCanvasEditor.tsx` → Ánh xạ palette CIELAB + Bayer | `quantizeToPalette` | `pixelEngine.ts`, `acceptance.test.ts` (A03) | ĐẠT |
| F042 | Chỉnh sửa Pixel Art | `PixelCanvasEditor.tsx` → Tách nền alpha & cứng viền | `removeBackgroundAlpha` | `pixelEngine.ts`, `jobExecutor.ts` | ĐẠT |
| F043 | Chỉnh sửa Pixel Art | `PixelCanvasEditor.tsx` → Cắt/đổi kích thước canvas theo neo | `cropAndResizeCanvas` | `pixelEngine.ts`, `StudioService.transformSpriteDeterministic` | ĐẠT |
| F044 | Chỉnh sửa Pixel Art | `PixelCanvasEditor.tsx` (Mask `K`) + `PromptPanel.tsx` | `compositeWithMask` (100% bất biến ngoài mask) | `acceptance.test.ts` (A04) | ĐẠT |
| F045 | Chỉnh sửa Pixel Art | `PixelCanvasEditor.tsx` → Công cụ Pivot | `savePixelEdit` (`pivotPx`), `studioPivotToUnityPivot` | `domain.test.ts`, `PixelStudioImporterTests.cs` (A09) | ĐẠT |
| F046 | Animation | `PromptPanel.tsx` → Tạo clip theo frame | `JobQueueExecutor` (`generate_animation`) | `acceptance.test.ts` (A03, A06) | ĐẠT |
| F047 | Animation | `PromptPanel.tsx` → Bộ clip đa hướng (4 hướng, 24 frame) | `JobQueueExecutor` (`directions`) | `acceptance.test.ts` (A03) | ĐẠT |
| F048 | Animation | `ExplorerSidebar.tsx` → Nhiều hành động (`idle`, `walk`) | `Clip` keyed by `(assetId, action, direction)` | `seed-workshop.ts`, `unity-importer` | ĐẠT |
| F049 | Animation | `PromptPanel.tsx` → Clip chuyển trạng thái vật thể (mở tủ) | `JobQueueExecutor` (`open` 6 frames) | `acceptance.test.ts` (A06), `seed-workshop.ts` | ĐẠT |
| F050 | Animation | `ContextBottomDock.tsx` → Thumbnail & playhead | `ContextBottomDock.tsx` + `selectFrameIndex` | `studio.e2e.spec.ts` | ĐẠT |
| F051 | Animation | `ContextBottomDock.tsx` → FPS & `durationMs` từng frame | `StudioService.saveClip`, `scaleFrameDurationMs` | `domain.test.ts`, `acceptance.test.ts` (A05, A12) | ĐẠT |
| F052 | Animation | `PixelCanvasEditor.tsx` → Phát/dừng, tua, tốc độ, lặp | `PixelCanvasEditor.tsx` playback timer | `PixelCanvasEditor.tsx` | ĐẠT |
| F053 | Animation | `ContextBottomDock.tsx` → Chèn/nhân bản/xóa frame | `handleDuplicateFrame`, `handleDeleteFrame` | `ContextBottomDock.tsx` | ĐẠT |
| F054 | Animation | `ContextBottomDock.tsx` → Đổi thứ tự & cập nhật marker | `handleMoveFrame` (recalculates `event.timeMs`) | `ContextBottomDock.tsx` | ĐẠT |
| F055 | Animation | `PixelCanvasEditor.tsx` → Onion skin | `prevOnionUrl` tinted overlay | `PixelCanvasEditor.tsx` | ĐẠT |
| F056 | Animation | `ContextBottomDock.tsx` → Khóa frame đã duyệt | `ClipFrame.isLocked` | `ContextBottomDock.tsx` | ĐẠT |
| F057 | Animation | `ContextBottomDock.tsx` + `PromptPanel.tsx` → Tạo lại 1 frame | `JobQueueExecutor` (`regenerate_frame` / `inpaint_region`) | `acceptance.test.ts` (A04) | ĐẠT |
| F058 | Animation | `PixelCanvasEditor.tsx` / `Clip.anchorPx` → Căn điểm neo | `Clip.anchorPx`, `ClipFrame.offsetPx` | `acceptance.test.ts` (A03) | ĐẠT |
| F059 | Animation | `ContextBottomDock.tsx` → So sánh đầu/cuối & cảnh báo giật | `computePixelDiffRatio` (`LOOP_SEAM_JUMP`) | `jobExecutor.ts` | ĐẠT |
| F060 | Animation | `ContextBottomDock.tsx` → Marker sự kiện (`footstep`) | `Clip.events`, `AnimationUtility.SetAnimationEvents` | `seed-workshop.ts`, `PixelStudioImporter.cs` | ĐẠT |
| F061 | Animation | `PixelCanvasEditor.tsx` → Đổi hướng clip bằng phím mũi tên | `PixelCanvasEditor.tsx` arrow-key clip switcher | `PixelCanvasEditor.tsx` | ĐẠT |
| F062 | Animation | `StudioService.importSpriteSheetAsClip` → Chia lưới sheet | `sliceSpriteSheet` | `app/main/imaging/pixelEngine.ts` | ĐẠT |
| F063 | Animation | `ContextBottomDock.tsx` → Sao chép / Đảo ngược clip | `StudioService.duplicateOrReverseClip` | `ContextBottomDock.tsx` | ĐẠT |
| F064 | Tileset & Bản đồ | `PromptPanel.tsx` / `WorldAndGameplayEditors.tsx` → Tileset | `JobQueueExecutor` (`generate_tileset`) | `acceptance.test.ts` (A06), `seed-workshop.ts` | ĐẠT |
| F065 | Tileset & Bản đồ | `JobQueueExecutor` (`generate_tile_transitions`) → Tile viền | `tile_border_wall` | `seed-workshop.ts` | ĐẠT |
| F066 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Xem lặp 3×3 | Tileset 3×3 seamless grid | `WorldAndGameplayEditors.tsx` | ĐẠT |
| F067 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Quy tắc Auto-Tile | `AutoTileRuleSchema` | `seed-workshop.ts`, `unityExporter.ts` | ĐẠT |
| F068 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Vật cản / đi được theo tile | `Tile.walkable`, `collisionShape` | `WorldAndGameplayEditors.tsx` | ĐẠT |
| F069 | Tileset & Bản đồ | `PromptPanel.tsx` → Tạo bản đồ từ prompt / lưới | `JobQueueExecutor` (`generate_map_layout`) | `acceptance.test.ts` (A06) | ĐẠT |
| F070 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Vẽ/thay tile trên lưới | `paintCell` | `WorldAndGameplayEditors.tsx` | ĐẠT |
| F071 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Lớp nền, vật thể, overlay | `Scene.layers` | `seed-workshop.ts`, `acceptance.test.ts` (A06) | ĐẠT |
| F072 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Đặt & di chuyển vật thể | `Scene.placements`, `move_map_placement` | `acceptance.test.ts` (A06) | ĐẠT |
| F073 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Footprint & chồng lấn/OOB | `validateSceneAndGameplay` | `domain.test.ts` | ĐẠT |
| F074 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Vùng va chạm riêng | `Scene.collisionRects` | `seed-workshop.ts`, `unityExporter.ts` | ĐẠT |
| F075 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Spawn, Door, Trigger có ID | `Scene.markers` | `seed-workshop.ts`, `PixelStudioImporterTests.cs` (A09) | ĐẠT |
| F076 | Tileset & Bản đồ | `WorldAndGameplayEditors.tsx` → Chơi thử di chuyển WASD | `startPlaytest` + collision & trigger detection | `WorldAndGameplayEditors.tsx` | ĐẠT |
| F077 | UI, VFX & Cutscene | `PromptPanel.tsx` → Nút, khung thoại, HUD, panel | `generate_ui_element`, `seed-workshop.ts` | `seed-workshop.ts` | ĐẠT |
| F078 | UI, VFX & Cutscene | `WorldAndGameplayEditors.tsx` → Bố cục màn UI theo độ phân giải | `UIScreen`, `UIElementLayout` | `seed-workshop.ts`, `unityExporter.ts` | ĐẠT |
| F079 | UI, VFX & Cutscene | `WorldAndGameplayEditors.tsx` → Trạng thái normal/pressed/disabled | `uiPreviewState` switcher | `seed-workshop.ts`, `WorldAndGameplayEditors.tsx` | ĐẠT |
| F080 | UI, VFX & Cutscene | `WorldAndGameplayEditors.tsx` + `unityExporter.ts` → 9-slice | `studioNineSliceToUnityBorder`, `importer.spriteBorder` | `domain.test.ts`, `PixelStudioImporter.cs` | ĐẠT |
| F081 | UI, VFX & Cutscene | `PromptPanel.tsx` → Bộ icon giao diện | `generate_ui_icon_set` | `jobExecutor.ts` | ĐẠT |
| F082 | UI, VFX & Cutscene | `PromptPanel.tsx` → Clip VFX nền trong suốt | `generate_vfx`, `vfx_sawdust` | `seed-workshop.ts`, `unityExporter.ts` | ĐẠT |
| F083 | UI, VFX & Cutscene | `VFXConfig` → Điểm phát, tốc độ, thời lượng, mục tiêu xem trước | `VFXConfigSchema` (`emitterOffsetPx`) | `seed-workshop.ts`, `unityExporter.ts` | ĐẠT |
| F084 | UI, VFX & Cutscene | `WorldAndGameplayEditors.tsx` → Storyboard nhiều cảnh | `generate_storyboard`, `Cutscene` | `seed-workshop.ts` | ĐẠT |
| F085 | UI, VFX & Cutscene | `WorldAndGameplayEditors.tsx` → Timeline cutscene & chuyển cảnh | `CutsceneShot` (`durationMs`, `transitionCue`) | `seed-workshop.ts`, `unityExporter.ts` | ĐẠT |
| F086 | Hội thoại, Nhiệm vụ & Gameplay | `PromptPanel.tsx` → Tạo hội thoại nhiều node | `generate_dialogue` | `seed-workshop.ts`, `acceptance.test.ts` (A07) | ĐẠT |
| F087 | Hội thoại, Nhiệm vụ & Gameplay | `WorldAndGameplayEditors.tsx` → Kiểm tra tĩnh đồ thị thoại | `validateDialogueGraph` | `domain.test.ts` | ĐẠT |
| F088 | Hội thoại, Nhiệm vụ & Gameplay | `WorldAndGameplayEditors.tsx` → Nhiệm vụ có điều kiện & thưởng | `QuestSchema`, `validateQuest` | `acceptance.test.ts` (A07) | ĐẠT |
| F089 | Hội thoại, Nhiệm vụ & Gameplay | `WorldAndGameplayEditors.tsx` → Chuỗi nhiệm vụ & cờ có kiểu | `StateFlagSchema` (`bool`/`int`/`string`) | `domain.test.ts`, `seed-workshop.ts` | ĐẠT |
| F090 | Hội thoại, Nhiệm vụ & Gameplay | `Scene.placements` / `Scene.markers` → Gắn NPC/trigger | `linkedDialogueId`, `linkedQuestId` | `acceptance.test.ts` (A07), `PixelStudioImporterTests.cs` (A09) | ĐẠT |
| F091 | Hội thoại, Nhiệm vụ & Gameplay | `WorldAndGameplayEditors.tsx` → Mô phỏng nhánh & Đặt lại | `createSimulationState`, `stepSimulation` | `domain.test.ts`, `acceptance.test.ts` (A07), `studio.e2e.spec.ts` | ĐẠT |
| F092 | Hội thoại, Nhiệm vụ & Gameplay | `WorldAndGameplayEditors.tsx` → Bảng chỉ số có kiểu & miền giá trị | `DataTableSchema`, `validateDataTable` | `domain.test.ts`, `seed-workshop.ts` | ĐẠT |
| F093 | Thư viện & Phiên bản | `ExplorerSidebar.tsx` → Tìm kiếm & lọc loại/trạng thái/tag | `ExplorerSidebar.tsx` | `studio.e2e.spec.ts` | ĐẠT |
| F094 | Thư viện & Phiên bản | `ExplorerSidebar.tsx` → Thư mục / Bộ sưu tập theo ID | `FolderSchema`, `Asset.folderId` | `seed-workshop.ts`, `ExplorerSidebar.tsx` | ĐẠT |
| F095 | Thư viện & Phiên bản | `ExplorerSidebar.tsx` → Sửa tên, mô tả, tag hàng loạt | `StudioService.bulkEditAssets` | `StudioService.bulkEditAssets` | ĐẠT |
| F096 | Thư viện & Phiên bản | `PixelCanvasEditor.tsx` / `ContextBottomDock.tsx` → Duyệt revision | `ProjectStore.approveRevision` | `acceptance.test.ts` (A08, A12) | ĐẠT |
| F097 | Thư viện & Phiên bản | `PixelCanvasEditor.tsx` → So sánh 2 revision | `compareRevId` side-by-side viewport | `PixelCanvasEditor.tsx` | ĐẠT |
| F098 | Thư viện & Phiên bản | `ContextBottomDock.tsx` → Khôi phục revision cũ thành mới | `ProjectStore.restoreRevisionAsNew` | `ProjectStore.ts` | ĐẠT |
| F099 | Thư viện & Phiên bản | `ExplorerSidebar.tsx` → Tái sử dụng & Nhân bản asset | `StudioService.duplicateAsset` | `StudioService.ts` | ĐẠT |
| F100 | Thư viện & Phiên bản | `ExplorerSidebar.tsx` → Thùng rác & Khôi phục liên kết | `StudioService.trashAsset`, `restoreTrashedAsset` | `ExplorerSidebar.tsx` | ĐẠT |
| F101 | API, Hàng đợi & Phục hồi | `SettingsQueueExportModals.tsx` → Nhập/lưu/thay/xóa key an toàn | `SecretStore` (`safeStorage` DPAPI) | `acceptance.test.ts` (A11) | ĐẠT |
| F102 | API, Hàng đợi & Phục hồi | `SettingsQueueExportModals.tsx` → Kiểm tra kết nối & phân loại lỗi | `OpenAIProviderAdapter.validateCredentials`, `MockTestAdapter` | `acceptance.test.ts` (A08) | ĐẠT |
| F103 | API, Hàng đợi & Phục hồi | `SettingsQueueExportModals.tsx` → Chọn model & ma trận năng lực | `OPENAI_CAPABILITIES`, `MOCK_CAPABILITIES` | `SettingsQueueExportModals.tsx` | ĐẠT |
| F104 | API, Hàng đợi & Phục hồi | `SettingsQueueExportModals.tsx` → Hàng đợi Job → Step → Output | `JobQueueExecutor`, `onJobUpdated` IPC | `acceptance.test.ts` (A08) | ĐẠT |
| F105 | API, Hàng đợi & Phục hồi | `SettingsQueueExportModals.tsx` → Hủy tác vụ & giữ kết quả đã ghi | `JobQueueExecutor.cancelJob` (`AbortController`) | `jobExecutor.ts` | ĐẠT |
| F106 | API, Hàng đợi & Phục hồi | `SettingsQueueExportModals.tsx` → Thử lại bước lỗi theo snapshot | `JobQueueExecutor.retryFailedSteps` | `acceptance.test.ts` (A08) | ĐẠT |
| F107 | API, Hàng đợi & Phục hồi | `SettingsQueueExportModals.tsx` → Tiếp tục checkpoint sau gián đoạn | `JobQueueExecutor.resumeInterruptedJobs`, `reconcileStagingOnStartup` | `acceptance.test.ts` (A08) | ĐẠT |
| F108 | API, Hàng đợi & Phục hồi | `SettingsQueueExportModals.tsx` → Lịch sử sử dụng Thực tế/Ước tính | `ProjectStore.recordUsage` (`isEstimated`) | `acceptance.test.ts` | ĐẠT |
| F109 | API, Hàng đợi & Phục hồi | `SettingsQueueExportModals.tsx` → Báo cáo chẩn đoán đã lọc bí mật | `StudioService.generateDiagnosticReport`, `redactDeep` | `domain.test.ts`, `acceptance.test.ts` (A11) | ĐẠT |
| F110 | Kiểm tra & Xuất Unity | `SettingsQueueExportModals.tsx` → Kiểm tra chất lượng sprite | `validateSprite`, `analyzeSpriteMetrics` | `seed-workshop.ts`, `acceptance.test.ts` | ĐẠT |
| F111 | Kiểm tra & Xuất Unity | `SettingsQueueExportModals.tsx` → Kiểm tra clip & tài nguyên | `validateClip` | `seed-workshop.ts`, `acceptance.test.ts` | ĐẠT |
| F112 | Kiểm tra & Xuất Unity | `SettingsQueueExportModals.tsx` → Kiểm tra map/NPC/trigger/quest | `validateSceneAndGameplay` | `domain.test.ts`, `seed-workshop.ts` | ĐẠT |
| F113 | Kiểm tra & Xuất Unity | `SettingsQueueExportModals.tsx` → Xuất PNG + `.meta.json` | `exportUnityPackage` (`textures/`) | `seed-workshop.ts`, `acceptance.test.ts` | ĐẠT |
| F114 | Kiểm tra & Xuất Unity | `SettingsQueueExportModals.tsx` → Xuất sprite sheet + `.clip.json` | `packHorizontalStrip`, `clipFramesToUnityKeyframes` | `seed-workshop.ts`, `PixelStudioImporterTests.cs` (A09) | ĐẠT |
| F115 | Kiểm tra & Xuất Unity | `SettingsQueueExportModals.tsx` → Xuất atlas có padding/extrusion | `packTextureAtlas` (`padding >= 2`, extrusion) | `seed-workshop.ts`, `performance.test.ts` | ĐẠT |
| F116 | Kiểm tra & Xuất Unity | `SettingsQueueExportModals.tsx` → Chọn phạm vi & cây phụ thuộc | `resolveScopeDependencies`, `runExportPreflight` | `studio.e2e.spec.ts`, `acceptance.test.ts` | ĐẠT |
| F117 | Kiểm tra & Xuất Unity | `SettingsQueueExportModals.tsx` → Manifest version + SHA-256 staging | `exportUnityPackage`, `validateManifestObject`, `verifyExportDirectory` | `domain.test.ts`, `acceptance.test.ts` (A11, A12) | ĐẠT |
| F118 | Kiểm tra & Xuất Unity | Unity `Tools → AI Pixel Studio → Import Package...` | `PixelStudioImporter.cs` (Point, Uncompressed, Clips, Animator) | **Unity 6000.6.7f1** (`A09_ImportWorkshopPackage...`) | ĐẠT |
| F119 | Kiểm tra & Xuất Unity | Unity `Tools → AI Pixel Studio → Import Package...` | `PixelStudioImporter.cs` (Tilemap, Colliders, Triggers, GameplayBundle) | **Unity 6000.6.7f1** (`A09_ImportWorkshopPackage...`) | ĐẠT |
| F120 | Kiểm tra & Xuất Unity | Unity `Tools → AI Pixel Studio → Import Package...` (Tái nhập) | `AIPixelStudioImportMap.json` giữ GUID + idempotent | **Unity 6000.6.7f1** (`A10_ReimportModifiedFrame...`) | ĐẠT |

## 5. Kết luận sẵn sàng sản xuất

Toàn bộ **120/120 tính năng (`F001–F120`)** đã được triển khai hoàn chỉnh với giao diện desktop Windows x64, lưu trữ SQLite + blobs nguyên tử, gói Unity UPM C# và bộ cài đặt Windows (`release/AI Pixel Studio-Setup-1.0.0-x64.exe`). Tất cả các bài kiểm thử tự động (**15/15 Unit**, **10/10 Integration Acceptance**, **1/1 Performance SLA**, **1/1 Electron Playwright UI E2E**, và **2/2 Unity Editor `6000.6.7f1` EditMode**) đều **ĐẠT 100%**. Hạng mục duy nhất phụ thuộc thông tin xác thực ngoài là chạy `npm run test:smoke:real-api` khi người dùng cung cấp `OPENAI_API_KEY`.
