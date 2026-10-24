# Student Exam List: trạng thái theo từng đề và sinh viên

Kiểm chứng ngày 2026-10-12. Phạm vi: Student Exam List, trạng thái/action theo
attempt và tải lại dữ liệu. Không đổi scoring, Face Verification, Student Card,
OCR, Teacher Results hoặc nội dung đề.

## Trace dữ liệu thật

Đã truy vấn riêng `(student_id, exam_id)` cho từng đề dưới đây, trên cả hai tài
khoản sinh viên active có hồ sơ VERIFIED và được giao cả ba đề. Cả hai đều có
cùng kết quả: không có attempt. Không lấy attempt của sinh viên khác hoặc của
đề khác, không đọc score/timestamp để suy diễn đã nộp.

| Đề thật | Exam ID | Attempt ID / status | Started / submitted / score |
| --- | --- | --- | --- |
| Kiểm tra GKy | `419c6ce7-6eb0-47b2-a297-69b4c2619aeb` | null / null | null / null / null |
| Khai phá dữ liệu — Kiểm tra kiến thức nền tảng | `7273800d-c791-4e04-a455-fb630fb09db6` | null / null | null / null / null |
| Demo Exam 1 | `116a312f-368c-4fc7-b321-203537a36023` | null / null | null / null / null |

Trace đầy đủ có student ID, mọi attempt của đúng cặp khóa, các field yêu cầu,
payload serializer API và việc đề có nằm trong danh sách hiện hành hay không.
Artifact đặt ở TEMP `student-exam-state-real-trace.json`; không thêm identity
logging vào production và không lưu token trong artifact này.

API thật của hai tài khoản đang trả `attempt: null`, `attempts: []` cho Khai phá
dữ liệu và Demo Exam 1. Demo có `allow_review=false`; Khai phá dữ liệu hiện có
`allow_review=true`. Vì vậy snapshot hiện tại tái hiện nhánh lỗi cho Demo;
không khẳng định API hiện hành đang trả submitted sai cho Khai phá dữ liệu.

Kiểm tra GKy có câu vấn đáp nên không xuất hiện trong API danh sách sau yêu
cầu bỏ vấn đáp trước đó. Vẫn trace được đề và attempt riêng qua DB/serializer;
không khôi phục hình thức đã bỏ hoặc tự sửa câu hỏi để đưa đề trở lại danh sách.

## Nguyên nhân và sửa lỗi

Query backend đã có cả `ExamAttempt.exam_id == exam.id` và
`ExamAttempt.student_id == user.id`. Không có join chỉ theo student, không có
assignment/version ID thay thế; attempt có FK trực tiếp tới Exam. Clone cùng
tên nhưng ID khác không dùng chung lịch sử.

UI cũ yêu cầu `canRetryExam(...)` cho cả lần bắt đầu đầu tiên. Hàm này phụ
thuộc `allow_review=true`; khi điều kiện không đạt, nhánh fallback hiển thị nút
disabled “Đã nộp” ngay cả khi không có attempt. Trang chi tiết lớp có cùng điều
kiện sai và có thể mất action bắt đầu. UI cũng gom mọi history thành một mảng
rồi lọc lại, gây khó audit và không kiểm tra owner metadata tại boundary.

Thay đổi:

- `getStudentExamState()` là nguồn chung cho trạng thái, label, action, latest
  attempt, group và khả năng làm lại. Cả danh sách đề và đề trong lớp dùng
  `StudentExamCard`; không còn mảng global `latestAttempt`/submitted state.
- History lấy trực tiếp từ parent exam. Có metadata exam/student khác thì
  loại, không ghi đè metadata để ép match. Response cũ thiếu metadata vẫn dùng
  scope của parent exam từ API authenticated. Backend thêm `exam_id`,
  `student_id`, deadline vào latest summary; history cũng có owner.
- Chọn latest theo attempt number, rồi thời gian bắt đầu; không mutate mảng
  response. Latest IN_PROGRESS thắng attempt đã nộp ở lần trước.
- Enum thật: NOT_STARTED, IN_PROGRESS, SUBMITTED, AUTO_SUBMITTED, TERMINATED.
  Không invent enum COMPLETED/GRADED. Type/status chưa biết có trạng thái không
  khả dụng, không rơi vào “Đã nộp”.
- Không có attempt ở đề mở: Bắt đầu làm bài, độc lập với allow_review. Đã có
  attempt: dùng status thật, không dùng score/submitted_at để xác định nộp.
- SUBMITTED / AUTO_SUBMITTED / TERMINATED: kết quả của đúng attempt; nếu policy
  hiện có cho phép làm lại thì “Làm lại” là action riêng. IN_PROGRESS tiếp tục
  đúng attempt. Đề đóng/hết giờ chưa làm dùng “Bỏ lỡ”, không có action bắt đầu.
- Query được scope theo user ID (thêm class ID ở trang lớp). Reload khi focus,
  trở lại tab, mỗi 15 giây khi visible và sau event submit thành công. Event có
  exam/attempt/student metadata; khác student thì không áp dụng. Tải lại từ API,
  không optimistic-map mọi đề thành submitted. Request cũ không ghi đè query mới.
- Submit API giữ nguyên request/response, chỉ phát event khi backend trả status
  kết thúc hợp lệ. Không sửa luồng lưu đáp án, submit, auto-submit hoặc tính điểm.

