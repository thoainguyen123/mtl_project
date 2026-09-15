# WBS: Bộ tham số hình thành tiến độ dự án

> Trạng thái: ✅ Đã triển khai và kiểm thử sau khi người dùng phê duyệt kế hoạch.

> Điều chỉnh đã duyệt ngày 2026-09-15: bỏ Biện pháp đào, Mô hình triển khai thầu và Mô hình Nhà mẫu khỏi màn hình khởi tạo; nhà thấp tầng dùng Số căn thay cho Số tầng hầm/Số tầng nổi.

## Phạm vi và quyết định thiết kế

- Nâng modal khởi tạo MTL thành quy trình 3 bước: Thông tin dự án → Tham số theo loại hình → Xem trước tác động và tạo MTL.
- Lưu toàn bộ tham số vào từng dự án để có thể xem lại nguồn hình thành tiến độ.
- Sinh cây bằng rule engine thuần, có kết quả ổn định với cùng một bộ đầu vào.
- Dùng mã WBS thật của thư viện hiện tại. Nhánh GPMB dùng `9.9`; nhánh cao tầng dùng `4.3.8.1`.
- Bổ sung task sinh động cho tầng hầm, nghĩa vụ tài chính và nhà mẫu vì thư viện hiện tại chưa có đủ các task này.
- Giữ khả năng nhập XML. Khi có XML, hệ thống lưu các tham số làm metadata nhưng không tự viết lại cây công việc từ tệp.

## Group 1.0: Mô hình dữ liệu và tương thích dự án cũ

- 🚩 **Milestone 1.1**: Chốt schema tham số
  - 🔲 **Task 1.1.1**: Tạo kiểu `ProjectParameters` với các mã tham số đang áp dụng
    - PIC: Frontend | Duration: 0.5 ngày | Dependencies: []
    - Criteria: Kiểu dữ liệu khớp danh sách/list/integer/number trong yêu cầu; mọi tham số có giá trị mặc định hợp lệ.
  - 🔲 **Task 1.1.2**: Gắn `parameters` và nhật ký tác động vào `Project`
    - PIC: Frontend | Duration: 0.5 ngày | Dependencies: [Task 1.1.1 FS]
    - Criteria: Dự án mới lưu đủ tham số; dự án localStorage cũ được migrate bằng mặc định và vẫn mở được.

## Group 2.0: Giao diện khai báo và xem trước

- 🚩 **Milestone 2.1**: Hoàn thành modal khởi tạo 3 bước
  - 🔲 **Task 2.1.1**: Tách bước 1 — thông tin nhận diện dự án
    - PIC: Frontend | Duration: 0.5 ngày | Dependencies: [Task 1.1.1 FS]
    - Criteria: Giữ tên, mã, phiên bản, vùng, nhóm, pháp nhân, địa điểm; không có ngày bắt đầu/kết thúc.
  - 🔲 **Task 2.1.2**: Tạo bước 2 — form tham số khởi tạo
    - PIC: Frontend | Duration: 1 ngày | Dependencies: [Task 1.1.1 FS]
    - Criteria: Có đủ các nhóm tham số áp dụng theo loại hình, đơn vị m²/ha rõ ràng, kiểm tra số dương, số nguyên và giá trị list; thấp tầng dùng số căn.
  - 🔲 **Task 2.1.3**: Tạo bước 3 — xem trước tác động
    - PIC: Frontend | Duration: 0.5 ngày | Dependencies: [Task 2.1.2 FS, Task 3.1.4 FS]
    - Criteria: Hiển thị số task giữ lại, bỏ qua, hoàn thành sẵn, nhân bản và số duration được tính lại trước khi tạo.

## Group 3.0: Rule engine hình thành cây MTL

