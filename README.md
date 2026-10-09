# MTL Prototype Demo — Hệ thống Lập và Theo dõi Master Timeline

> **Đây là PROTOTYPE để demo**, dựng theo BRD *"1. GMS.BRD - Hệ Thống Lập và Theo dõi MTL - 01102026"* và template *"2. TIEN DO & CAU TRUC DATA_01102026.xlsx"*.
> Không phải bản sản xuất: dữ liệu lưu bằng file JSON, đăng nhập mô phỏng, tích hợp ngoài là mock. Đội phát triển bản thật nên dùng tài liệu này làm đặc tả tham chiếu hành vi, **không tái sử dụng nguyên code**.
> Dự án `Project MTL` có sẵn (Vinext/Vite) **không bị chạm tới** — đây là thư mục độc lập.

## Chạy

Yêu cầu Node.js ≥ 20.

```bash
npm install
npm run dev          # http://localhost:3100  (hoặc: npm run build && npm start)
npm test             # 17 test động cơ (lọc, nhân bản, công thức, lịch, mốc, hiệu năng)
node scripts/e2e.mjs # 42 kiểm tra luồng nghiệp vụ qua API (cần server đang chạy)
```

Dữ liệu mẫu tự sinh ở lần chạy đầu (`.data/db.json`). Muốn về trạng thái ban đầu: **Cài đặt Hệ thống → Đặt lại dữ liệu demo**, hoặc xóa thư mục `.data`.

## Kịch bản demo gợi ý (≈ 10 phút)

1. **Trang chủ** — Dashboard: KPI, Kế hoạch vs Thực tế theo Ban, tiến độ theo phân khu, hiệu suất theo chức danh, cảnh báo chậm. Chuyển dự án ở ô chọn.
2. **Lập Master Timeline → Tạo MTL mới** — Bước 1: chọn từ *Danh mục Dự án lõi* (mock) để điền sẵn 10 trường mỏ neo; thử bấm *Tiếp theo* khi để trống để thấy validate.
3. Bước 2: đổi loại hình (Cao tầng ↔ Thấp tầng) → form đổi theo. Nhập tham số, bấm **Tính mốc khả thi** → **Áp dụng 4 mốc** → **Khởi tạo & tự sinh tiến độ**.
4. **Báo cáo động cơ** hiện ra: bao nhiêu task bị lọc và vì sao, bao nhiêu dòng được nhân bản. *(Thử lại với hầm = 0, hoặc 4 tháp, hoặc 3 phân kỳ để thấy khác biệt.)*
5. **Workspace** — lưới WBS + Gantt: thu/mở nhánh, lọc *Đường găng* / *Cảnh báo*, đổi **Trạng thái** (Đóng / Đang thực hiện / Hoàn thành), gán **Chức danh**, sửa **Số ngày** → toàn bộ lịch tự tính lại. Bấm 1 dòng để xem tiền nhiệm/kế tiếp, float, cách tính thời lượng.
6. **Trình E-Approval** (mô phỏng) → bản bị khóa → **BOD phê duyệt** → thành *Baseline v1.0* → **Tạo REV mới**. Xuất **MS Project XML**, **Excel**, **Tờ trình / PDF**.
7. **Theo dõi Dự án** (chọn dự án AQC đã duyệt) — mở 1 việc: kéo % , đính kèm minh chứng (100% bắt buộc có minh chứng), trao đổi, chấm chất lượng. Tab *Đánh giá theo chức danh* (chỉnh trọng số).
8. **Đổi vai trò** (góc phải trên) sang *View* / *Quản trị dự án* để thấy phân quyền; **Template & Định mức** và **Cài đặt** để cấu hình.

## Ánh xạ BRD → code

| BRD | Nội dung | Nơi cài đặt |
|---|---|---|
| 2.2 | Bố cục 3 khu vực, bám layout `gmsp-dev.novagroup.vn` | `components/Shell.tsx`, `tailwind.config.ts` (token màu/kích thước lấy từ site thật) |
| 3.1 | Form 2 bước, 10 trường mỏ neo, form động | `app/mtl/new/page.tsx`, `lib/validate.ts` |
| 3.2.1 | Lọc task (hầm = 0, thấp tầng, hồ bơi, hạng mục…) | `lib/engine/generate.ts` (`dropRule`) |
| 3.2.2 | Nhân bản tháp (SS + 15) / phân kỳ | `lib/engine/generate.ts` (`branches`, stagger) |
| 3.2.3 | Tính thời lượng & lịch xuôi/ngược | `lib/engine/generate.ts` (`computeDuration`), `lib/engine/schedule.ts`, `lib/engine/calendar.ts` |
| 3.3 | Dashboard, danh sách MTL | `app/page.tsx`, `app/mtl/page.tsx`, `lib/metrics.ts` |
| 3.4 | Tracking %, minh chứng, comment, theo chức danh | `app/tracking/page.tsx`, `app/api/tracking/**` |
| 3.5 | Template chuẩn, định mức (6 ngày/sàn…) | `app/templates/page.tsx`, `lib/engine/config.ts` |
| 3.6 | Phân quyền 4 vai trò | `lib/auth.ts`, `app/settings/page.tsx` |
| 4.2 | E-Approval | **Mô phỏng** trong `app/api/versions/[vid]/action/route.ts` |
| 4.3 | Xuất XML MS Project / Excel / PDF | `lib/export.ts`, `app/mtl/[pid]/to-trinh/page.tsx` (PDF = in từ trình duyệt) |

