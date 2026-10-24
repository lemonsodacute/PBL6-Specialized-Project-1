# Đặc tả triển khai — Hệ thống thi trực tuyến + Học online (Live Class)

## 0. Tài liệu đi kèm — đọc trước khi code, KHÔNG tự ý thiết kế lại

- **`DESIGN.md`** (gửi kèm riêng): quy tắc giao diện. Tuân thủ tuyệt đối — không tự chọn màu/font/spacing/radius khác đi.
- **`schema.sql`** (gửi kèm riêng): schema PostgreSQL CHÍNH THỨC, đầy đủ toàn hệ thống. Không tự đổi tên bảng/cột/kiểu dữ liệu, không tự thêm bảng mới nếu chưa cần thiết. Alembic migration phải khớp đúng với file này (coi `schema.sql` là nguồn sự thật, migration chỉ là cách áp dụng nó).
- File này (`IMPLEMENTATION_SPEC.md`) chỉ mô tả **chức năng cần xây và cách các bảng trong schema.sql được dùng** — không lặp lại định nghĩa cột.

Nếu trong lúc code phát hiện thiếu bảng/cột để làm 1 tính năng nào đó, **dừng lại và hỏi trước**, không tự ý ALTER TABLE.

## 1. Tổng quan hệ thống

Nền tảng thi trực tuyến có giám sát chống gian lận (AI Proctoring) tích hợp module học trực tuyến trực tiếp (live class kiểu Zoom). Gồm:

- Ngân hàng câu hỏi dùng chung nhiều đề thi (chọn tay hoặc rút ngẫu nhiên).
- Thi trắc nghiệm, tự luận, vấn đáp (ghi hình).
- Theo dõi hành vi không cần AI (tab switch, copy/paste, fullscreen...).
- Giám sát AI (face/object/gaze detection) và phát hiện dùng AI khi làm bài (text detector, keystroke dynamics).
- Lớp học trực tuyến trực tiếp (live class) kèm điểm danh.
- Chấm điểm, báo cáo, audit log.

## 2. Tech stack

- **Backend:** FastAPI (Python 3.11+), SQLAlchemy 2.x, Alembic cho migration, Pydantic v2 cho validate request/response.
- **Frontend:** React/Next.js, theo `DESIGN.md`.
- **DB:** PostgreSQL — dùng đúng `schema.sql` gửi kèm.
- **Realtime:** WebSocket (FastAPI WebSocket hoặc thêm Socket.IO nếu cần room-based dễ hơn) — dùng cho dashboard giám sát real-time, đồng bộ đồng hồ đếm ngược, gửi violation log, tín hiệu join/leave của live class.
- **Video/audio:** MediaRecorder API (client) để ghi vấn đáp async; WebRTC/SFU (chọn 1: Agora / Twilio Video / MediaSoup) cho vấn đáp live và cho live class — 2 tính năng này nên dùng chung 1 lớp hạ tầng real-time video.
- **Storage:** Object Storage (S3-compatible) cho video, ảnh chụp giám sát (snapshot).
- **Speech-to-text:** Whisper API hoặc tương đương, sinh `oral_answers.transcript_text`.
- **AI text detection:** gọi API bên ngoài (GPTZero/Originality.ai/Copyleaks hoặc tự train) — kết quả ghi vào `ai_check_logs`, chỉ là tín hiệu tham khảo.

## 3. Cấu trúc module & cách dùng schema.sql

### 3.1 Auth & phân quyền
- Đăng ký/đăng nhập bằng email + password (`users.password_hash`, hash bằng bcrypt/argon2).
- JWT access token (ngắn hạn) + refresh token lưu ở `refresh_tokens` (hash token, không lưu plaintext).
- Quên/đổi mật khẩu qua `password_reset_tokens`.
- Middleware phân quyền theo `users.role`: `admin` / `teacher` / `student`. `teacher` đóng vai trò cả người tạo đề lẫn giám thị (xem `exam_proctors`).
- Ghi `user_consents` khi người dùng đồng ý bật camera/mic hoặc cho phép lưu dữ liệu sinh trắc học — bắt buộc trước khi bật proctoring hoặc live class có ghi hình.

