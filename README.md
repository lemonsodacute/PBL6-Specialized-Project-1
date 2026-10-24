# AI PROCTO

Nền tảng thi trực tuyến cho Student, Teacher và Admin: quản lý lớp/ngân hàng câu hỏi, tạo đề từ tài liệu bằng Gemini, làm bài và chấm điểm, giám sát, xác minh thẻ/khuôn mặt, AI Support và lớp học LiveKit.

UI dùng Modern Academic, navbar/sidebar `#006D77`, light/dark mode và responsive. API và PostgreSQL là nguồn dữ liệu nghiệp vụ; frontend không chuyển sang dữ liệu mẫu khi API lỗi.

## Kiến trúc

```text
Next.js / React ── REST + WebSocket ── FastAPI ── PostgreSQL / Alembic
                                     ├─ Gemini (server credentials)
                                     ├─ YuNet + SFace (local ONNX)
                                     ├─ Tesseract worker (local OCR)
                                     ├─ protected/private media storage
                                     └─ LiveKit SFU + signed webhook
```

- Frontend: Next.js 15.5.28, React 18, TypeScript, CSS/Tailwind, LiveKit client.
- Backend: Python/FastAPI, SQLAlchemy, PostgreSQL, JWT/HttpOnly cookies.
- Điểm chính thức lưu trong `exam_attempts`; Student Result, Teacher Results và Reports đọc cùng dữ liệu này. Tự luận chờ giảng viên chấm; không tạo điểm giả.
- API kiểm tra user còn hoạt động, role trong database và quyền sở hữu/ghi danh. Guard frontend dùng phiên được xác nhận bởi `/auth/me`; không dùng JWT chưa xác minh trong middleware làm quyết định phân quyền.

## Thiết lập local

Đã kiểm tra trên Windows, Python 3.12, Node 24 và PostgreSQL. Cần Node 22+ và PostgreSQL 14+ cho môi trường mới; camera cần localhost hoặc HTTPS.

```powershell
npm ci
Copy-Item .env.example .env.local
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Sửa `backend/.env`: `DATABASE_URL` trỏ tới database riêng đã tạo; `JWT_SECRET` là giá trị ngẫu nhiên riêng, tối thiểu 32 ký tự. Không dùng giá trị trong template. Có thể tự tạo bằng `secrets.token_urlsafe(48)`. Không đưa key, password, token vào source/docs/frontend.

Các biến chính:

| Biến | Mục đích |
| --- | --- |
| `DATABASE_URL` | PostgreSQL, chỉ backend |
| `JWT_SECRET` | Khóa ký phiên, chỉ backend |
| `ENVIRONMENT` | `development` local; `production` khi triển khai |
| `COOKIE_SECURE` | `false` chỉ cho local HTTP; production phải secure/HTTPS |
| `CORS_ORIGINS` | JSON array các origin chính xác, local `["http://localhost:3000"]` |
| `NEXT_PUBLIC_API_URL` | URL backend không kèm `/api/v1`, đặt trong `.env.local` |
| `QUESTION_GENERATION_BASE_URL` / `QUESTION_GENERATION_API_KEY` | Kết nối Gemini tương thích OpenAI, chỉ backend |
| `QUESTION_GENERATION_MODEL` | Giữ model Gemini của môi trường hiện tại |
| `SUPPORT_ASSISTANT_MODEL` | Override model cho Support, dùng chung kết nối/key |
| `QUESTION_GENERATION_SUPPORTS_VISION` | Chỉ bật với model đã kiểm tra nhận ảnh |
| `LIVEKIT_URL` / `LIVEKIT_API_URL` | URL browser WSS và URL API nội bộ của SFU |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Chỉ backend/SFU |
| `STUDENT_CARD_OCR_AUTOSTART` | `true` khi OCR đã provision; `false` cho unit tests |

Production từ chối khởi động nếu JWT yếu, cookie bị ép insecure hoặc CORS wildcard. `.env` local hiện tại vẫn là cấu hình phát triển, cần cấu hình production riêng.

## Migration và chạy

Từ `backend/`, với database rỗng:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current
.\.venv\Scripts\python.exe -m alembic check
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Head: `0022_support_session_lifecycle`. Database legacy đã có bảng nhưng chưa có `alembic_version` cần kiểm tra/tiếp nhận bằng `python -m scripts.migrate_identity` trước; không tự stamp head hoặc import lại `schema.sql` lên database có dữ liệu. Sao lưu trước khi nâng cấp môi trường đang sử dụng.

Từ thư mục gốc, terminal khác:

```powershell
npm run dev
# Diagnostic fallback with the previous bundler:
npm run dev:webpack
# Hoặc bản production local:
npm run build
npm run start -- -p 3000
```

Frontend: `http://localhost:3000`; API: `http://localhost:8000/api/v1`; Swagger: `http://localhost:8000/docs`.

