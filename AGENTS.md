# AI Pixel Studio (`piart`) — Repository & Engineering Rules

## 1. Kiến trúc & ranh giới module
- `domain/`: Chỉ chứa kiểu dữ liệu thuần, Zod schema, bộ phân giải tham số (`ParameterResolver`), validator và toán học Unity. Không import Electron, Node `fs`, hay DOM.
- `app/main/`: Quản lý cửa sổ Electron, SQLite WAL (`ProjectStore`), hàng đợi job, worker xử lý ảnh (`pngjs`), xuất gói Unity và mã hóa bí mật (`safeStorage`).
- `app/preload/`: Chỉ phơi bày hợp đồng IPC phạm vi hẹp qua `window.pixelStudio`. Luôn giữ `contextIsolation: true` và `nodeIntegration: false`.
- `app/renderer/`: Giao diện React + Zustand. Mọi thay đổi UI phải tương thích ngược với dữ liệu SQLite, phím tắt, thao tác vẽ, luồng AI, timeline và xuất Unity.
- `mcp/`: MCP Server chuẩn stdio (`out/mcp/index.mjs`) bọc `StudioService` để kết nối vào Codex; tuyệt đối không ghi log ra `stdout` (chỉ dùng `stderr`).
- `unity-importer/`: Gói UPM C# cho Unity (`6000.6.7f1`).

## 2. Quy chuẩn Giao diện (UI/UX & Theme)
- **Bảng màu xám than ấm & hổ phách** (quản lý tập trung tại `app/renderer/src/styles/tokens.css`):
  - Nền ứng dụng `--bg-app`: `#181816`
  - Bề mặt panel `--bg-panel`: `#20201D`
  - Giếng bao quanh canvas `--bg-canvas-well`: `#121311`
  - Đường phân vùng `--border-divider`: `#35342E`
  - Chữ chính / phụ: `#F0EDE5` / `#B1ADA2`
  - Màu nhấn hổ phách `--accent` / chữ `--accent-ink`: `#F1BE6B` / `#21170A`
- **Kỷ luật thị giác:**
  - Bề mặt phẳng, đường phân vùng mảnh `1px`, bo góc `4–6 px`, lưới khoảng cách `4 / 8 / 12 / 16 px`. Không thêm gradient trang trí, glow phát sáng, `backdrop-filter` đè lên canvas hoặc huy hiệu dư thừa.
  - Chỉ dùng màu hổ phách đặc cho **một hành động chính** ở trạng thái hiện tại và dấu nhỏ (`2px`) cho asset, clip, công cụ, mức zoom hoặc frame đang chọn.
  - Dùng `tabular-nums` (`.mono` / `.tabular`) cho kích thước, zoom, tọa độ, FPS và thời lượng `ms`.
  - Mọi thay đổi giao diện cần kiểm tra thực tế ở `1440 × 900` và cửa sổ hẹp tối thiểu `1280 × 720`.

## 3. Bảo mật & Dữ liệu
- Không bao giờ commit API key, `.env`, bản sao lưu dự án người dùng hoặc dữ liệu nhạy cảm.
- Giữ nguyên toàn bộ `data-testid` hiện có để bảo đảm bộ kiểm thử E2E Playwright không bị gãy.

## 4. Kiểm chứng bắt buộc trước khi commit / mở PR
```powershell
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
# Khi thay đổi UI hoặc luồng tương tác Electron:
npm run test:e2e
```