### 3.2 Lớp học
- CRUD `classes`, gán học sinh vào lớp qua `class_enrollments`.
- 1 lớp có thể có nhiều đề thi (qua `exam_assignments.class_id`) và nhiều buổi live class (`live_classes.class_id`).

### 3.3 Ngân hàng câu hỏi
- CRUD `question_banks` (bộ đề), CRUD `questions` bên trong 1 bộ đề.
- `questions.type`: `mcq_single` / `mcq_multi` / `essay` / `oral`.
- `questions.difficulty` + `questions.topic`: dùng làm tiêu chí lọc khi giáo viên duyệt ngân hàng, và làm tiêu chí rút ngẫu nhiên (xem 3.4).
- **Không cho xoá cứng** 1 câu hỏi đã từng xuất hiện trong `answers`/`exam_questions`/`keystroke_logs` (DB đã chặn bằng `ON DELETE RESTRICT`). Ở tầng API: khi người dùng bấm "xoá", kiểm tra còn dùng ở đâu không — nếu có, chỉ set `questions.is_active = false` và báo rõ lý do; nếu chưa từng dùng ở đâu thì mới cho xoá thật.

### 3.4 Đề thi & ghép câu hỏi vào đề
- CRUD `exams`. Khi tạo đề, giáo viên chọn 1 trong 2 cách để có bộ câu hỏi (kết quả cuối cùng LUÔN nằm ở `exam_questions`, và **giống nhau cho mọi thí sinh của đề đó**):
  1. **Chọn tay:** giáo viên browse ngân hàng, chọn từng câu cụ thể → API insert thẳng vào `exam_questions`, để `draw_rule_id = NULL`, `order_index` theo thứ tự chọn, `points` giáo viên tự nhập (mặc định lấy `questions.default_points`).
  2. **Rút ngẫu nhiên:** giáo viên khai báo 1 hoặc nhiều rule ở `exam_question_draw_rules` (bộ đề nguồn, loại câu, chủ đề, độ khó — mỗi field lọc là optional, để trống = không lọc theo tiêu chí đó, số lượng câu, điểm mỗi câu). API chạy: với mỗi rule, `SELECT` ngẫu nhiên đúng `count` câu từ `questions` khớp điều kiện (và `is_active = true`, chưa có trong `exam_questions` của đề này), insert vào `exam_questions` với `draw_rule_id` trỏ về rule vừa tạo.
  - **Rút lại (regenerate):** cho phép xoá các row `exam_questions` cũ cùng `draw_rule_id` rồi rút lại — CHỈ khi đề chưa `published` hoặc chưa có `exam_attempts` nào (kiểm tra trước khi cho phép, trả lỗi rõ ràng nếu không thoả).
- Gán đề cho lớp hoặc học sinh cụ thể: `exam_assignments` (đúng 1 trong 2, DB đã CHECK).
- Gán giám thị coi thi: `exam_proctors`.
- Cài đặt đề: `shuffle_questions` (chỉ xáo thứ tự hiển thị bộ câu hỏi đã chốt, KHÔNG đổi câu), `shuffle_options`, `allow_review`, `max_attempts`, `require_camera`, `require_fullscreen`, `violation_auto_lock_threshold`.