`npm run dev` dùng Turbopack trên Next.js 15.5.28 hiện tại; lần mở route đầu vẫn có bước compile. Đánh giá độ trễ sử dụng thực tế bằng `npm run build` rồi `npm run start`. Tailwind chỉ quét source frontend để thay đổi backend, tài liệu và artifacts không làm phát sinh quét không cần thiết.

Backend ở môi trường development có `Server-Timing` và log request trên 500 ms theo route template, tổng thời gian, thời gian/số truy vấn DB; không log SQL, payload hay thông tin đăng nhập. `ENVIRONMENT=production` tắt instrumentation này. Số đo trước/sau, cách tái hiện và giới hạn nằm trong [performance audit](docs/performance-audit.md).

## Gemini

Giữ provider/model trong `backend/.env`; không có key trong biến `NEXT_PUBLIC_*`. Probe thật tiêu thụ quota:

```powershell
# Trong backend/
.\.venv\Scripts\python.exe -m scripts.check_ai_provider --probe
$env:RUN_REAL_AI_TESTS='1'
.\.venv\Scripts\python.exe -m scripts.test_ai_live
```

Tài liệu → extraction/chunk/source mapping → draft Gemini → người dùng review/rating → import lựa chọn. Không auto-import, không tạo câu hỏi giả khi provider lỗi. Đợt QA đã gọi Gemini thật qua cả Question Generation và Support, bao gồm DOCX/PDF có ảnh, source mapping, regenerate, review và explicit import. Transport dùng đủ thời gian chờ đã cấu hình, retry vẫn giới hạn trong deadline; xem [known limitations](docs/known-limitations.md).

## OCR và khuôn mặt

Từ `backend/`:

```powershell
.\.venv\Scripts\python.exe scripts/setup_face_models.py
python -m venv .venv-ocr
.\.venv-ocr\Scripts\python.exe -m pip install -r requirements-ocr.txt
.\.venv\Scripts\python.exe -m scripts.setup_student_card_ocr
```

OCR dùng Tesseract 5.5.2/tesserocr trong môi trường riêng, model Việt/Anh pin hash; không cài bộ OCR vào `.venv` API. Wheel OCR hiện pin cho Windows AMD64/Python 3.12; nền tảng khác cần libtesseract/Leptonica phù hợp và smoke test riêng.

Face dùng YuNet + SFace, cosine threshold **0.363**, không thay bằng mô hình khác. Sinh viên cần hồ sơ được Admin xác nhận, upload thẻ, xem preview rồi confirm. Chỉ active/latest reference đã lưu mới được dùng cho bài thi cần camera; preview không tự xác thực hồ sơ. Ảnh thẻ/face/document/recording/snapshot/report đều cần kiểm tra quyền; không mount private storage ra public.

Không có liveness/anti-spoofing; smoke test không chứng minh accuracy trên thẻ → webcam. Xem [setup chi tiết](docs/SETUP.md) và [face analysis](docs/FACE_VERIFICATION_ANALYSIS.md).

## Realtime / LiveKit

Local Windows: `./scripts/start-classroom-sfu.ps1` hoặc `npm run dev:sfu`. Script provisioning có thể tạo/cập nhật các biến LIVEKIT trong `.env`; xem [online classroom](docs/online-classroom.md). API phải chạy sau khi cấu hình đã sẵn sàng.

Teacher tạo/start phòng đúng lớp; Student được ghi danh mới nhận token. SFU, URL browser, credentials và webhook phải khớp. Nhiều máy cần HTTPS/WSS, địa chỉ SFU truy cập được, firewall/ICE/TURN và webhook; localhost không phục vụ người dùng ở máy khác. Chat trong Live Class là data channel, không lưu lịch sử sau refresh.

## Kiểm thử

Frontend, từ gốc:

```powershell
npx tsc --noEmit
npm run lint
npm run build
npm audit --omit=dev
$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'
$env:PLAYWRIGHT_CHANNEL='chrome'
$env:PLAYWRIGHT_APP_ENV='production' # khi đang chạy npm start
$env:RELEASE_REAL_E2E='0'
$env:CLASSROOM_REAL_E2E='0'
$env:SUPPORT_CHAT_LIVE_E2E='0'
npx playwright test --workers=1
```