Dữ liệu template: `data/wbs-template.json` (1.088 task) sinh bằng `scripts/build-template.py` từ sheet **1.Duration & He so**, sau đó nhánh 5 (Ban Cung ứng Đấu thầu) và nhánh 6 (Phòng Khối lượng và Ngân sách) được cập nhật theo file mpp *NVLG-PMD-SOP06.F01 MAU LAP MTL (CAP NHAT) - 7.10.2026* bằng `scripts/update-template-5-6.py`.

**Giả định cho tác vụ mới (mpp 7.10.2026 chỉ có cấu trúc, mọi tác vụ 1 ngày, không có liên kết):** mỗi gói thầu/nhà cung cấp có 3 bước nối tiếp — Chọn thầu và phát hành LOA 30 ngày, Hoàn thành hợp đồng 10 ngày, Hoàn thành tạm ứng 7 ngày; Lập kế hoạch CUDT 30 ngày; QSB: dự toán 10 ngày → ngân sách thực thi 15 ngày → BOQ gói A/B 10 ngày. Gói có chữ “nhà thấp tầng/cao tầng” chỉ áp dụng cho loại hình tương ứng. Cần PMO cung cấp thời lượng và liên kết thật.

## Quy tắc nghiệp vụ động cơ đã cài

- **Lọc:** cao tầng bỏ nhánh 13.7 (thấp tầng) và ngược lại; hầm = 0 bỏ nhánh tường vây/shoring/đào hầm; hầm < 2 bỏ quan trắc sâu & hạ mực nước; không hồ bơi bỏ nhánh hồ bơi; không Clubhouse / không công viên bỏ nhánh tiện ích / cảnh quan; hạng mục bỏ chọn (cột Q–AA) thì bỏ các việc gắn với hạng mục.
- **Task bị loại giữa chuỗi** được "nối cầu": việc sau tự nối vào tiền nhiệm của việc đã loại.
- **Thời lượng:** `định mức × hệ số ngưỡng` (cột AO–AS cao tầng, AD–AI thấp tầng; ô trống = 1). Đặc biệt: *thân = số tầng nổi × ngày/sàn*; *phần ngầm = định mức × hầm / hầm chuẩn*; gói TKCS/PCCC/bóc tách nhân thêm hệ số GFA (chặn 0,8–1,5).
- **Lịch:** tính theo ngày làm việc (6 ngày/tuần mặc định, trừ ngày lễ). Mốc cố định T0 / Khởi công / Mở bán / Bàn giao / Kết thúc. Chuỗi pháp lý–thiết kế–đấu thầu cổng Khởi công và chuỗi nghiệm thu cổng Bàn giao được **đặt lùi sát hạn (ALAP)**; việc thi công không bắt đầu trước Khởi công; việc mở bán không trước Mở bán; việc vận hành (OM) diễn ra sau Bàn giao và không kéo dài ngày kết thúc dự án.
- **Mốc xung đột** được báo (không im lặng): hạn chót không kịp, móng chưa xong trước ngày mở bán… *Tính mốc khả thi* giúp chọn mốc không xung đột.

## Giả định đã đưa ra (cần PMO / BA xác nhận)

| # | Giả định | Lý do |
|---|---|---|
| 1 | Cột *Base Duration (Ngày)* trong Excel là **ngày làm việc** | 160 ≈ 25 tầng × 6 ngày/sàn |
| 2 | Định mức phần ngầm hiệu chỉnh cho **2 hầm** | BRD ghi mặc định 2 hầm |
| 3 | So le giữa các phân kỳ = **60 ngày** | BRD chưa quy định |
| 4 | **Phức hợp thương mại** dùng định mức cao tầng | Template chưa điền cột *Công trình hỗn hợp* |
| 5 | **7 tác vụ tầng hầm là MINH HỌA** (tường vây Barrette, Kingpost, đào hầm, Shoring, chống thấm ngược, quan trắc sâu, bơm hạ mực nước) | BRD nói "45 tác vụ" nhưng template Excel chỉ có ~2 việc liên quan hầm; gắn nhãn `demo` trên UI |
| 6 | Cột *Ngày dự phòng* (J) **không** cộng vào thời lượng (có công tắc) | Chưa rõ ngữ nghĩa |
| 7 | **Đường găng** = chuỗi có float nhỏ nhất; việc định kỳ & vận hành không tính | Hạn chót dự án rộng nên float tuyệt đối luôn dương |
| 8 | Xếp loại chức danh: ≥90 Xuất sắc / ≥75 Tốt / ≥60 Đạt; trọng số 50/30/20 | BRD 3.4 nói có tiêu chí & trọng số nhưng chưa nêu giá trị |
| 9 | Ngày lễ & tuần 6 ngày | Cần HR xác nhận lịch chính thức |