### 3.5 Học online trực tiếp (live class)
- CRUD `live_classes`: giáo viên đặt lịch (`scheduled_start/end`), sinh `meeting_url` (từ WebRTC/SFU provider hoặc self-host).
- Khi học sinh vào phòng: client gửi sự kiện qua WebSocket/REST → backend upsert `class_attendance` (tạo row nếu chưa có, set `joined_at`). Khi rời phòng: set `left_at`, cộng dồn/ghi `duration_sec`.
- Khi buổi học `status` chuyển `ended` (giáo viên kết thúc hoặc hết `scheduled_end` + buffer): job tính lại `class_attendance.status` cho từng học sinh dựa trên `duration_sec` so với thời lượng buổi học (threshold cấu hình được, ví dụ ≥80% = present, có mặt nhưng vào trễ = late, không join = absent).
- Nếu ghi hình buổi học: lưu `live_classes.recording_url`, xử lý retention/soft-delete qua `deleted_at` giống `oral_answers`/`proctoring_sessions`.

### 3.6 Làm bài & chấm điểm
- Bắt đầu làm bài: tạo `exam_attempts`, backend tính và trả về `server_deadline_at = started_at + exams.duration_minutes` — **client không được tự tính giờ**, chỉ hiển thị countdown dựa trên `server_deadline_at`.
- Lấy câu hỏi của lượt thi: join `exam_questions` theo `exam_id`, áp `shuffle_questions` nếu bật (xáo ở tầng API/response, không đổi thứ tự lưu trong DB).
- Autosave: mỗi lần trả lời (hoặc debounce 1-2s / định kỳ 10-15s) → upsert `answers` (unique theo `attempt_id + question_id`).
- Tự động nộp khi hết giờ: xử lý cả 2 phía — client tự đếm ngược và gọi submit khi về 0, VÀ server tự kiểm tra (cron job hoặc kiểm tra tại thời điểm có request tới sau `server_deadline_at`) để tránh gian lận chỉnh giờ máy.
- Submit phải **idempotent** — gọi submit 2 lần không lỗi, không ghi đè điểm đã có.
- Chấm tự động MCQ: so `answers.answer_content` với `questions.correct_answer_json`, set `is_correct`, `points_awarded` lấy theo `exam_questions.points` của câu đó trong đề (KHÔNG lấy `questions.default_points`).
- Giao diện chấm tay cho `essay`: giáo viên nhập `points_awarded`, `graded_by`, `graded_at`.

### 3.7 Vấn đáp (oral exam)
- Luồng ghi hình async: hiện câu hỏi (`questions.type = 'oral'`) → đếm ngược chuẩn bị theo `questions.oral_prep_seconds` → bắt đầu quay tự động, không cho tua lại → đếm ngược theo `questions.oral_answer_seconds` → tự dừng, upload lên Object Storage → tạo `oral_answers` (`video_url`, `duration_sec`, `prep_time_used_sec`).
- Sau khi upload xong, chạy speech-to-text bất đồng bộ (background job) → điền `oral_answers.transcript_text`, `transcript_generated_at`, cập nhật `status` qua các bước `recording → uploaded → processing → processed` (`failed` nếu lỗi).
- Chấm điểm: cho phép nhiều giám khảo chấm độc lập cùng 1 `oral_answers` (`oral_gradings`, unique theo `oral_answer_id + grader_id`) — điểm cuối = trung bình, tính ở tầng API/report khi cần.

### 3.8 Behavior tracking (không AI)
- Client bắt các sự kiện JS: `visibilitychange`/`blur` (chuyển tab), `copy`, `paste`, thoát Fullscreen API, `contextmenu` (chuột phải), `online`/`offline`, Screen API (đa màn hình), kích thước window bất thường (nghi devtools).
- Gửi về server theo batch (REST) hoặc real-time (WebSocket) → insert `violation_logs` (`type`, `severity`, `metadata_json`).
- **Không tự tính lại `exam_attempts.violation_count` ở backend** — trigger DB (`trg_violation_count`) đã tự tăng khi có row `violation_logs` mới.
- Nếu `exam_attempts.violation_count` vượt `exams.violation_auto_lock_threshold` (không NULL): tự động chuyển `exam_attempts.status = 'terminated'` và khoá bài — đây là logic tầng API/service, không phải trigger DB.

