# Thiết lập và chạy hệ thống

Tài liệu này dành cho môi trường phát triển local. Backend dùng FastAPI + PostgreSQL; frontend dùng Next.js.

## Yêu cầu

- Python 3.11+ và PostgreSQL 14+
- Node.js 22+
- Một database PostgreSQL rỗng, ví dụ `ai_proctoring`

## Backend

Mở terminal tại thư mục `backend/`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Chỉnh `.env` tối thiểu:

```env
DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5432/ai_proctoring
JWT_SECRET=dev-only-change-this-secret
ENVIRONMENT=development
COOKIE_SECURE=false
CORS_ORIGINS=["http://localhost:3000"]
```

Không dùng `JWT_SECRET` mẫu trong production. Khi production, đặt `ENVIRONMENT=production`, dùng HTTPS và để `COOKIE_SECURE=true`.

## Migration và dữ liệu mẫu

Từ thư mục `backend/`, sau khi database đã chạy:

```powershell
alembic upgrade head
alembic current
alembic check
```

Seed demo release dùng database QA riêng và password sinh ngẫu nhiên trong private storage. Xem [README](../README.md#dữ-liệu-và-kịch-bản-demo) để prepare QA DB, migrate, seed và chạy API bằng cùng runtime; không chèn demo vào database đang sử dụng.

Database rỗng hiện chạy trực tiếp `alembic upgrade head`: các migration lịch sử đã xử lý bảng/cột có sẵn trong baseline. Riêng database legacy đã có dữ liệu nhưng chưa có `alembic_version` cần bước tiếp nhận đã kiểm tra schema:

```powershell
python -m scripts.migrate_identity
python -m scripts.migrate_identity --apply
```

Lệnh đầu chỉ kiểm tra target. Lệnh sau chỉ tiếp nhận baseline khi schema khớp và áp dụng migration trong transaction; cần quyền tạo database tham chiếu tạm. Không tự `stamp head`. Xem [Student Identity](STUDENT_IDENTITY_IMPLEMENTATION.md) về việc giữ dữ liệu và đánh giá OCR. Khi database đã được tiếp nhận, tiếp tục dùng `alembic upgrade head`. HEAD hiện hành là `0022_support_session_lifecycle`.

FastAPI chạy cleanup student-card previews mỗi 60 giây. TTL truy cập là 10 phút; khi API dừng, ảnh vẫn bị từ chối sau expiry ở lần truy cập kế tiếp và cleanup tiếp tục khi API chạy lại. Có thể chạy một lượt thủ công bằng `python -m scripts.cleanup_student_card_previews`. Thư mục `backend/private/identity/previews` phải nằm ngoài mọi public/static mount.

## Chạy API

Chuẩn bị nhận diện khuôn mặt (sau `pip install -r requirements.txt`, từ `backend/`):

```powershell
python scripts/setup_face_models.py
```

Lệnh tải hai mô hình OpenCV YuNet/SFace, tổng khoảng 39 MB, và kiểm tra SHA-256. Chạy migration tới HEAD để có cả preview/reference version metadata. Không cần API key hoặc GPU. Khởi động lại backend sau khi cài dependencies.

Chuẩn bị OCR local trong môi trường riêng (Windows AMD64, Python 3.12, từ `backend/`):

```powershell
python -m venv .venv-ocr
.\.venv-ocr\Scripts\python.exe -m pip install -r requirements-ocr.txt
.\.venv\Scripts\python.exe -m scripts.setup_student_card_ocr
```

OCR được chốt là Tesseract 5.5.2 qua tesserocr, model chính thức `tessdata_best` tiếng Việt + Anh đã pin revision/SHA-256. PaddleOCR PP-OCRv5 đã được đánh giá riêng nhưng model Latin thiếu ký tự tiếng Việt và không qua smoke test tên có dấu. Không cài PaddleOCR vào `.venv` backend; không đổi NumPy/OpenCV của production. Windows wheel Tesseract được pin hash trong requirements; các hệ điều hành khác cần libtesseract 5.5.2/libLeptonica phù hợp và chạy smoke test tại chỗ.

FastAPI load worker OCR một lần khi khởi động. Worker chỉ dùng model local, giao tiếp stdin/stdout, không tải model trong request và không gọi OCR API. Nếu worker không sẵn sàng, upload trả `MODEL_ERROR`; kiểm tra provisioning rồi khởi động lại backend. Đặt `STUDENT_CARD_OCR_AUTOSTART=false` khi chạy unit tests; smoke test opt-in bằng `RUN_LOCAL_OCR_SMOKE=1`.

Sinh viên dùng `/student/profile`: admin xác nhận họ tên/MSSV → tải thẻ → xem preview → xác nhận. Preview private TTL 10 phút; sau confirm chỉ giữ ảnh mặt đã sanitize trong database, embedding và metadata phiên bản, xóa temporary card files. `/student/identity` redirect về Hồ sơ; API enrollment/check cũ trả 410. Dữ liệu legacy trong private storage và `/uploads/identity` vẫn được giữ và bị chặn truy cập công khai, không tự chuyển thành reference tin cậy.

Chỉ các bài thi có `require_camera=true` yêu cầu xác minh khuôn mặt; microphone tuân theo `require_mic`. Máy chủ kiểm tra profile VERIFIED, active reference, kết quả mới nhất còn hạn 15 phút và trùng reference version trước khi tạo lượt thi. Đổi reference/hồ sơ làm kết quả cũ không còn hợp lệ. Lượt thi đang diễn ra vẫn được resume theo chính sách hiện có. Kết quả giả trong localStorage/sessionStorage hoặc `NEXT_PUBLIC_MOCK_IDENTITY` không được sử dụng.

Giới hạn: đây là đối chiếu ảnh khuôn mặt, **chưa có liveness/anti-spoofing**. API luôn trả `liveness_checked=false`. Ngưỡng cosine mặc định vẫn là `FACE_MATCH_THRESHOLD=0.363`; task này không thay threshold hoặc model mặt. Điểm cosine không phải xác suất chính xác. OCR chỉ đối chiếu thông tin đọc được với hồ sơ do admin xác nhận, không chứng minh thẻ thật hoặc ảnh chưa bị chỉnh sửa. Cần đánh giá trên bộ ảnh thẻ/webcam được phép sử dụng trước khi triển khai thi chính thức; không có tuyên bố accuracy dựa trên smoke test tổng hợp.

Camera trình duyệt yêu cầu HTTPS hoặc localhost. Nếu truy cập từ máy khác qua HTTP bằng IP LAN, trình duyệt có thể không cho phép camera.

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API: `http://localhost:8000/api/v1`  
Swagger: `http://localhost:8000/docs`  
File snapshot/report: `http://localhost:8000/uploads/...`, yêu cầu đăng nhập và quyền với attempt/exam tương ứng.

## Frontend

Mở terminal tại thư mục gốc:

```powershell
npm install
$env:NEXT_PUBLIC_API_URL="http://localhost:8000"
$env:NEXT_PUBLIC_USE_MOCK="false"
npm run dev
```

`NEXT_PUBLIC_USE_MOCK=false` bật luồng API thật. Các màn chưa chuyển đổi có thể tiếp tục dùng mock khi đặt cờ về `true`.

Hiện luồng đã chuyển sang API thật: đăng nhập, danh sách đề của student, bắt đầu/làm/nộp bài, autosave, vi phạm và report endpoint. Các màn dashboard quản trị/lớp học live/oral grading vẫn giữ dữ liệu mock khi offline vì backend tương ứng chưa có đủ CRUD nghiệp vụ; không nên xoá các import mock của các màn này cho đến khi chúng được nối API và kiểm thử quyền.

## Quyền endpoint

Ký hiệu: `P` public, `A` admin, `T` teacher, `S` student. Với các route có ghi “owner”, student chỉ được truy cập attempt của chính mình; teacher chỉ được truy cập exam do mình tạo; admin xem toàn hệ thống.

| Endpoint | P | A | T | S |
|---|:---:|:---:|:---:|:---:|
| `GET /health` | ✓ | ✓ | ✓ | ✓ |
| `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` | ✓ | ✓ | ✓ | ✓ |
| `GET /auth/me` |  | ✓ | ✓ | ✓ |
| `/users/**` |  | ✓ |  |  |
| `GET /exams`, `GET /exams/{id}` |  | ✓ | own | assigned |
| `POST /exams`, `PATCH/DELETE /exams/{id}` |  | ✓ | own |  |
| `POST /exams/{id}/questions*` |  | ✓ | own |  |
| `/question-banks/**` |  | ✓ | own |  |
| `/classes/**` |  | ✓ | own |  |
| `/exam-assignments/**` |  | ✓ | own exam/class |  |
| `GET /attempts?exam_id=...` |  | ✓ | own exam |  |
| `POST /attempts` |  |  |  | ✓ |
| `GET /attempts/{id}`, `/questions`, `/timeline` |  | ✓ | own exam | own |
| `PUT /attempts/{id}/answers`, `POST /attempts/{id}/submit` |  |  |  | own |
| `GET /violations/{attempt_id}` |  | ✓ | own exam | own |
| `POST /attempts/{id}/violations` |  |  |  | own |
| `POST /proctoring/sessions/{id}` |  |  |  | own |
| `GET /proctoring/sessions/{id}` |  | ✓ | own exam | own |
| `POST /proctoring/detection-events` |  |  |  | own |
| `WS /ws/monitor/{exam_id}` |  | own exam | own exam |  |
| `PATCH /answers/{id}/grade` |  | ✓ | own exam |  |
| `GET/POST /exams/{id}/report*` |  | ✓ | own exam |  |
| `GET /dashboard/stats` |  | ✓ | ✓ |  |

## Kiểm tra nhanh

```powershell
python -m compileall -q app
```

Từ thư mục gốc frontend:

```powershell
cmd /c .\node_modules\.bin\tsc.cmd --noEmit
```

Khi kiểm thử bảo mật, dùng hai student khác nhau để xác nhận student A nhận `403` hoặc `404` khi truy cập attempt của student B; dùng teacher của exam khác để xác nhận nhận `403`/`404`.


## Profile verification requests — migration 0011

HEAD hiện tại là `0011_profile_requests`, nối sau `0010_student_card_references`. Với database đã được quản lý bằng Alembic, chạy từ backend:

```powershell
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m alembic current
```

Database local pbl6 đã nâng lên 0011. Database legacy chưa version hóa vẫn dùng quy trình audit/adopt `python -m scripts.migrate_identity --apply` đã mô tả ở trên; không sửa migration cũ. Khởi động lại backend/frontend đang chạy để nạp code mới. Tính năng dùng notifications hiện có và không cần dịch vụ realtime/email mới. Frontend chạy API thật (`NEXT_PUBLIC_USE_MOCK=false`). Xem [báo cáo tính năng](PROFILE_VERIFICATION_REQUESTS.md).
