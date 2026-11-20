## Tóm tắt thay đổi
- 

## Loại thay đổi
- [ ] Tính năng mới (feature)
- [ ] Sửa lỗi (bugfix)
- [ ] Tinh chỉnh UI/UX
- [ ] Cải tiến cấu trúc / tài liệu (refactor / docs)

## Danh sách kiểm tra trước khi merge
- [ ] `npm run typecheck` đạt (0 lỗi TypeScript)
- [ ] `npm run test:unit` và `npm run test:integration` đạt
- [ ] `npm run build` đóng gói thành công
- [ ] Nếu có chỉnh sửa giao diện: đã kiểm tra thực tế ở `1440 × 900` và `1280 × 720`, không vỡ layout hoặc che khuất canvas
- [ ] Không làm thay đổi/xóa các `data-testid` đang được Playwright E2E sử dụng
- [ ] Không chứa API key, token hoặc dữ liệu nhạy cảm cục bộ