## Kiểm chứng

- 30 backend case được kiểm chứng đạt: 7 mới Student Exam State, 23 hồi quy
  collections/Teacher Results. Case score kiểm tra giá trị số, không phụ thuộc
  JSON encode số thành number hay string. Sau sửa assertion này, 7 case mới
  được chạy lại và đều đạt.
- 12 kiểm thử mới đạt: 7 hàm thuần + 5 browser case cho hai route, exact-ID
  navigation, cache/focus/event, phản hồi trễ và payload sai scope. Navigation
  fixture mô tả đúng API của trang đích; không dùng default response rỗng.
- 4 browser hồi quy đạt: submit, pending answer, history ngoài 100 record đầu
  và notification/collection independence. Full TypeScript đạt.
- Snapshot API thật được đối chiếu với DB/serializer rồi replay trong browser
  ở desktop/mobile cho hai student. Cả 4 card đang hiển thị từ hai tài khoản
  đều có Bắt đầu làm bài; không có false “Đã nộp” hoặc lỗi JavaScript. Đây là
  kiểm tra browser bằng snapshot, không phải phiên browser đăng nhập thật.
- Đã xem screenshot mobile. Source/API trace và kiểm tra snapshot đều chỉ đọc;
  không tạo/xóa attempt hoặc sửa điểm/dữ liệu lớp thật khi kiểm chứng.

Log, snapshot, trace và screenshot nằm trong TEMP, không dùng làm fallback
dữ liệu trong sản phẩm.

## Tách Làm kiểm tra / Kết quả / Lịch sử — 2026-10-13

- `/student/exams` chỉ hiển thị Đang làm → Đang diễn ra → Sắp diễn ra;
  nhóm trống ẩn hoàn toàn. Bài đã nộp, tự động nộp, bị kết thúc và đề hết hạn
  không xuất hiện. Bài có attempt đang làm được ưu tiên tiếp tục, kể cả có
  lịch sử đã nộp ở lần trước.
- `GET /exams?actionable_only=true` dành riêng cho sinh viên, giữ scope
  assignment/student/exam và xử lý attempt hết hạn trước khi lọc. Trả toàn bộ
  bài actionable; page/limit không chia danh sách này. API exam thông thường
  cho lớp và giáo viên vẫn phân trang như trước.
- `groupStudentActionableExams` dùng state mapper chung, sắp Đang làm theo
  deadline attempt, Đang diễn ra theo end_time, Sắp diễn ra theo start_time;
  exam ID làm khóa phụ. Query sort/page cũ không thay đổi ưu tiên UI.
- `/student/grades` lấy `completed_only=true`; hiển thị điểm thật (kể cả 0)
  hoặc Đang chờ chấm, với Xem kết quả / Xem bài đã nộp. Backend bổ sung
  `final_score` và `grading_pending` cho response sinh viên: tự luận đã trả lời
  còn thiếu điểm chấm thì không công bố tổng điểm tạm thành điểm chính thức.
  Không thay đổi điểm lưu, thuật toán chấm hoặc response Teacher Results.
- `/student/history` lấy mọi attempt của sinh viên, hiển thị lần làm,
  bắt đầu/nộp lúc, thời lượng và trạng thái; không có cột điểm. Bộ lọc ngày
  dùng `time_field=started`, còn Kết quả dùng thời gian nộp như trước.
- Mapper chấp nhận thêm COMPLETED/GRADED/FINALIZED nếu response có các trạng
  thái này; không thêm enum/migration vào schema hiện tại. Business state dùng
  status và timestamps, không dùng text label hoặc chỉ sự tồn tại của attempt.
- Submit chỉ kết thúc UI khi response xác nhận trạng thái hoàn thành. Event
  submit, focus và polling refetch dữ liệu authenticated; phản hồi cũ không
  ghi đè trạng thái mới. Trang chi tiết kết quả quay về Điểm số / Kết quả.

Kiểm thử bổ sung: A/B/C/D, thứ tự từng nhóm, nhóm trống, status hoàn thành,
payload sai exam/student, sort/page cũ, nhiều bài lịch sử, tự động nộp khi hết
giờ, lịch sử đang làm, điểm 0, chờ chấm tự luận và submit không cần F5.

Kiểm chứng bản sửa:

- 37 ca backend của `test_student_exam_state`, `test_collections`,
  `test_teacher_results` đạt. Chạy lại riêng 14 ca trạng thái sinh viên sau
  tối ưu metadata cũng đạt.
- Build production (`next build`) đạt, gồm kiểm tra TypeScript và 38 trang
  static. TypeScript độc lập cũng đạt.
- 29 ca frontend/browser liên quan đạt trên bản build production bằng Edge:
  mapper, A/B/C/D, refresh, stale response, pagination, kết quả ngoài 100 bản
  ghi, chờ chấm, lịch sử, mobile, submit/auto-submit, dừng media/timer và lỗi
  submit. Fixture chỉ kiểm tra request `/api/v1/exams`, tránh nhầm với request
  prefetch trang của Next.js.
- Máy chủ dev cổng 3000 đã được khởi động lại với cache mới; cache cũ được
  giữ trong thư mục recovery. Ca trình duyệt phân nhóm/submit-refresh trên
  `/student/exams` cũng đạt trên máy chủ dev này.