## Điểm BRD cần làm rõ (phát hiện khi cài đặt)

- **BRD 3.2 mục "3. Thuật toán tính toán thời lượng" để trống** — đã cài theo gợi ý ở 3.1 và 3.5.
- Công thức ghi "Số tầng nổi × **xx** ngày/sàn" ở 3.1 nhưng 3.5 nói mặc định **6** — đã dùng 6 (cấu hình được).
- Bảng thấp tầng: dòng *Số lượng căn thấp tầng* chưa có quy tắc tác động.
- Template còn cột **Khách sạn**, **Công viên chủ đề** mà BRD chưa đề cập loại hình tương ứng.
- Khoảng 260 task trong template có phân loại công việc nhưng không được đánh dấu *Công việc áp dụng* ở loại hình nào — hiện bị coi là không áp dụng (báo cáo động cơ ghi rõ số lượng).

## Ba chức năng bổ sung cho đủ bộ menu PMD

| Chức năng | Màn hình / API | Ghi chú |
|---|---|---|
| Thông tin dự án | `/projects`, `PATCH /api/projects/[id]` | Danh sách theo phạm vi vai trò; sửa tên, chủ đầu tư, 5 mốc neo, hồ sơ bổ sung. Mã/loại hình/vùng khóa. Đổi mốc neo không tự sửa MTL (cần REV mới). |
| Lập nhiệm vụ thiết kế | `/design-tasks`, `/api/design-briefs` | **GIẢ ĐỊNH** (BRD không có đặc tả): căn cứ node 4.0.3.1 + nhánh DMD 12.x. Khởi tạo bộ nhiệm vụ theo loại hình, soạn → ban hành → DMD xác nhận → mở lại. |
| Lập FS-ver2 (FS thực thi) | `/fs`, `/api/fs` | **GIẢ ĐỊNH** (BRD không có đặc tả): căn cứ node 4.0.2.1. Suất đầu tư × quy mô, phân bổ theo tháng theo mốc dự án, chốt rồi chuyển FPA (Capex) mô phỏng. Suất đầu tư là số minh họa. |

Quyền mới: `design.edit`, `fs.edit`, `fs.approve` (PM: soạn; Quản trị vùng/Admin: chốt FS). Cần xác nhận lại nghiệp vụ thật với PMD trước khi dev.

## Chưa làm (ngoài phạm vi prototype)

tích hợp phần mềm theo dõi phòng ban (BRD 4.1); chữ ký số; kết xuất PDF phía server; kéo-thả sửa liên kết trên Gantt; so sánh Baseline với REV; đăng nhập/SSO thật; database & migration; kiểm thử trình duyệt tự động.

## Cấu trúc thư mục

```
app/            giao diện (Next.js App Router) + app/api/** (route handler)
components/     Shell (layout 3 khu vực), WbsGantt (Tree Grid + Gantt), charts, ui
lib/engine/     calendar · schedule (forward/backward) · generate (lọc/nhân bản/thời lượng) · template · config
lib/            types (schema), validate, auth, metrics, export
lib/store/      kho dữ liệu JSON
lib/seed/       dữ liệu mẫu (3 dự án: AQC đã duyệt, GMH bản thảo, NWP đang trình)
data/           wbs-template.json (sinh từ Excel)
scripts/        build-template.py, e2e.mjs
tests/          engine.test.ts
```

## Triển khai Cloudflare Workers

Repo chạy trên Vinext + Cloudflare Workers (`wrangler.json`, `worker/index.ts`): `npm run build` rồi `npx wrangler deploy`.
Trên Workers không có ổ đĩa bền vững nên dữ liệu demo (và tệp minh chứng) chỉ nằm trong bộ nhớ của Worker và trở về dữ liệu mẫu khi Worker khởi động lại; chạy trên máy (`npm run dev` / `run-demo.bat`) thì lưu ở `.data/`. `lib/drain.ts` đọc hết body của các yêu cầu ghi để tránh lỗi 503 của workerd khi trả lời sớm. Kiểm thử: `npm test` (19) và `BASE=<url> node scripts/e2e.mjs` (70).
