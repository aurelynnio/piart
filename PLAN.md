# Kế hoạch triển khai AI Pixel Studio (Full Production)

Tài liệu kế hoạch ngắn theo yêu cầu `Prompt_AI_Pixel_Studio_Full_Production.md` cho repo `C:\Users\cyhin\piact`.

## Kiến trúc và Stack chốt triển khai

- **Desktop Runtime:** Electron (x64 Windows), `contextIsolation: true`, `nodeIntegration: false`, cầu nối `preload` hẹp có kiểu TypeScript.
- **UI Framework:** React + TypeScript (`strict: true`) + Vite (`electron-vite`), Zustand quản lý state UI, Lucide icons, hệ thống design token tối màu (`#171A1F`, `#22262D`, `#82D9B5`, Inter 14 px, lưới 8 px).
- **Lõi nghiệp vụ (`domain/`):** TypeScript thuần + Zod xác thực schema lúc chạy, `ParameterResolver` song ngữ VI/EN, `WorkflowPlan` DAG validator, bộ quy đổi tọa độ/pivot/9-slice/timing sang Unity, bộ kiểm tra tĩnh hội thoại/nhiệm vụ, `Redactor` ẩn bí mật.
- **Lưu trữ & CSDL:** SQLite (`PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, migration theo `PRAGMA user_version` kèm auto-backup) + kho ảnh content-addressed PNG `blobs/<aa>/<sha256>.png` ghi nguyên tử qua `staging/`.
- **Xử lý ảnh pixel art:** `pngjs` (thuần JS/TS, 100% tương thích đóng gói Windows, chạy trên Worker Thread) cho tách nền alpha/defringe, nearest-neighbor/mode-sampling, CIELAB/Euclidean palette quantization + dithering, ghép mask bảo toàn byte ngoài mask, chia lưới sprite sheet và đóng gói atlas có padding/extrusion.
- **AI Provider (BYOK):** Lớp `ProviderAdapter` chuẩn hóa với **OpenAI** mặc định (Responses/Chat Structured Outputs + Images generate/edit) và `MockTestAdapter` xác định (gắn nhãn rõ cho kiểm thử tự động & demo ngoại tuyến). Khóa API lưu bảo mật qua Electron `safeStorage` (Windows DPAPI).
- **Tích hợp Unity:** Ghim phiên bản **Unity 6000.6.7f1** (Unity 6 có sẵn trên máy kiểm thử). Gói UPM `unity-importer/` (`Editor/`, `Runtime/`, `Tests/Editor/`) hỗ trợ nhập trọn gói + tái nhập giữ GUID (`AIPixelStudioImportMap`) và kiểm thử EditMode thật bằng Unity batchmode.

## Lộ trình 6 cột mốc (120 tính năng `F001–F120` & 12 bài nghiệm thu `A01–A12`)

1. **Mốc 1 (21 tính năng):** Khung Electron/React/SQLite/IPC bảo mật, quản lý dự án/sao lưu/khôi phục, dự án mẫu “Xưởng mộc”, palette/preset/ảnh tham chiếu, nhập PNG, workspace 3 cột với trình biên tập pixel nhiều lớp + công cụ vẽ/chọn/cắt/pivot, thư viện tìm lọc/thư mục/duyệt/khôi phục/thùng rác.
2. **Mốc 2 (26 tính năng):** `safeStorage` + `Redactor`, `ProviderAdapter` (OpenAI + Mock), kiểm tra kết nối & năng lực model, form Prompt + tùy chọn thống nhất (`ParameterResolver`, chặn xung đột `A02`, nguồn thông số, `@mention`, mẫu prompt, chạy lại snapshot), hàng đợi cơ bản, sổ sử dụng, tạo sprite/phương án, tách nền alpha, ánh xạ palette, so sánh revision, QC sprite & xuất PNG.
3. **Mốc 3 (30 tính năng):** Kế hoạch nhiều đầu ra DAG + bản xem trước chỉnh được, lệnh prompt cục bộ `0` lượt gọi ảnh (`A05`), hoàn tác/làm lại giao dịch, retry bước lỗi + khôi phục checkpoint + phát hiện stale-base (`A08`), nhân vật đa hướng/trang phục/chân dung, mask inpainting (`A04`), trọn bộ Animation (`F046–F063`, `A03`), QC animation & xuất sprite sheet.
4. **Mốc 4 (36 tính năng):** Vật phẩm, nội thất có footprint/trạng thái/icon/điểm gắn, tái sử dụng & nhân bản, Tileset 3×3 & auto-tile, Bản đồ nhiều lớp + footprint + va chạm + spawn/door/trigger + chơi thử Y-sort (`A06`), UI 9-slice/layout/3 trạng thái/icon, VFX overlay, Storyboard/Cutscene, Hội thoại/Nhiệm vụ/Mô phỏng nhánh (`A07`) & Bảng chỉ số.
5. **Mốc 5 (7 tính năng):** Kiểm tra liên kết tổng thể, đóng gói atlas có padding, chọn phạm vi xuất kéo theo phụ thuộc, manifest + SHA-256 staging, gói UPM `unity-importer/` (nhập + tái nhập giữ GUID + idempotent `A09`/`A10`), đóng gói Windows x64 (`A01`).
6. **Mốc 6 (Chốt bản phát hành):** Chạy toàn bộ Unit, Integration, Electron E2E, Performance SLA, Unity Editor Batchmode tests; hoàn thiện `README.md` tiếng Việt và `DELIVERY_REPORT.md` kèm ma trận đủ `F001–F120` và `A01–A12`.