- 🚩 **Milestone 3.1**: Engine xử lý đủ ba cơ chế
  - 🔲 **Task 3.1.1**: Dynamic Branching / Filtering
    - PIC: Frontend logic | Duration: 1 ngày | Dependencies: [Task 1.1.2 FS]
    - Criteria:
      - Loại hình chung cư giữ nhánh cao tầng `4.3.8`; thấp tầng giữ `4.3.7`; khu phức hợp giữ cả hai; nghỉ dưỡng giữ cao tầng và công trình tiện ích `4.3.9`.
      - `PARAM_SO_TANG_HAM = 0` không sinh nhánh hầm; từ 1 hầm sinh nhánh thi công ngầm; từ 2 hầm sinh thêm quan trắc ngầm.
      - `PARAM_HIEN_TRANG_DAT = Đất sạch 100%` bỏ qua nhánh `9.9`; hai trạng thái còn lại giữ nhánh GPMB.
      - `PARAM_MOC_PHAP_LY_DAU` đánh dấu hoàn thành các mốc trước trạng thái được chọn, gồm 1/500 (`4.1.4.9`), TKCS (các task thiết kế cơ sở thuộc `4.2`) và GPXD (`4.1.5.12`, `4.1.5.13`).
      - Nghĩa vụ tài chính kích hoạt đúng nhánh sinh động tương ứng.
  - 🔲 **Task 3.1.2**: Dynamic Task Cloning
    - PIC: Frontend logic | Duration: 1.5 ngày | Dependencies: [Task 3.1.1 FS]
    - Criteria:
      - Số phân kỳ nhân bản nhánh mở bán `9.3.7`, cấp phép theo đợt từ `4.1.5`, bàn giao từ `4.4.1.3`.
      - Số tháp nhân bản cụm cao tầng gốc `4.3.8.1` thành Tháp A/B/C…; mã sinh ra duy nhất, `parentCode`, `level`, `summary` hợp lệ.
      - Dependency mỗi tháp được sao chép; Tháp B/C có quan hệ SS +15/+30 ngày so với Tháp A.
  - 🔲 **Task 3.1.3**: Dynamic Duration Calculation
    - PIC: Frontend logic | Duration: 1 ngày | Dependencies: [Task 3.1.1 FS]
    - Criteria:
      - Tầng nổi tính thời lượng kết cấu thân = số tầng × 6 ngày/sàn.
      - Đất/GFA áp định mức cấu hình cho các task lá thuộc `9.8`, `9.6`, `4.2`, `4.3`, có min/max để tránh duration bất thường.
      - Thời lượng được ghi vào `taskEdits`, milestone/summary được tổng hợp lại từ task con.
  - 🔲 **Task 3.1.4**: Tổng hợp kết quả sinh cây
    - PIC: Frontend logic | Duration: 0.5 ngày | Dependencies: [Task 3.1.2 FS, Task 3.1.3 FS]
    - Criteria: Trả về `includedTaskCodes`, `customTasks`, `taskEdits`, `taskDependencies` và danh sách giải thích tác động; không có mã trùng hoặc cha bị thiếu.

## Group 4.0: Tích hợp, kiểm thử và nghiệm thu

- 🚩 **Milestone 4.1**: Luồng tạo MTL vận hành ổn định
  - 🔲 **Task 4.1.1**: Tích hợp rule engine vào `createProject`
    - PIC: Frontend | Duration: 0.5 ngày | Dependencies: [Task 2.1.3 FS, Task 3.1.4 FS]
    - Criteria: Nhấn “Tạo Master Timeline” sinh dự án đúng preview và mở workspace với cây mới.
  - 🔲 **Task 4.1.2**: Viết kiểm thử rule engine
    - PIC: QA/Frontend | Duration: 1 ngày | Dependencies: [Task 4.1.1 FS]
    - Criteria: Có test cho 0/2 hầm, 1/3 tháp, số căn thấp tầng, đất sạch/đang GPMB và bốn mốc pháp lý; kiểm tra mã duy nhất và toàn vẹn cha–con.
  - 🔲 **Task 4.1.3**: Build và kiểm tra giao diện
    - PIC: QA | Duration: 0.5 ngày | Dependencies: [Task 4.1.2 FS]
    - Criteria: Build pass, test pass, modal dùng được ở desktop/mobile và dự án cũ không lỗi khi tải lại.

## Definition of Done

- ✅ Các tham số hiện hành xuất hiện đầy đủ và được lưu theo dự án.
- ✅ Preview giải thích được mỗi thay đổi trước khi tạo.
- ✅ Cây MTL sinh ra không trùng mã, không mất cha, dependency không trỏ tới task bị loại.
- ✅ Các ví dụ 3 tháp, 0 hầm, 30 tầng và đất sạch cho kết quả đúng theo đặc tả.
- ✅ `npm test` pass; sẵn sàng commit/push lên `main` sau khi kế hoạch được duyệt.

## Phần mở rộng đã được duyệt: Phân rã ngày ban đầu từ Key Milestones

Người dùng đã duyệt hướng triển khai ở lượt yêu cầu “oki làm đi”: tạo lịch khởi tạo để sau đó chỉnh tay. Không thay đổi ngày của dự án đã lưu hoặc bản MTL đã phê duyệt.