Nếu không dùng Chrome, cài browser Playwright và bỏ `PLAYWRIGHT_CHANNEL`. UI regression dùng fixture API có kiểm soát; không đồng nghĩa đã gọi provider/SFU thật. Hai bộ opt-in dưới đây dùng dịch vụ thật.

Backend acceptance cần database QA riêng; helper không sửa connection string trong `.env`:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts/release_qa_runtime.py prepare
.\.venv\Scripts\python.exe scripts/release_qa_runtime.py run -- python -m alembic upgrade head
$env:RUN_RELEASE_POSTGRES='1'
$env:IDENTITY_TEST_POSTGRES='1'
$env:CARD_PROFILE_TEST_POSTGRES='1'
$env:AVATAR_TEST_POSTGRES='1'
$env:QUALITY_RATING_TEST_POSTGRES='1'
$env:RUN_SETTINGS_POSTGRES_TESTS='1'
$env:SUPPORT_LIFECYCLE_TEST_POSTGRES='1'
.\.venv\Scripts\python.exe scripts/release_qa_runtime.py run -- python -m unittest discover -s tests -v
# OCR thực, sau khi provision:
$env:RUN_LOCAL_OCR_SMOKE='1'
.\.venv\Scripts\python.exe scripts/release_qa_runtime.py run -- python -m unittest tests.test_student_card_ocr.LocalOCRSmoke tests.test_student_card_class.RealClassEngineTests -v
```

Một số test vẫn opt-in theo model/ảnh private; đọc lý do skip trong log. Không chạy destructive integration trên database đang sử dụng.

## Dữ liệu và kịch bản DEMO

```powershell
# Trong backend/, sau prepare + upgrade của QA DB:
.\.venv\Scripts\python.exe scripts/release_qa_runtime.py run -- python -m scripts.seed_release_demo
$env:RELEASE_QA_OCR_AUTOSTART='true' # sau provision OCR, nếu demo upload thẻ thật
.\.venv\Scripts\python.exe scripts/release_qa_runtime.py run -- python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Ba account `demo-admin@example.com`, `demo-teacher@example.com`, `demo-student@example.com` có password sinh ngẫu nhiên trong **`backend/private/release-qa/demo-accounts.json`**, đã ignore. Seed chỉ chạy trên QA DB có tên được helper tạo. Bao gồm lớp, bank, ba đề, một attempt đã chấm 3.5/4, notification, support conversation và lịch Live Class. Không giả lập thẻ/face VERIFIED. Không dùng tài khoản seed cũ hoặc public password trong production.

Browser acceptance thật, từ gốc khi QA API + frontend đang chạy:

```powershell
$env:RELEASE_REAL_E2E='1'
npx playwright test tests/e2e/release-live.spec.ts --workers=1
# SFU thật + fixture riêng; chỉ seed một lần nếu file chưa tồn tại:
$env:CLASSROOM_FIXTURE_PATH=Join-Path (Get-Location).Path 'backend/private/release-qa/classroom-e2e.json'
Push-Location backend
if (!(Test-Path -LiteralPath $env:CLASSROOM_FIXTURE_PATH)) {
  .\.venv\Scripts\python.exe scripts/release_qa_runtime.py run -- python -m scripts.classroom_e2e_fixture
}
Pop-Location
$env:RELEASE_REAL_E2E='0'
$env:CLASSROOM_REAL_E2E='1'
$env:CLASSROOM_RELEASE_QA='1' # refresh fixture tokens through the isolated QA runtime
npx playwright test tests/e2e/live-classroom.spec.ts --workers=1
# Support UI với 3 role, PostgreSQL/REST/WebSocket thật; actors tự dọn sau test:
$env:CLASSROOM_REAL_E2E='0'
$env:SUPPORT_CHAT_LIVE_E2E='1'
$env:SUPPORT_CHAT_RELEASE_QA='1'
npx playwright test tests/e2e/support-chat.spec.ts --workers=1
```

[Demo 10–15 phút](docs/demo-script.md) · [Release checklist](docs/release-checklist.md) · [Known limitations](docs/known-limitations.md).

Private biometric data, uploads, local credentials và QA artifacts phải được giữ ngoài source distribution. Workspace hiện không có Git metadata; kiểm tra secret scan không thay thế kiểm tra lịch sử commit trước khi publish.
