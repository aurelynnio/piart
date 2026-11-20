# AI Pixel Studio

Ứng dụng desktop cho **Windows x64** giúp cá nhân và nhóm indie sản xuất trọn gói tài nguyên game **2D pixel art** bằng **prompt tiếng Việt hoặc tiếng Anh kết hợp các tùy chọn có cấu trúc trên cùng một biểu mẫu**, lưu trữ cục bộ không phá hủy theo lịch sử phiên bản (revision) và xuất gói có manifest kiểm chứng để nhập/tái nhập an toàn vào **Unity**.

## 1. Kiến trúc và cấu trúc thư mục

```text
app/
  main/
    index.ts          Khởi tạo cửa sổ Electron, bảo mật preload, vòng đời ứng dụng
    ipc/              StudioService và IPC handlers xác thực tham số bằng Zod
    db/               SQLite driver (node:sqlite WAL / sql.js fallback), migrations, ProjectStore
    queue/            Hàng đợi job bền vững, checkpoint, retry, idempotency, concurrency
    providers/        ProviderAdapter (OpenAI mặc định, MockTestAdapter kiểm thử xác định)
    imaging/          Pixel engine (pngjs) và Worker Thread (alpha, palette, mask, slicer, atlas)
    exporter/         Preflight validator, staging exporter, manifest.json & SHA-256 checksum
    security/         SecretStore (Electron safeStorage / Windows DPAPI) & PathGuard
  preload/            Hợp đồng IPC phạm vi hẹp phơi bày window.pixelStudio (contextIsolation: true)
  renderer/           Workspace 3 cột xám than ấm & hổ phách (#181816 / #20201D / #121311 / #F1BE6B, Inter, lưới 4/8/12/16 px)
domain/               Kiểu dữ liệu thuần, Zod schema, ParameterResolver, DAG validator, Unity math, Redactor
mcp/                  MCP Server chuẩn stdio (57 tools, 12 resources, 5 prompts) để kết nối tự động hóa vào Codex
unity-importer/       Gói UPM Editor & Runtime C# (ghim Unity 6000.6.7f1) kèm bộ kiểm thử EditMode
examples/workshop/    Dự án mẫu nguyên gốc “Xưởng mộc” (mở thành bản sao làm việc độc lập)
examples/workshop-export/  Gói xuất Unity mẫu đã kiểm chứng đầy đủ manifest & SHA-256
tests/                Unit (domain), Integration (A01–A12 & Perf), E2E (Playwright Electron), Smoke (Real API)
```

## 2. Yêu cầu môi trường đã kiểm chứng

- **Hệ điều hành:** Windows 10/11 x64
- **Node.js:** `v25.2.0` (tương thích Node 22+ LTS)
- **Electron:** `35.1.5` (`contextIsolation: true`, `nodeIntegration: false`)
- **Unity Editor đã ghim:** `6000.6.7f1` (hỗ trợ `com.unity.2d.sprite`, `com.unity.2d.tilemap`)

## 3. Lệnh phát triển, đóng gói và kiểm thử

```powershell
# Cài đặt phụ thuộc
npm install

# Khởi chạy chế độ phát triển (Electron + Vite HMR)
npm run dev

# Kiểm tra kiểu TypeScript & build production
npm run typecheck
npm run build

# Tái tạo dự án mẫu Xưởng mộc và gói xuất mẫu
npm run seed:workshop

# Chạy bộ kiểm thử đơn vị (domain)
npm run test:unit

# Chạy bộ kiểm thử tích hợp (A01–A08, A11–A12 & Hiệu năng)
npm run test:integration

# Chạy kiểm thử UI đầu cuối trên Electron thật (Playwright)
npm run test:e2e

# Chạy smoke test với OpenAI API thật (yêu cầu OPENAI_API_KEY)
$env:OPENAI_API_KEY = "sk-..."
npm run test:smoke:real-api

# Đóng gói bộ cài Windows x64 (.exe NSIS vào thư mục release/)
npm run package:win
```

## 4. Hướng dẫn sử dụng nhanh

### 4.1. Khởi đầu với dự án mẫu hoặc dự án mới
- Ở **Màn hình dự án (Project Hub)**, nhấn **Mở dự án mẫu** để sao chép dự án mẫu **“Xưởng mộc”** sang thư mục làm việc độc lập (không làm thay đổi bản gốc).
- Hoặc nhập tên dự án và chọn thư mục lưu bất kỳ (hỗ trợ đầy đủ đường dẫn Windows có dấu tiếng Việt và khoảng trắng) rồi nhấn **Tạo & mở dự án**.

