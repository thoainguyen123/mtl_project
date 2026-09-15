# WBS: Bộ 11 tham số hình thành tiến độ dự án

> Trạng thái: ✅ Đã triển khai và kiểm thử sau khi người dùng phê duyệt kế hoạch.

## Phạm vi và quyết định thiết kế

- Nâng modal khởi tạo MTL thành quy trình 3 bước: Thông tin dự án → 11 tham số → Xem trước tác động và tạo MTL.
- Lưu toàn bộ tham số vào từng dự án để có thể xem lại nguồn hình thành tiến độ.
- Sinh cây bằng rule engine thuần, có kết quả ổn định với cùng một bộ đầu vào.
- Dùng mã WBS thật của thư viện hiện tại. Nhánh GPMB dùng `9.9`; nhánh cao tầng dùng `4.3.8.1`.
- Bổ sung task sinh động cho tầng hầm, nghĩa vụ tài chính và nhà mẫu vì thư viện hiện tại chưa có đủ các task này.
- Giữ khả năng nhập XML. Khi có XML, hệ thống lưu 11 tham số làm metadata nhưng không tự viết lại cây công việc từ tệp.

## Group 1.0: Mô hình dữ liệu và tương thích dự án cũ

- 🚩 **Milestone 1.1**: Chốt schema 11 tham số
  - 🔲 **Task 1.1.1**: Tạo kiểu `ProjectParameters` với đủ 11 mã tham số
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
  - 🔲 **Task 2.1.2**: Tạo bước 2 — form 11 tham số
    - PIC: Frontend | Duration: 1 ngày | Dependencies: [Task 1.1.1 FS]
    - Criteria: Có đủ 11 tham số, đơn vị m²/ha rõ ràng, kiểm tra số dương, số nguyên và giá trị list.
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
      - Nghĩa vụ tài chính và mô hình nhà mẫu kích hoạt đúng nhánh sinh động tương ứng.
  - 🔲 **Task 3.1.2**: Dynamic Task Cloning
    - PIC: Frontend logic | Duration: 1.5 ngày | Dependencies: [Task 3.1.1 FS]
    - Criteria:
      - Số phân kỳ nhân bản nhánh mở bán `9.3.7`, cấp phép theo đợt từ `4.1.5`, bàn giao từ `4.4.1.3`.
      - Số tháp nhân bản cụm cao tầng gốc `4.3.8.1` thành Tháp A/B/C…; mã sinh ra duy nhất, `parentCode`, `level`, `summary` hợp lệ.
      - Dependency mỗi tháp được sao chép; Tháp B/C có quan hệ SS +15/+30 ngày so với Tháp A.
      - Mô hình chia gói thầu sinh các gói thiết kế, kết cấu, MEP và hoàn thiện độc lập; D&B tạo dependency song song thiết kế–thầu.
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
    - Criteria: Có test cho 0/2 hầm, 1/3 tháp, đất sạch/đang GPMB, bốn mốc pháp lý, ba mô hình thầu và bốn mô hình nhà mẫu; kiểm tra mã duy nhất và toàn vẹn cha–con.
  - 🔲 **Task 4.1.3**: Build và kiểm tra giao diện
    - PIC: QA | Duration: 0.5 ngày | Dependencies: [Task 4.1.2 FS]
    - Criteria: Build pass, test pass, modal dùng được ở desktop/mobile và dự án cũ không lỗi khi tải lại.

## Definition of Done

- ✅ 11 tham số xuất hiện đầy đủ và được lưu theo dự án.
- ✅ Preview giải thích được mỗi thay đổi trước khi tạo.
- ✅ Cây MTL sinh ra không trùng mã, không mất cha, dependency không trỏ tới task bị loại.
- ✅ Các ví dụ 3 tháp, 0 hầm, 30 tầng và đất sạch cho kết quả đúng theo đặc tả.
- ✅ `npm test` pass; sẵn sàng commit/push lên `main` sau khi kế hoạch được duyệt.