### Group 5.0 — Dữ liệu mốc và đối chiếu WBS

- 🚩 Milestone 5.1: Danh mục 17 mốc chốt có mapping WBS hợp lệ.
  - Task 5.1.1: Định nghĩa mã, tên, nhóm, WBS thực và ngày tùy chọn. PIC: Frontend | Duration: 0.5 ngày | Dependencies: []. Criteria: Tất cả 17 mốc có mã duy nhất, mapping không dùng mã sai/chưa tồn tại; unit test.
  - Task 5.1.2: Lưu ngày mốc theo dự án và migrate bản cũ. PIC: Frontend | Duration: 0.5 ngày | Dependencies: [5.1.1 FS]. Criteria: Dự án cũ vẫn mở được; integration test/manual reload.

### Group 6.0 — Lịch khởi tạo

- 🚩 Milestone 6.1: Sinh lịch gợi ý dựa vào mốc, thời lượng và dependency.
  - Task 6.1.1: Tính lịch làm việc, forward/backward pass trên mạng task liên quan và kiểm tra âm dự trữ. PIC: Frontend logic | Duration: 1.5 ngày | Dependencies: [5.1.1 FS]. Criteria: Mốc được giữ nguyên, task tiền nhiệm tính lùi, task kế tiếp tính xuôi, xung đột được báo; unit test.
  - Task 6.1.2: Ghi ngày gợi ý vào taskEdits khi tạo MTL, không áp dụng lại sau khi người dùng chỉnh tay. PIC: Frontend | Duration: 0.5 ngày | Dependencies: [6.1.1 FS, 5.1.2 FS]. Criteria: Tạo xong mở workspace thấy ngày gợi ý; sửa task không bị ghi đè; manual UI check.

### Group 7.0 — Form và nghiệm thu

- 🚩 Milestone 7.1: Người dùng nhập và kiểm tra 17 ngày mốc trong wizard.
  - Task 7.1.1: Thêm 3 nhóm mốc ngày tùy chọn vào bước kiểm tra trước khi tạo. PIC: Frontend | Duration: 1 ngày | Dependencies: [5.1.1 FS]. Criteria: 17 ngày có mã/tên/mapping; form dùng `date`, có thể bỏ trống; manual desktop/mobile check.
  - Task 7.1.2: Preview số task được phân rã và cảnh báo ngày mốc không khả thi. PIC: Frontend | Duration: 0.5 ngày | Dependencies: [6.1.1 FS, 7.1.1 FS]. Criteria: Preview khớp lịch sau khi tạo; unit/integration test.
  - Task 7.1.3: Build/test và push. PIC: QA | Duration: 0.5 ngày | Dependencies: [6.1.2 FS, 7.1.2 FS]. Criteria: `npm test` pass, diff sạch, commit/push main.

## Đã duyệt và triển khai: 5 mốc chính và tiến độ mẫu toàn dự án

Người dùng duyệt bằng yêu cầu “code đi”. Nhập 5 mốc chính ở **bước 2 — Tham số**, tạo MTL là có lịch mẫu toàn bộ WBS đang bật và ngày giả định cho các mốc còn lại.

### Quyết định thiết kế đã áp dụng

- Năm trường ngày là: Chủ trương đầu tư, Quy hoạch 1/500, GPXD/Thông báo khởi công, Hoàn thành xây dựng, Hoàn thành bàn giao khách hàng. Cho phép để trống; nếu không nhập ngày nào, lấy ngày tạo MTL làm mốc xuất phát của lịch mẫu.
- Đối chiếu WBS thực: Chủ trương đầu tư `4.1.2.11` (mốc mới `MILE_PLP_00`); 1/500 `4.1.4.9` (`MILE_PLP_01`); GPXD `4.1.5.13` (`MILE_PLP_05`); Hoàn thành xây dựng dùng mốc vật lý mới `MILE_PCD_07` sau nhánh `4.3.8` hoặc `4.3.7`; Hoàn thành bàn giao dùng mốc kết thúc mới `MILE_OM_04` sau `4.4.1.3`. Mốc *bắt đầu* bàn giao `MILE_OM_02` không bị đổi tên thành mốc kết thúc.
- Ngày do người dùng nhập là `manual` và được giữ cố định. Mốc phụ và mốc chính còn trống là `assumed`, tính theo chuỗi dependency, thời lượng từ quy mô dự án và khoảng trống giữa các ngày neo. Đây là giả định lập kế hoạch, không phải thời hạn pháp lý chuẩn.
- Tiến độ mẫu phải có start/end cho **mọi task lá đã bật**. Với nhánh có dependency: tính theo FS/SS/FF và lịch làm việc. Với nhánh thiếu logic: xếp theo giai đoạn gần nhất của 5 mốc, đánh dấu `assumed` để người dùng chỉnh sau; không coi đây là đường găng đã thẩm định.
- Nếu 5 ngày neo tự mâu thuẫn hoặc ngắn hơn thời lượng tối thiểu, giữ ngày người dùng nhập và hiển thị âm dự trữ/cảnh báo trước khi tạo, không ép ngắn duration. Mốc phụ giả định được hiển thị ở bước 3 kèm nguồn suy ra.
- Dự án cũ không tự sinh lại. Nếu nhập XML, tệp là nguồn tiến độ chính và 5 ngày chỉ lưu tham chiếu, không ghi đè ngày trong XML.

