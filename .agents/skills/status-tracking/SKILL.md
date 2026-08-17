---
name: status-tracking
description: Use when tracking task completion, identifying blockers, scanning project resource files (markdown, CSV/JSON, git commits), and comparing actual progress against scheduled baselines.
---

# Status Tracking — Skill Cập Nhật & Đồng Bộ Trạng Thái Tiến Độ

## Overview
Skill này thiết lập các quy tắc thu thập, tính toán % hoàn thành, đối chiếu tiến độ thực tế với kế hoạch (baseline), và tự động phát hiện các điểm nghẽn (blockers) bằng cách quét các tài nguyên hiện có trong workspace dự án (`git log`, file `.md`, file cấu hình, log thực thi test).

---

## 🔍 Nguồn Quét Tiến Độ Tự Động

AI phải chủ động quét các nguồn tài nguyên sau để thu thập chứng cứ tiến độ thực tế:
1. **Lịch sử Git Commit (`git log`)**: Kiểm tra các commit gần nhất, message commit có chứa mã WBS hoặc tên Task không.
2. **File Tài Nguyên & Tài Liệu Workspace**: Đọc các file `TASK.md`, `WALKTHROUGH.md`, `README.md`, hoặc JSON/CSV theo dõi tiến độ.
3. **Kết Quả Log Verification**: Đọc log chạy test runner (`npm test`, `pytest`, log ứng dụng) để xác nhận công việc đã qua kiểm thử chưa.

---

## 📊 Quy Tắc Tính Tỷ Lệ Hoàn Thành (% Progress)

| % Hoàn Thành | Trạng Thái (Status) | Tiêu Chí Xác Định |
|--------------|----------------------|-------------------|
| **0%**       | `Not Started`        | Chưa có commit, chưa tạo file hoặc chưa có hành động triển khai. |
| **25%**      | `In Progress`        | Đã có bản thảo thiết kế hoặc skeleton code ban đầu. |
| **50%**      | `In Progress`        | Code logic cốt lõi đã xong, đang viết hoặc chuẩn bị kiểm thử. |
| **75%**      | `Review / Verification` | Đã xong code & test, đang chạy verification hoặc chờ review. |
| **100%**     | `Completed`          | Đã có bằng chứng verification pass hoàn toàn, code đã merge/commit thành công. |

---

## 🚧 Phân Loại & Xử Lý Điểm Nghẽn (Blockers)

Khi quét tiến độ, nếu phát hiện bất kỳ dấu hiệu nào sau đây, task phải lập tức bị gắn trạng thái **BLOCKED**:

1. **Dependency Blocker**: Task tiền đề (Predecessor) chưa hoàn thành (chưa đạt 100%).
2. **Technical Blocker**: Lệnh build/test bị lỗi runtime hoặc không pass assertion.
3. **Resource / Decision Blocker**: Đang chờ thông tin bổ sung hoặc quyết định từ phía người dùng (User Feedback).

### Mẫu Thống Kê Blocker:
```markdown
### 🛑 Danh Sách Điểm Nghẽn (Active Blockers)
- **Task ID**: `WBS-3.1.2`
- **Tên Task**: Triển khai API Authentication
- **Loại Blocker**: Technical / Test Failure
- **Chi tiết**: Test case `auth.test.ts` lỗi 401 Unauthorized khi verify JWT signature.
- **Hành động đề xuất**: Kiểm tra lại secret key trong file `.env.test`.
```
