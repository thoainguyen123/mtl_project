# MTL Workspace — Prototype bước 5

Prototype web phục vụ bước 5 của quy trình lập Master Timeline (MTL): PMD tổng hợp dữ liệu, lập MTL và chia sẻ cho PBCM góp ý.

## Chức năng mô phỏng

- Tree Grid WBS kết hợp biểu đồ Gantt.
- Thu gọn/mở rộng nhóm công việc, tìm kiếm và đổi chế độ xem.
- Thêm công việc, milestone và chỉnh sửa thông tin công việc.
- Mô phỏng import Excel/MS Project và đối chiếu dữ liệu.
- Validation lỗi/cảnh báo trước khi chuyển bước 6.
- Tạo snapshot chia sẻ PBCM.
- Chấp nhận hoặc từ chối góp ý của PBCM.

Hiện dữ liệu nằm trong `app/page.tsx`, chưa kết nối database và thao tác import chỉ là mô phỏng giao diện.

## Công nghệ

- React 19, TypeScript.
- Next.js-compatible App Router chạy qua Vinext/Vite.
- CSS thuần trong `app/globals.css`.

## Chạy local

Yêu cầu Node.js 22 trở lên.

```bash
npm install
npm run dev
```

Sau đó mở địa chỉ được hiển thị trong terminal.

## Các file chính

- `app/page.tsx`: giao diện, dữ liệu mẫu và toàn bộ tương tác prototype.
- `app/globals.css`: thiết kế giao diện desktop.
- `app/layout.tsx`: metadata và font tiếng Việt.

## Hướng phát triển thành MVP

1. Tách component Tree Grid, Gantt, Validation và Feedback.
2. Bổ sung API/backend và database PostgreSQL.
3. Đọc Excel bằng SheetJS; chuyển đổi `.mpp` qua dịch vụ trung gian hoặc MPXJ.
4. Thêm xác thực, phân quyền PMD/PBCM và lịch sử phiên bản.
5. Xây thuật toán dependency, lịch làm việc và critical path.