### Group 8.0 — Schema và giao diện 5 mốc

- 🚩 Milestone 8.1: Bước 2 có đủ 5 ngày neo chính.
  - Task 8.1.1: Thêm định nghĩa/mapping 3 mốc mới, phân biệt `manual`/`assumed`. PIC: Frontend logic | Duration: 0.5 ngày | Dependencies: []. Criteria: 5 mốc có mã riêng, mapping WBS thật, không trùng mốc 17 ngày cũ; unit test.
  - Task 8.1.2: Thêm 5 ô ngày tại bước 2 và migrate localStorage. PIC: Frontend | Duration: 0.5 ngày | Dependencies: [8.1.1 FS]. Criteria: Form desktop/mobile rõ ràng; ngày cũ vẫn đọc được; manual UI + integration test.

### Group 9.0 — Sinh giả định và lịch mẫu

- 🚩 Milestone 9.1: MTL mới luôn có lịch mẫu có thể chỉnh.
  - Task 9.1.1: Suy ra ngày của các mốc phụ từ 5 mốc chính, tham số quy mô và quy tắc phụ thuộc; ghi nguồn giả định. PIC: Frontend logic | Duration: 1 ngày | Dependencies: [8.1.1 FS]. Criteria: Ngày nhập được giữ; thiếu 1–5 mốc vẫn có giả định hợp lệ; cảnh báo mâu thuẫn; unit test.
  - Task 9.1.2: Phân rã ngày cho mọi task lá đã bật và tổng hợp ngày task cha, giữ duration động. PIC: Frontend logic | Duration: 1.5 ngày | Dependencies: [9.1.1 FS]. Criteria: Không có task lá thiếu ngày, không sinh dependency vòng, ngày mốc khớp; unit/integration test.
  - Task 9.1.3: Chỉ áp dụng mẫu lúc tạo mới; thao tác chỉnh tay về sau không bị ghi đè. PIC: Frontend | Duration: 0.5 ngày | Dependencies: [9.1.2 FS, 8.1.2 FS]. Criteria: Tạo xong thấy lịch; sửa task rồi reload vẫn giữ ngày; manual UI check.

### Group 10.0 — Preview, kiểm thử, bàn giao

- 🚩 Milestone 10.1: Người dùng thấy rõ phần giả định trước khi tạo.
  - Task 10.1.1: Bước 3 hiển thị 5 mốc chính, mốc phụ suy ra, số task có ngày và cảnh báo âm dự trữ. PIC: Frontend | Duration: 0.5 ngày | Dependencies: [9.1.1 FS, 9.1.2 FS]. Criteria: Preview khớp dự án vừa tạo; manual UI + integration test.
  - Task 10.1.2: Test các ca không nhập mốc, nhập 1 mốc, nhập cả 5, dự án cao tầng/thấp tầng, ngày mâu thuẫn, XML, dự án cũ; build/push. PIC: QA | Duration: 1 ngày | Dependencies: [9.1.3 FS, 10.1.1 FS]. Criteria: `npm test` pass, diff sạch, push main sau khi được duyệt.

### Definition of Done

- Bước 2 có 5 trường ngày đúng tên; bước 3 phân biệt `manual` và `assumed`.
- Tạo MTL không XML luôn sinh lịch mẫu cho toàn bộ task lá đã bật.
- Ngày người dùng nhập không bị tự đổi; xung đột có cảnh báo rõ ràng.
- Dự án cũ và luồng XML không bị ghi đè.