### 4.2. Thiết lập Provider & API Key an toàn
- Mở **Cài đặt (biểu tượng bánh răng)** ở thanh trên → chọn **OpenAI (API thật)** hoặc **MockTestAdapter (Kiểm thử cục bộ)**.
- Nhập OpenAI API key và nhấn **Lưu an toàn**. Key được mã hóa bằng Windows DPAPI (`safeStorage`) ở main process; giao diện chỉ hiển thị dạng che (`sk-••••••XXXX`). Nhấn **Kiểm tra kết nối & năng lực** để xác minh quyền model.
- Bật **Ngoại tuyến** ở thanh trên khi làm việc không có mạng: toàn bộ chức năng vẽ pixel, timeline, dựng bản đồ, mô phỏng hội thoại, duyệt revision và xuất Unity vẫn hoạt động đầy đủ.

### 4.3. Tạo & sửa tài nguyên bằng Prompt + Tùy chọn
- Ở panel phải, chọn tab **Tạo mới** hoặc **Sửa mục tiêu**.
- Nhập prompt tiếng Việt hoặc tiếng Anh (ví dụ: *“Tạo thợ mộc đeo tạp dề nâu. Cho nhân vật đi bộ, bước chân chắc và nhịp đều.”*).
- Nếu trường thông số trên form được đánh dấu **Đã chọn** nhưng mâu thuẫn với prompt (ví dụ form chọn `32 × 32` còn prompt viết `64 × 64`), ứng dụng chặn gọi ảnh (`0` lượt gọi) và hiện 2 nút để bạn chốt trước khi chạy.
- Các lệnh thuần dữ liệu như *“Cho clip đi trái chậm hơn 20%.”* chạy cục bộ tức thời (`0` lượt gọi ảnh, hệ số `0,8×`, thời lượng tăng `25%`) và hỗ trợ `Ctrl+Z` / `Ctrl+Y`.

### 4.4. Chỉnh sửa 1 frame bằng Mask
- Chọn một clip ở thư viện trái → bấm chọn đúng ô frame cần sửa ở **Timeline** dưới canvas.
- Chọn công cụ **Mask (`K`)** trên thanh công cụ canvas, khoanh vùng cần sửa (ví dụ cánh tay cầm búa).
- Chuyển sang tab **Sửa mục tiêu**, nhập mô tả (ví dụ *“Chỉnh tay cầm búa thấp xuống.”*) và nhấn **Áp dụng sửa**. Hệ thống chỉ ghép pixel bên trong mask và giữ nguyên 100% hash của mọi frame khác.

### 4.5. Khôi phục tác vụ khi gián đoạn
- Mở **Hàng đợi** trên thanh trên để xem cây `Job → Step → Output`, hủy tác vụ đang chạy, nhấn **Thử lại bước lỗi** (không chạy lại bước đã thành công) hoặc **Tiếp tục từ checkpoint** sau khi mở lại ứng dụng.
- Nhấn **Tạo báo cáo chẩn đoán đã lọc bí mật** để xuất báo cáo gỡ lỗi đã loại bỏ 100% API key và tên người dùng Windows.

### 4.6. Xuất và nhập / tái nhập vào Unity
1. Nhấn **Xuất sang Unity** ở thanh trên → chọn phạm vi (*Toàn bộ dự án*, *Scene* hoặc *Asset*), đặt padding atlas (≥ 2 px), chạy **Kiểm tra tiền xuất** và nhấn **Xuất gói Unity ngay**.
2. Trong Unity Editor (`6000.6.7f1`), mở **Window → Package Manager → + → Add package from disk...** và chọn `unity-importer/package.json`.
3. Vào menu **Tools → AI Pixel Studio → Import Package...**, chọn thư mục chứa `manifest.json` và thư mục đích bên trong `Assets/` (ví dụ `Assets/ImportedPixelStudio/Workshop`), rồi nhấn **Nhập / Cập nhật gói vào Unity**.
4. Mở `VerificationScene.unity` trong thư mục đích để kiểm tra sprite lọc `Point`, chuyển hướng/phát clip và đọc nhiệm vụ–hội thoại.
5. Khi sửa frame ở AI Pixel Studio, xuất lại và nhập vào **đúng thư mục Unity cũ**: importer đối chiếu `AIPixelStudioImportMap.json` theo `stableId`, giữ nguyên GUID và toàn bộ tham chiếu Prefab/Scene/Animator.

## 5. Chính sách lưu trữ dữ liệu và bảo mật

- Mỗi dự án là một thư mục tự chứa: `project.json`, `studio.sqlite` (WAL + `PRAGMA foreign_keys = ON`, migration tự động có sao lưu vào `backups/`), kho ảnh bất biến `blobs/<aa>/<sha256>.png`, `imports/`, `staging/` và `exports/`.
- API key **không bao giờ** được lưu trong thư mục dự án, log chẩn đoán, bản sao lưu ZIP hay gói xuất Unity.