### 3.9 AI Proctoring
- Bật camera/mic theo lượt thi → tạo `proctoring_sessions` (1-1 với `exam_attempts`).
- Model detect chạy ở client hoặc 1 service riêng, kết quả gửi về ghi `detection_events` (`event_type`, `confidence_score`, `severity`, `snapshot_url`).
- Chỉ hiển thị `risk_score`/`overall_risk_score` cho giám thị trên dashboard để họ tự quyết định — **không tự động khoá bài hoặc trừ điểm** dựa trên detection_events.

### 3.10 AI Usage Detection
- Với câu tự luận: gọi AI-text-detector, ghi kết quả vào `ai_check_logs` (`method = 'text_detector'` hoặc `'stylometry'`), `answer_id` trỏ tới câu trả lời.
- Với vấn đáp: cross-check giữa bài viết và câu trả lời vấn đáp cùng chủ đề → `ai_check_logs` (`method = 'oral_crosscheck'`, `oral_answer_id`).
- Ghi nhịp gõ phím: `keystroke_logs` (tổng số phím gõ, tổng ký tự dán, khoảng cách trung bình giữa các phím, danh sách paste event) — client gửi theo batch hoặc khi rời câu hỏi.
- Tất cả kết quả ở đây **chỉ là risk score tham khảo cho giám thị xem xét, không tự động kết luận gian lận**.

### 3.11 Audit & báo cáo
- Ghi `audit_logs` cho các thao tác nhạy cảm: sửa điểm tay, xoá/khoá đề thi, đổi quyền người dùng, set `questions.is_active = false`.
- Xuất báo cáo kết quả + vi phạm ra CSV/Excel, lưu record ở `report_exports`.

## 4. API cần có (REST + WebSocket)

Tiền tố chung: `/api/v1`.

**Auth**
```
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
POST /auth/forgot-password
POST /auth/reset-password
```

**Classes**
```
GET/POST/PUT/DELETE /classes
POST /classes/{id}/enroll
```

**Question banks**
```
GET/POST/PUT/DELETE /question-banks
GET/POST/PUT/DELETE /question-banks/{id}/questions
PATCH /questions/{id}/deactivate   -- soft-retire, không xoá cứng
```

**Exams**
```
GET/POST/PUT/DELETE /exams
POST /exams/{id}/assign
POST /exams/{id}/proctors
POST /exams/{id}/questions              -- ghép tay
POST /exams/{id}/draw-rules             -- khai báo tiêu chí rút
POST /exams/{id}/draw-rules/{rule_id}/generate   -- chạy rút ngẫu nhiên
POST /exams/{id}/draw-rules/{rule_id}/regenerate -- rút lại (chỉ khi chưa có attempts)
GET  /exams/{id}/questions
```

**Live classes**
```
GET/POST/PUT/DELETE /live-classes
POST /live-classes/{id}/start
POST /live-classes/{id}/end
GET  /live-classes/{id}/attendance
WS   /ws/live-class/{id}                -- join/leave event, presence
```

**Làm bài (student)**
```
GET  /exams/available
POST /attempts/{exam_id}/start
GET  /attempts/{id}/questions
POST /attempts/{id}/answers             -- autosave
POST /attempts/{id}/oral-answers        -- upload video vấn đáp
POST /attempts/{id}/submit
```

**Behavior tracking**
```
POST /attempts/{id}/violations          -- batch
WS   /ws/monitor/{exam_id}              -- dashboard giám thị real-time
```

**Proctoring**
```
POST /attempts/{id}/proctoring/start
POST /attempts/{id}/detection-events    -- batch
```

**AI usage detection**
```
POST /answers/{id}/ai-check
POST /attempts/{id}/keystroke-logs      -- batch theo question
```

**Chấm điểm & báo cáo**
```
GET /exams/{id}/attempts
PUT /answers/{id}/grade
PUT /oral-answers/{id}/grade
GET /exams/{id}/report
GET /exams/{id}/report/export           -- CSV/Excel
```

## 5. Nguyên tắc kỹ thuật bắt buộc

- **Server là nguồn sự thật cho thời gian** — không tin đồng hồ client cho deadline làm bài, cho `oral_prep_seconds`/`oral_answer_seconds` cũng nên đếm bằng timestamp server-side khi có thể.
- **Autosave bắt buộc** cho mọi câu trả lời — không được để mất bài khi mất mạng/crash.
- **Submit idempotent** — không tạo lỗi hoặc ghi đè điểm khi gọi submit nhiều lần.
- **`exam_questions` là bộ câu hỏi cố định, dùng chung cho mọi thí sinh** của 1 đề — không sinh ngẫu nhiên riêng theo từng người.
- **Không xoá cứng `questions` đã được dùng** — dùng `is_active = false`. FK `RESTRICT` trong `schema.sql` sẽ chặn ở tầng DB, nhưng phải bắt lỗi này ở service layer để trả về thông báo rõ ràng, không để lộ lỗi SQL thô cho client.
- **Các trường `*_json` (JSONB)** dùng để mở rộng dữ liệu — khi cần thêm field mới cho 1 loại log, ưu tiên thêm vào JSON thay vì ALTER TABLE thêm cột.
- **Kết quả AI (proctoring, text-detector, keystroke) chỉ là tín hiệu risk score** — không có logic nào được tự động khoá bài / trừ điểm / kết luận gian lận chỉ dựa trên các bảng này; quyết định cuối luôn thuộc về giám thị/giáo viên (trừ `violation_auto_lock_threshold` ở mục 3.8, đây là ngưỡng do giáo viên tự cấu hình, không phải AI tự quyết).
- **Chặn thao tác cơ bản ở client** (F12, Ctrl+C, chuột phải) để giảm gian lận vô tình, nhưng biết rằng không chặn được 100% qua JS — luôn có log ghi lại song song.

## 6. Thứ tự triển khai đề xuất

1. Setup project (FastAPI + SQLAlchemy models khớp `schema.sql` + Alembic) + Auth + phân quyền.
2. Ngân hàng câu hỏi: CRUD `question_banks` + `questions`.
3. Quản lý đề thi: CRUD `exams` + ghép câu hỏi (chọn tay trước, rút ngẫu nhiên sau) → `exam_questions`.
4. Luồng làm bài cơ bản: start → hiển thị câu hỏi → trả lời → submit (chưa autosave, chưa tracking).
5. Autosave + đồng bộ thời gian server + tự động nộp khi hết giờ.
6. Behavior tracking (từng loại sự kiện) + dashboard giám sát real-time qua WebSocket.
7. Vấn đáp (async trước; live sau nếu cần, dùng chung hạ tầng WebRTC với live class).
8. Live class (Zoom-style) + điểm danh.
9. AI proctoring (face/object/gaze) + AI usage detection (text detector, keystroke).
10. Chấm điểm hoàn chỉnh (tự động + tay + rubric vấn đáp) + báo cáo + audit log.

## 7. Quy ước code (FastAPI)

- Cấu trúc theo module, mỗi module gồm `router.py` (endpoint), `service.py` (business logic), `schemas.py` (Pydantic request/response), dùng chung `models.py` (SQLAlchemy) ánh xạ đúng `schema.sql`.
- Không trả thẳng SQLAlchemy model ra API — luôn qua Pydantic response schema.
- Background job (speech-to-text, tính điểm danh, chấm MCQ hàng loạt...) dùng task queue (Celery/RQ/ARQ) hoặc FastAPI `BackgroundTasks` cho việc nhẹ.
- Chuẩn hoá lỗi: trả `{"error_code": "...", "message": "..."}`, không để lộ traceback/lỗi SQL thô ra response.
- Biến môi trường (DB URL, JWT secret, Object Storage keys, API key của AI-text-detector/Whisper/WebRTC provider) qua `.env`, không hardcode.
