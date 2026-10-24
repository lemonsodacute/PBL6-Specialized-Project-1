# Face Verification 1:1 — phân tích cho PBL6

Nguồn/code/model được kiểm tra ngày **02/10/2026**; báo cáo hoàn tất ngày **03/10/2026, Asia/Saigon**. Phạm vi: ảnh thẻ sinh viên đối chiếu với một ảnh webcam trước kỳ thi. Không mở rộng sang identification, giám sát nhiều người, gaze, emotion, pose hoặc liveness.

**Đề xuất: tiếp tục dùng YuNet + SFace trên FastAPI, bổ sung nguồn ảnh thẻ đáng tin cậy, lưu embedding và hiệu chỉnh ngưỡng.** Repository đã có stack này cùng luồng kiểm tra quyền vào thi. Chưa có bằng chứng trên dữ liệu nội bộ để biện minh cho việc thay bằng ArcFace. ArcFace là ứng viên benchmark nâng cấp, với điều kiện quyền sử dụng pretrained weights phù hợp.

Đã đọc code trước khi nghiên cứu model. Trong đợt này chỉ tạo báo cáo và script benchmark độc lập; không sửa production code, migration, dependency hoặc dữ liệu ứng dụng. Những mục đánh dấu CREATE/MODIFY bên dưới là **kế hoạch**, không phải thay đổi đã triển khai.

**Cập nhật Phase 1 (03/10/2026):** sau đợt phân tích, theo yêu cầu triển khai riêng, service `FaceEngine` đã được chuẩn hóa với `extract_embedding(image_bytes)`, `compare_embeddings(a, b)` và `verify_faces(reference_image, probe_image, threshold)`. Cả API và benchmark SFace tái sử dụng service này. Các mã lỗi hiện tại là `NO_FACE_DETECTED`, `MULTIPLE_FACES_DETECTED`, `FACE_TOO_SMALL`, `INVALID_IMAGE`, `MODEL_ERROR`; quality gates khác vẫn giữ. Threshold cấu hình không đổi, có TODO calibration. Phần mô tả kiến trúc/roadmap bên dưới ghi nhận thời điểm phân tích; Phase 1 chưa đổi DB, auth, frontend hay enrollment ba ảnh. Bộ test sau final review: 47 test pass; benchmark self-test và model smoke cũng pass, không phải phép đo accuracy trên người thật.

## Phase 1 — final review (03/10/2026)

Đã review sáu file được chỉ định, sửa giới hạn trong Phase 1 và kiểm thử lại. **47 tests passed; regression PASS trong phạm vi suite hiện có.** Chưa triển khai Phase 2; không sửa DB, auth, tạo attempt, frontend hoặc dependencies trong lượt final review.

**Giới hạn đối chiếu:** workspace `D:/ChauAnh/PBL6 new` không có `.git`; Git báo `not a git repository`. Vì chưa có baseline trước Phase 1, không thể xác nhận toàn bộ diff lịch sử hoặc số dòng +137/-38 đã báo trước đó. Đã lưu snapshot sáu file trước khi sửa để kiểm tra chính xác delta của lượt final review. Không coi snapshot này là baseline trước Phase 1.

**Final architecture / preprocessing contract**

```text
JPEG/PNG/WEBP bytes
  → Pillow decode + EXIF transpose + RGB, cạnh dài ≤1280
  → uint8 BGR (H, W, 3)
  → YuNet.setInputSize((W, H)) + detect
  → đúng một bbox ≥80 px mỗi chiều + 5 landmarks
  → SFace.alignCrop(BGR image, nguyên row YuNet) → uint8 BGR 112×112
  → kiểm tra tối/mờ
  → SFace.feature → float32 (1, 128), chưa L2-normalize
  → validate + L2 normalize → float32 ndarray (128,)
  → cosine với từng reference → median ba score ≥ threshold config
```

Decoder giữ giới hạn 8 MiB, tối đa 16 MP và mỗi chiều nguồn ít nhất 160 px. YuNet giữ score threshold 0.85, NMS 0.3, top-k 5000. Row có bbox `[0:4]`, landmarks `[4:14]`, confidence `[14]`; thứ tự landmarks: mắt phải, mắt trái, mũi, mép miệng phải, mép miệng trái theo [OpenCV face.hpp 4.14](https://github.com/opencv/opencv/blob/4.14.0/modules/objdetect/include/opencv2/objdetect/face.hpp). Không tự crop bbox trước alignment hoặc đảo thứ tự landmarks.

Đã đọc [implementation SFace 4.14](https://github.com/opencv/opencv/blob/4.14.0/modules/objdetect/src/face_recognize.cpp): `alignCrop` warp về 112×112; `feature` dùng `blobFromImage` với scale=1, mean=0, swapRB=true rồi forward. `feature` không gọi normalize; `match` mới normalize hai feature. Service truyền BGR uint8, không chia 255 hoặc áp `(x-127.5)/127.5`, và không gọi `match` sau khi normalize.

Experiment local với model hiện hữu và pixels tổng hợp: crop `(112,112,3)` uint8; feature `(1,128)` float32 có norm **4.8565745**; service output `(128,)` float32 có norm **1.0**. Cosine service **0.7617079373**, OpenCV `match` **0.7617079684** trên cùng hai feature (sai khác khoảng 3.1e-8 do số thực). Đây là kiểm chứng preprocessing/contract, không phải accuracy trên người thật.

**Public function contracts**

| Function | Contract |
|---|---|
| `extract_embedding(image)` | Nhận bytes ảnh mã hóa; trả `np.ndarray`, shape chính xác `(128,)`, float32, hữu hạn, norm≈1, sở hữu buffer riêng. Không re-encode JPEG. |
| `compare_embeddings(a, b)` | Hai vector thực shape chính xác `(128,)`, hữu hạn và khác zero; chấp nhận vector chưa chuẩn hóa. Trả Python float cosine trong `[-1,1]`; không load model, không sửa input. Scaling trước norm tránh overflow/underflow, zero bị từ chối trước phép chia. |
| `verify_faces(reference_image, probe_image, threshold)` | Hai ảnh mã hóa; threshold số thực hữu hạn thuộc `[-1,1]`, không nhận bool; trả `{'matched': similarity >= threshold, 'similarity': float}`. Threshold bool/NaN/Inf/ngoài khoảng gây `ValueError`. Lỗi extraction được truyền nguyên trạng. |

Extraction normalize đúng một lần. Comparison dùng chung helper normalize để giữ contract nhận cả vector chưa chuẩn hóa và hiệu chỉnh sai số float32; đây là công việc cần cho cosine tổng quát, không phải preprocessing model lần hai. Không thêm nhánh “assume normalized”, tolerance shortcut hoặc hàm so sánh riêng cho API/benchmark.

**Production changes và mức độ abstraction**

- `backend/app/services/face_recognition.py`: một pipeline decode/detect/align/feature dùng chung; `extract()` giữ `(embedding, sanitized JPEG)`, `similarity()` giữ alias tương thích. Final review sửa khởi tạo engine đồng thời, kiểm tra shape output SFace và dtype crop. Các wrapper public, compatibility aliases và helper recognition dùng lại cho smoke không có nhánh test-specific; không thêm framework/layer mới.
- `backend/app/api/v1/identity.py`: reference dùng extraction-only, probe vẫn tạo JPEG để lưu; so sánh qua service chung. Final review chỉ thu hẹp catch gắn nhãn ảnh enrollment từ `Exception` thành `HTTPException`.
- `backend/scripts/benchmark_face_verification.py`: SFace adapter gọi `FaceEngine.extract_embedding` / `compare_embeddings`; recognition-only smoke gọi helper chung dưới DNN lock. Final review không cần sửa script. ArcFace adapter thử nghiệm đã có là pipeline khác, không phải implementation SFace thứ hai.

Import benchmark không import `app`/OpenCV, load model, sửa `sys.path`, khởi động API hoặc đọc config DB; test subprocess đã xác nhận. Chỉ khi khởi tạo adapter CLI mới thiết lập backend import path và OpenCV thread count. Production không import benchmark. Benchmark phân loại lỗi ảnh để báo cáo; MODEL_ERROR dừng run, không bị biến thành ảnh bị loại rồi tiếp tục.

**Error contract**

| Code | HTTP | Điều kiện / layer |
|---|---:|---|
| `NO_FACE_DETECTED` | 422 | Detection trả `None` hoặc zero faces. |
| `MULTIPLE_FACES_DETECTED` | 422 | Detection có hơn một mặt; không tự chọn mặt lớn nhất. |
| `FACE_TOO_SMALL` | 422 | Bbox có một chiều <80 px sau resize. |
| `INVALID_IMAGE` | 422 | Decode: dữ liệu trống/sai kiểu/hỏng, format không hỗ trợ, kích thước nguồn không hợp lệ. |
| `MODEL_ERROR` | 503 | Thiếu dependency/model, model load/inference `cv2.error`, bbox/landmarks/crop/output feature không hợp lệ; feature zero/NaN/Inf. |
| `INVALID_EMBEDDING` | 422 | Caller truyền vector sai chiều, complex, zero, NaN/Inf vào comparison. |
| `IMAGE_TOO_LARGE` | 413 | Upload/decode vượt 8 MiB. |
| `INVALID_IMAGE_TYPE` | 422 | MIME upload không thuộc JPEG/PNG/WEBP. |
| `FACE_TOO_DARK` / `FACE_TOO_BLURRY` | 422 | Crop mean gray <35 / Laplacian variance <15. |

OpenCV `detect` trả `faces=None`, `alignCrop=None`, `feature=None` đều có đường xử lý rõ. Source factory OpenCV trả instance hoặc ném lỗi load, không có nhánh trả None thành công. Programming errors không bị đổi thành MODEL_ERROR; HTTP boundary trả INTERNAL_ERROR/500. Hai `except Exception` ở transaction vẫn cần để rollback/cleanup và **re-raise**; cleanup unlink lỗi được log. Không swallow lỗi inference hoặc DB.

**Issues found / fixes**

1. `lru_cache` không bảo đảm khởi tạo đúng một lần khi cold requests trùng nhau, theo [Python 3.12 functools](https://docs.python.org/3.12/library/functools.html#functools.lru_cache). Đã tái hiện 4 callers tạo 4 engine. Sửa thành một cached instance dưới initialization lock; load lỗi không cache, lần sau retry được. DNN lock giữ xuyên `setInputSize → detect → alignCrop → feature → copy/normalize`, tránh chia sẻ buffer giữa requests.
2. `.reshape(-1)` chấp nhận sai shape như `(2,64)`/`(128,1)`. Nay kiểm tra raw shape `(1,128)` trước khi lấy vector. Bổ sung kiểm tra crop uint8; crop None/sai shape/sai dtype báo MODEL_ERROR.
3. Catch gắn nhãn enrollment quá rộng: thu hẹp về HTTPException, giữ thông điệp theo góc chụp. Các catch phục vụ rollback vẫn giữ và re-raise.
4. Coverage thiếu median ties/equality/rounding và concurrent first load. Bổ sung behavior tests; không thêm test chỉ đếm private calls để lấy coverage. Các assertion pipeline hiện hữu được giữ vì kiểm tra màu, landmark order, model buffer và số lượt inference thực sự ảnh hưởng correctness.

**Compatibility**

API hiện tại vẫn dùng ba ảnh đăng ký front/left/right từ private hoặc legacy storage, trích lại ba reference cùng probe mỗi lần; median của ba cosine score, `>= FACE_MATCH_THRESHOLD` (default 0.363). Quyết định dùng score đầy đủ trước khi round 4 chữ số để trả/lưu. Giữ success schema, consent, quality gates, auth/ownership, exam assignment, attempt gate, TTL 15 phút và resume behavior; final review không sửa các phần này.

Không khẳng định tương thích 100% với mọi client trước Phase 1: tài liệu phân tích ghi mã cũ `FACE_NOT_FOUND`, `MULTIPLE_FACES`, `EMPTY_IMAGE`, `FACE_MODEL_UNAVAILABLE`; Phase 1 đã chuẩn hóa lần lượt thành `NO_FACE_DETECTED`, `MULTIPLE_FACES_DETECTED`, `INVALID_IMAGE`, `MODEL_ERROR`. Frontend hiện tại hiển thị `message`, không switch theo các mã này. Client ngoài dự án nếu phụ thuộc code cũ cần migration; chưa có baseline Git để kiểm chứng lịch sử ngoài bằng chứng này. Lượt final review không đổi thêm error code.

**Tests / quality checks**

- Baseline nhận được: 41 tests pass. Sau sửa: **47 tests pass**, gồm 6 test mới và mở rộng các test có sẵn; DB dùng mocks, không gọi DB thật.
- `backend/.venv/Scripts/python.exe -m unittest discover -s tests -v` (cwd `backend`): PASS.
- Benchmark `--self-test`: PASS; `--smoke --threads 1`: PASS (20 lượt recognition tổng hợp, p50≈32.9 ms, p95≈45.6 ms; không phải latency API).
- `python -m compileall -q backend/app backend/scripts backend/tests`: PASS; whitespace check trên delta sáu file: PASS.
- Không có ruff/black/mypy/pyright/flake8 trong backend env hoặc cấu hình project; không cài mới. Suite có StarletteDeprecationWarning về httpx hiện hữu; không đổi dependency trong Phase 1.
- Kiểm thử kiểm tra raw SFace shape, normalized 128D finite, color/EXIF, no/multiple/small face, ảnh lỗi, malformed/NaN/Inf/zero embeddings, cosine, threshold trên/dưới/bằng, median permutations/ties/rounding, error HTTP, retry load và import benchmark.

**Remaining TODOs — các phase sau, chưa triển khai:** trusted student-card reference; embedding persistence; model/preprocessing version; threshold calibration trên dữ liệu thật; kiểm thử PostgreSQL/concurrency và accuracy trên dữ liệu được phép sử dụng.

**Final diff summary:** chỉ có thể tính delta final review so với snapshot đầu lượt, chưa có full Phase 1 Git diff. 5 file sửa, +205/-19 dòng; benchmark không thay đổi trong lượt này.

## A. Current architecture

### A1. Stack và các điểm tích hợp thực tế

| Thành phần | Hiện trạng từ repository | Bằng chứng |
|---|---|---|
| Frontend | Next.js 14 App Router, React 18, TypeScript, Tailwind 4; `app/` nằm ngay tại root | [package.json](../package.json), [app/](../app/) |
| Backend | Python, FastAPI, Uvicorn; SQLAlchemy 2, Alembic, PostgreSQL | [requirements.txt](../backend/requirements.txt), [main.py](../backend/app/main.py), [entities.py](../backend/app/models/entities.py) |
| Giao tiếp | Browser gọi trực tiếp `${NEXT_PUBLIC_API_URL}/api/v1`; `fetch`, JSON và multipart, `credentials: include`, Bearer token nếu có | [lib/api.ts](../lib/api.ts) |
| Auth | JWT; backend kiểm tra chữ ký, user đang hoạt động, role; cookie HttpOnly và access token trong sessionStorage; refresh qua cookie | [deps.py](../backend/app/api/deps.py), [auth.py](../backend/app/api/v1/auth.py), [AuthContext.tsx](../components/auth/AuthContext.tsx) |
| Webcam xác minh | `getUserMedia`, video mong muốn 1280×720; canvas giới hạn cạnh dài 1280, JPEG quality 0.9; kiểm tra video/track sẵn sàng | [useIdentityCamera.ts](../components/identity/useIdentityCamera.ts), [CameraPreview.tsx](../components/identity/CameraPreview.tsx) |
| UI đăng ký | Chụp ba góc nhìn thẳng/trái/phải; đăng ký, thử đối chiếu, xóa | [student/identity/page.tsx](../app/student/identity/page.tsx) |
| UI trước thi | Kiểm tra thiết bị → xác minh → gọi tạo attempt | [verify/page.tsx](../app/student/exams/[examId]/verify/page.tsx) |
| AI có sẵn | OpenCV headless, NumPy, Pillow; hai model ONNX YuNet/SFace, runtime **OpenCV DNN** | [face_recognition.py](../backend/app/services/face_recognition.py), [models/face/](../backend/models/face/) |
| AI chưa thấy trong khai báo dependency | TensorFlow.js, ONNX Runtime, MediaPipe, InsightFace, PyTorch, TensorFlow | `package.json`, `backend/requirements*.txt` |
| Storage sinh trắc | JPEG riêng ở `backend/private/identity`; đường dẫn trong PostgreSQL; không public; legacy `/uploads/identity` cũng bị chặn | [identity.py](../backend/app/api/v1/identity.py), [main.py](../backend/app/main.py) |
| Deploy | Có hướng dẫn local Next.js + API cổng 8000 + PostgreSQL; chưa thấy Dockerfile/Compose hay cấu hình nhà cung cấp hosting | [SETUP.md](SETUP.md), [next.config.mjs](../next.config.mjs) |

Môi trường Python hiện hữu `backend/.venv` chạy được Python 3.12.10, OpenCV headless 4.14.0.94, NumPy 2.5.3, Pillow 12.3.0, FastAPI 0.141.1. Đây là phiên bản **đang cài trên máy**, khác với khoảng phiên bản trong requirements; không coi là lockfile. Trong môi trường này chưa có `insightface`, `onnxruntime`, `torch`, `tensorflow`, `psutil`. Không có bước cài đặt nào được thực hiện.

Webcam còn được dùng tại `app/student/attempts/[id]/page.tsx`, `components/proctoring/StandaloneProctoringTab.tsx`, `components/proctoring/CallPanel.tsx`, trang thi vấn đáp. Các luồng đó không cần thay đổi để xây dựng verification 1:1 này.

### A2. Dữ liệu và logic hiện có

`users.id` là UUID được dùng làm `student_id`; `users` có họ tên/email/role/avatar. Chưa thấy trường ảnh thẻ đã xác nhận hoặc mã sinh viên riêng trong model User. **Không được coi avatar là ảnh thẻ tin cậy.** Đây là kết luận từ schema/code, không phải kết quả truy vấn dữ liệu cá nhân trong database.

`student_identities` có `front_image_path`, `left_image_path`, `right_image_path`, status, consent và timestamps. **Chưa có embedding/model version/card image.** `identity_verifications` lưu student/exam, ảnh xác minh, status, score `Numeric(5,4)`, failure reason và timestamp.

Luồng hiện tại:

```text
Login → cookie JWT + access token
    → GET /api/v1/identity/status
    → nếu chưa đăng ký: POST /identity/enroll (front, left, right, consent)
    → POST /identity/exams/{exam_id}/verify (image, consent)
         ├─ xác thực student và bài thi được giao
         ├─ trích embedding ảnh webcam mới
         ├─ đọc lại 3 ảnh đăng ký và trích lại cả 3 embedding
         ├─ median của 3 cosine score ≥ FACE_MATCH_THRESHOLD
         └─ lưu IdentityVerification
    → POST /api/v1/attempts
         └─ backend kiểm tra kết quả gần nhất của đúng student + exam
```

Các chi tiết cần giữ khi nâng cấp:

- Bài thi `require_camera=true` mới bắt buộc verification. Nếu nghiệp vụ yêu cầu mọi bài thi xác minh, nên thêm cờ `require_face_verification` độc lập; hiện chưa có cờ đó.
- Khi **tạo attempt mới**, backend yêu cầu kết quả `verified`, không quá 15 phút, không ở tương lai, và được tạo sau lần cập nhật identity gần nhất. Resume attempt đang làm có nhánh riêng trả về trước kiểm tra này.
- `/identity/check` chỉ thử đối chiếu, không cấp quyền vào thi. Frontend `verified=true` hoặc localStorage không thay thế kiểm tra phía server.
- Kết quả hiện tại là `verified`, `score`, `threshold`, `status`, `liveness_checked=false`, bọc trong `{data, meta}`. Lỗi được bọc trong `{error:{code,message,details}}`.
- `FaceEngine` được cache theo process, có `Lock` bảo vệ detector/recognizer; route đưa inference vào threadpool. Mỗi lần verify vẫn phải xử lý **bốn ảnh**. Lock tuần tự hóa phần DNN trong một worker.
- Đăng ký hiện tự đánh dấu `verified` nếu ba ảnh nhất quán. Điều đó chứng minh ba ảnh giống nhau theo model, **chưa chứng minh ảnh đăng ký thuộc hồ sơ sinh viên do nhà trường xác nhận**.

### A3. Khoảng cách với yêu cầu mới

| Yêu cầu | Hiện có | Cần bổ sung |
|---|---|---|
| Ảnh thẻ ↔ webcam | Webcam đăng ký ↔ webcam thi | Card/reference được gắn với student và xác nhận nguồn |
| 1:1 | Có, một tài khoản với dữ liệu của chính nó | Giữ 1:1; không tìm kiếm toàn bộ sinh viên |
| Detection/alignment/embedding | Đã có YuNet/SFace | Điều chỉnh quality/ROI cho ảnh nguyên thẻ |
| Lưu embedding | Không | Template có version, fingerprint, nguồn ảnh |
| Threshold theo dữ liệu trường | Không; mặc định 0.363 | Calibration riêng cho card ↔ webcam |
| Vận hành nhiều lượt đồng thời | Threadpool + một lock/worker | Benchmark tải, bounded concurrency, quản lý worker/RAM |

## B. Candidate models

### B1. Phân biệt đúng thành phần

**Detector** tìm bounding box và có thể trả landmarks. **Alignment** biến đổi ảnh theo landmarks để đưa mặt về cùng hệ tọa độ. **Recognition/embedding model** tạo vector đặc trưng; trong flow này đó là cùng một mạng, không phải hai model nối tiếp. **Verification** so sánh hai vector và áp dụng policy.

ArcFace là phương pháp/loss huấn luyện và họ model, không tự cung cấp detector. InsightFace là hệ sinh thái triển khai/model zoo. `buffalo_l`/`buffalo_s` là gói nhiều model; `w600k_r50.onnx` là recognizer R50 trong họ đó. SFace cũng là phương pháp nhận diện; ở đây chọn đúng artifact ONNX của OpenCV Zoo.

### B2. Chất lượng, thành phần và dung lượng

Các accuracy dưới đây là **số công bố ở benchmark ngoài**, không phải accuracy ảnh thẻ của project và không phải phép so sánh cùng một pipeline. “Chưa đo” có nghĩa chưa có số liệu đáng tin cậy cho máy/dataset này.

| Lựa chọn | Detector / alignment / embedding | Chất lượng tham khảo | Dung lượng và mức phù hợp |
|---|---|---|---|
| ArcFace / InsightFace nói chung | Chọn detector riêng; alignment 5 điểm; nhiều backbone | Không có một accuracy đại diện mọi ArcFace | Phải chỉ rõ checkpoint, preprocessing, license |
| **buffalo_l** | SCRFD-10GF; 5 điểm dùng cho recognition; R50 WebFace600K, 512D | LFW 99.83%; CFP-FP 99.33%; AgeDB-30 98.23% | Full pack công bố 326 MB; nhiều module không cần cho bài toán |
| **buffalo_s** | SCRFD-500MF; 5 điểm; MobileFaceNet WebFace600K, 512D | LFW 99.70%; CFP-FP 98.00%; AgeDB-30 96.58% | Full pack 159 MB; recognizer nhẹ hơn R50 |
| **w600k_r50** riêng | Chỉ recognizer 112×112, 512D; ghép YuNet hoặc SCRFD | Cùng recognizer họ buffalo_l, nhưng đổi detector không bảo đảm cùng kết quả end-to-end | Chưa đo file riêng tại máy; không lấy 326 MB của full pack làm kích thước recognizer |
| **YuNet + OpenCV SFace** | YuNet trả 5 điểm; `alignCrop`; SFace 128D | Tutorial công bố LFW 99.60%, CFP-FP 94.80%; Zoo có phép đánh giá 99.40% khác | Đã có: YuNet **232,589 B**, SFace **38,696,353 B**; tổng ~38.93 MB thập phân / 37.13 MiB |
| **face-api.js** | TinyFaceDetector/SSD + landmarks 68 điểm + ResNet kiểu dlib, 128D | README công bố LFW 99.38% | Recognizer quantized ~6.2 MB, chưa tính detector/landmarks/TFJS; tích hợp thêm stack JS |
| **Human / @vladmandic/human** | BlazeFace + xử lý xoay/mesh; mặc định FaceRes descriptor; nhiều model thay thế | Chưa tìm được đánh giá card/webcam cùng protocol với SFace/ArcFace | `faceres` weights khoảng 6.98 MB trong inventory; thêm detector/mesh/runtime; không phải một model ArcFace duy nhất |
| **FaceNet qua facenet-pytorch** | MTCNN + crop/standardization; InceptionResnetV1, 160×160, 512D | README: VGGFace2 LFW 99.65%; CASIA-Webface 99.05% | Chưa đo artifact riêng; thêm PyTorch/torchvision làm môi trường lớn hơn hiện tại |
| **TensorFlow.js FaceNet** | Phải chọn checkpoint và tự quản detector/alignment/conversion | Không có “FaceNet TFJS chính thức hiện hành” trong danh mục tfjs-models đã kiểm tra | Không chọn một bản convert ngẫu nhiên thiếu provenance để làm nền tảng |
| **buffalo_sc** | SCRFD-500MF + MBF, bỏ module phụ | Model zoo công bố cùng recognition accuracy buffalo_s | Full pack công bố 16 MB; hợp lý hơn buffalo_s nếu chỉ cần verification |
| **raccoon_s / raccoon_l** | Pack mới trong InsightFace 2.0; preprocessing khai báo qua manifest V2 | Chưa benchmark tại project; chưa đủ bằng chứng chọn thay SFace | ZIP chính thức lần lượt ~36.6 / 255.1 MB; đây là kích thước nén, không phải RAM |
| **AdaFace** | Recognition loss thích nghi chất lượng; cần detector/alignment riêng; pretrained dùng BGR | Nghiên cứu chú trọng ảnh chất lượng thấp | Chưa đo weights/runtime; ONNX export cần kiểm tra parity và nguồn weights |

Nguồn thông số InsightFace: [model zoo](https://github.com/deepinsight/insightface/blob/master/model_zoo/README.md). Nguồn SFace: [tutorial](https://docs.opencv.org/4.13.0/d0/dd4/tutorial_dnn_face.html), [Zoo SFace](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/README.md). Nguồn JS: [face-api.js](https://github.com/justadudewhohacks/face-api.js#face-recognition-model), [Human model inventory](https://raw.githubusercontent.com/vladmandic/human/main/models/models.json). Nguồn khác: [FaceNet PyTorch](https://github.com/timesler/facenet-pytorch), [TFJS model catalog](https://github.com/tensorflow/tfjs-models), [Raccoon guide](https://github.com/deepinsight/insightface/blob/master/python-package/docs/model_zoo.md), [release asset sizes](https://api.github.com/repos/deepinsight/insightface/releases/tags/model-zoo), [AdaFace](https://github.com/mk-minchul/AdaFace).

Không cần load landmark 106/68 điểm hay age/gender trong buffalo để làm alignment nhận diện 5 điểm. Nếu thử InsightFace thì chỉ bật detection/recognition hoặc load từng ONNX cần thiết; tổng dung lượng pack không đại diện RAM của cấu hình đó.

### B3. Runtime, tài nguyên, tích hợp

| Nhóm | CPU/RAM/latency dự kiến tương đối | GPU | Browser / ONNX | Backend và chi phí tích hợp |
|---|---|---|---|---|
| R50 / buffalo_l | Tải recognition lớn hơn MBF; RSS và latency thực phải đo | Không bắt buộc; có thể tăng throughput | ONNX có sẵn; web cần tự triển khai preprocessing/operator compatibility | FastAPI phù hợp nhưng cần ONNX Runtime và quản lý weights/license |
| buffalo_s/sc | CPU nhẹ hơn R50 về kiến trúc; full pack s vẫn chứa module thừa | Không bắt buộc | ONNX; sc có lợi về download | Thêm runtime; phù hợp ứng viên CPU thứ hai |
| **SFace + YuNet** | Đã đo smoke CPU phía dưới; RSS cao hơn kích thước file | Không bắt buộc | ONNX; chạy browser phải chuyển wrapper/preprocessing | **Ít thay đổi nhất**, đã chạy trong FastAPI |
| face-api.js | Download nhỏ; tốc độ phụ thuộc backend TFJS và thiết bị; giải nén weights/tensor làm RAM lớn hơn file | WebGL có thể dùng GPU máy sinh viên | Browser/Node tốt về API; không có ONNX trực tiếp trong flow gốc | Đưa inference vào Node/FE tạo thêm stack ngoài backend Python |
| Human | Tài nguyên phụ thuộc module bật; mesh/filter làm thêm công việc | CPU hoặc backend GPU của TFJS | Browser/Node; ONNX không phải runtime gốc | Nhiều tính năng thừa so với phạm vi; cần tắt module không dùng |
| FaceNet PyTorch / TFJS port | PyTorch runtime + MTCNN nhiều bước; phải đo RSS/latency | CPU chạy được; GPU tùy tải | PyTorch export ONNX có thể làm; TFJS port cần xác minh | Khó maintain hơn tái sử dụng OpenCV hiện có |
| Raccoon / AdaFace | Chưa đo; không suy ra từ chữ “mới” hoặc điểm paper | Tùy backbone/provider, không mặc định bắt buộc | Raccoon ONNX manifests; AdaFace cần checkpoint/export phù hợp | Chỉ shortlist nghiên cứu khi baseline không đạt |

Các nhận định “nhẹ/nặng” là suy luận từ backbone/phạm vi runtime, **không phải phép đo RAM/CPU%/ms**. Chưa chạy các model ngoài SFace vì không tự cài dependency hoặc tải weights. Không lấy latency GPU do tác giả công bố để ước lượng VPS CPU.

Với privacy và scale, kiến trúc triển khai quan trọng hơn tên model: tất cả lựa chọn chạy server đều nhận dữ liệu sinh trắc và cần kiểm soát truy cập; tất cả lựa chọn chạy browser đều có kết quả mà người dùng có thể sửa. Không có model trong bảng tự giải quyết độ tin cậy của client hoặc nguồn ảnh thẻ.

### B4. License và maintenance đã kiểm tra

| Lựa chọn | Code | Pretrained weights / production | Tín hiệu maintenance tại ngày kiểm tra |
|---|---|---|---|
| InsightFace, buffalo, w600k, raccoon | MIT | Weights do thư viện cung cấp: **non-commercial research only**, kể cả tải tay; liên hệ chủ sở hữu cho phạm vi khác. MIT của code không cấp quyền thay thế cho weights | Default branch có commit 09/09/2026; tài liệu đã có Python library 2.0/Raccoon; không dùng nhận định cũ rằng toàn bộ dự án dừng ở 0.7 |
| OpenCV / YuNet / SFace | OpenCV Apache-2.0 | Zoo tuyên bố **mọi file trong thư mục YuNet: MIT; SFace: Apache-2.0**. Hai license tương ứng cũng có trong project | Zoo có commit 28/05/2026; artifact SFace mang ngày 2021 không đồng nghĩa runtime bị bỏ |
| face-api.js | MIT | Recognizer có nguồn weights dlib; cần giữ provenance/license của đúng bản convert và kiểm tra detector/landmark riêng. Không suy diễn mọi weights đều MIT từ npm package | Release 0.22.2: 22/03/2020; default branch commit 22/04/2020; rủi ro bảo trì cao hơn |
| Human | MIT | Tài liệu nêu models kế thừa license từ nguồn gốc; model thay thế có thể mang hạn chế riêng. Không có một license weights chung để áp cho mọi cấu hình | npm 3.3.6 khi kiểm tra; default branch commit 13/12/2025; GitHub Releases và npm không đồng bộ phiên bản |
| facenet-pytorch | MIT | Weights chuyển từ FaceNet, VGGFace2/CASIA; chưa tìm đủ tuyên bố riêng để khẳng định quyền production của mọi checkpoint/dataset | PyPI 2.6.0 ngày 29/04/2024; default branch commit 02/08/2024; không ưu tiên thêm stack này |
| AdaFace | MIT | Repo có code/checkpoint nghiên cứu; cần làm rõ quyền của checkpoint cụ thể và dữ liệu huấn luyện trước khi chọn production | Default branch commit 10/06/2024; chưa đủ lợi thế tích hợp cho project |

Nguồn license: [InsightFace policy](https://github.com/deepinsight/insightface#license), [YuNet](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md#license), [SFace](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/README.md#license), [dlib model provenance](https://github.com/davisking/dlib-models), [Human credits/license inheritance](https://github.com/vladmandic/human/wiki/Models#credits), [FaceNet license](https://github.com/timesler/facenet-pytorch/blob/master/LICENSE.md), [AdaFace license](https://github.com/mk-minchul/AdaFace/blob/master/LICENSE).

Nguồn maintenance được đối chiếu qua GitHub API default-branch commits với `until=2026-10-02T16:59:59Z`: [InsightFace](https://api.github.com/repos/deepinsight/insightface/commits?per_page=1&until=2026-10-02T16:59:59Z), [Zoo](https://api.github.com/repos/opencv/opencv_zoo/commits?per_page=1&until=2026-10-02T16:59:59Z), [face-api.js](https://api.github.com/repos/justadudewhohacks/face-api.js/commits?per_page=1&until=2026-10-02T16:59:59Z), [Human](https://api.github.com/repos/vladmandic/human/commits?per_page=1&until=2026-10-02T16:59:59Z), [FaceNet](https://api.github.com/repos/timesler/facenet-pytorch/commits?per_page=1&until=2026-10-02T16:59:59Z), [AdaFace](https://api.github.com/repos/mk-minchul/AdaFace/commits?per_page=1&until=2026-10-02T16:59:59Z); phiên bản package từ [Human npm](https://registry.npmjs.org/@vladmandic/human/latest), [FaceNet PyPI](https://pypi.org/pypi/facenet-pytorch/json). Ngày commit chỉ là tín hiệu hoạt động, không bảo đảm support/security SLA.

Đồ án nghiên cứu phi thương mại có thể phù hợp phạm vi InsightFace công bố; **không mặc định việc nhà trường dùng cho kỳ thi thật là “research”**. Việc phân phối lại weights cần tuân theo điều kiện của artifact cụ thể.

### B5. Điều kiện ảnh thực tế

| Điều kiện | Kỳ vọng/giới hạn | Cách kiểm chứng và xử lý |
|---|---|---|
| Ảnh chân dung gốc / ảnh webcam rõ | SFace là baseline hợp lý; R50 là ứng viên tăng chất lượng | So FRR tại cùng FAR mục tiêu, không chỉ accuracy |
| Thẻ nguyên tấm, có chữ/logo | Khó khăn chính là mặt nhỏ và vùng crop; đổi recognizer không sửa được detector bỏ sót | Đo tỷ lệ detect/alignment thành công riêng với ảnh nguyên thẻ |
| Ánh sáng khác nhau | Các model có thể suy giảm; không có bảo đảm từ LFW | Thu webcam sáng thường/thiếu sáng/ngược sáng; ghi quality failures |
| Góc nhẹ / kính thường | Alignment giảm sai lệch hình học nhưng không khôi phục vùng bị che | Tập test có kính/không kính, góc nhẹ; không ép sinh viên bỏ kính nếu chưa có bằng chứng cần thiết |
| Webcam thấp, JPEG nén/crop sát | Mất chi tiết làm cả detector và embedding yếu | Báo FRR và rejection theo chất lượng; yêu cầu chụp lại nếu không đủ dữ liệu |
| Thẻ cũ / in rồi chụp / lóa | Domain gap đáng kể; không có số đo sẵn cho trường | Ưu tiên file portrait của hồ sơ nếu được phép; đánh giá riêng ảnh chụp thẻ |

Nhận định R50 đáng thử dựa trên benchmark công bố là **giả thuyết cần kiểm chứng**, không phải kết luận rằng nó sẽ tốt hơn trên sinh viên Việt Nam. Không dùng tạo nét bằng AI để “phục hồi” danh tính bị mất trong ảnh nhỏ.

## C. Recommended model

### C1. Recommended

- **Detector:** `face_detection_yunet_2023mar.onnx` đang có.
- **Recognition:** `face_recognition_sface_2021dec.onnx` đang có.
- **Alignment:** 5 landmarks, `cv2.FaceRecognizerSF.alignCrop`.
- **Runtime:** OpenCV DNN CPU trong FastAPI hiện tại.
- **Deployment:** server inference; FE chỉ capture/upload và hiển thị trạng thái.
- **Metric:** cosine trên embedding L2-normalized, threshold từ calibration card/webcam.

Lý do theo repository: API và UI đã có, Python/OpenCV đã được cài, weights có sẵn, inference CPU đã chạy, không cần thêm Node inference service hay TFJS. Mức thay đổi lớn nhất nằm ở **enrollment, template storage và calibration**, không phải thiếu model. License của hai artifact OpenCV Zoo rõ hơn các gói InsightFace pretrained.

Upstream có YuNet `2026may` cho input động/OpenCV 5.x; bản đó là re-export về shape, không phải bằng chứng tăng accuracy. Project đang dùng OpenCV `<5`, vì vậy giữ artifact `2023mar` và pin hash là lựa chọn ít rủi ro hơn. [Ghi chú upstream YuNet](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md).

### C2. Simpler Alternative và đường nâng cấp

**Simpler Alternative cho prototype:** cùng YuNet/SFace, giữ một ảnh thẻ đã xác nhận và trích lại cả card + webcam mỗi request. Không cần bảng template ban đầu, nhưng gấp đôi inference so với lưu embedding; khó scale và vẫn phải quản lý ảnh sinh trắc. Chỉ phù hợp kiểm chứng UI/pipeline quy mô nhỏ, vẫn cần calibration và gate phía server.

**Ứng viên nâng cấp chất lượng:** thử `w600k_r50` + YuNet để đo tác động recognizer trên cùng detector; sau đó mới thử SCRFD + R50 nếu lỗi đến từ detection. `buffalo_sc` là ứng viên nhẹ khi CPU/download quan trọng. Chỉ chuyển model nếu FRR tại FAR mục tiêu giảm đủ rõ trên tập test, tài nguyên phù hợp và quyền weights đã được làm rõ. Không tự động dùng fallback model sau mismatch vì sẽ thay đổi FAR của toàn hệ thống.

### C3. Preprocessing phải đúng artifact

Pipeline đề xuất:

```text
decode + kiểm tra file → EXIF orientation → RGB → BGR cho OpenCV
  → detect ở kích thước phù hợp → bbox + 5 landmarks
  → biến đổi similarity 2D → crop aligned 112×112
  → preprocessing đúng model → embedding → L2 normalize
```

| Chi tiết | SFace đã chọn | w600k-style ArcFace khi benchmark |
|---|---|---|
| Hình học | 5 điểm theo đúng thứ tự YuNet; warp 112×112 | 5 điểm theo template ArcFace 112×112 |
| Màu tại API ảnh OpenCV | BGR | BGR trước `blobFromImage` |
| Tensor đưa vào model | `float32`, NCHW, RGB; wrapper swap R/B | `float32`, NCHW, RGB; swap R/B |
| Normalization ngoài model | Wrapper SFace scale=1, mean=0: giá trị 0…255; **không tự chia 255 hoặc trừ 127.5** | Thường `(x−127.5)/127.5`; phải kiểm tra đúng checkpoint, có model đã chứa preprocessing trong graph |
| Đầu ra | 128D, sau đó L2 normalize | 512D với artifact đã chọn, sau đó L2 normalize |

Đối chiếu trực tiếp [OpenCV 4.14 `face_recognize.cpp`](https://github.com/opencv/opencv/blob/4.14.0/modules/objdetect/src/face_recognize.cpp) và [InsightFace ArcFace ONNX wrapper](https://github.com/deepinsight/insightface/blob/master/python-package/insightface/model_zoo/arcface_onnx.py). Không dùng normalization của ArcFace cho SFace. Resize toàn bộ thẻ thành 112×112 không thay thế alignment. Không chuyển grayscale/equalize mặc định cho hai model này chỉ vì library khác làm vậy.

Các quality gate hiện tại: ảnh tối đa 8 MiB, 16 MP, cạnh ngắn tối thiểu 160; thumbnail 1280; detector score 0.85; mặt tối thiểu 80 px; gray mean 35; Laplacian variance 15. Đây là **heuristic trong code hiện có**, chưa được xác thực cho thẻ. Detector score và quality gate không phải verification threshold. Đổi resize/ROI/quality cũng cần version và đánh giá lại tỷ lệ thất bại.

### C4. Xử lý nguyên thẻ sinh viên

1. Ưu tiên portrait gốc trong hồ sơ đã được xác nhận nếu có. Nếu dùng thẻ nguyên tấm, nhận ảnh đủ độ phân giải, sửa EXIF, kiểm tra decode/size trước.
2. Detect trên ảnh thẻ; có thể dùng một số scale đã định trước và map landmarks về ảnh gốc để crop. Tránh thumbnail toàn thẻ quá sớm làm mất chi tiết mặt. Đo false positive do logo/ảnh nền.
3. Với ảnh nghiêng, sửa orientation trước; alignment 5 điểm xử lý xoay mặt nhẹ. Thẻ bị phối cảnh mạnh nên yêu cầu chụp thẳng lại; hỗ trợ crop vùng portrait bởi người dùng/quản trị viên là lựa chọn đơn giản. Crop chỉ xác định ROI, không xác nhận người sở hữu.
4. Đúng một face candidate hợp lệ mới tạo template. Không tự chọn “mặt lớn nhất” khi còn nhiều mặt. Không detect được → `FACE_NOT_FOUND`; nhiều mặt → `MULTIPLE_FACES`.
5. Kiểm tra kích thước mặt **ở ảnh nguồn**, blur, ánh sáng, landmarks có đủ vùng nhìn thấy. Phóng to ảnh quá nhỏ không tạo lại chi tiết. Trường hợp không đạt phải đăng ký lại hoặc được nhân sự phụ trách hỗ trợ.

Đếm số mặt ở đây là kiểm tra đầu vào của verification; không triển khai tính năng phát hiện gian lận nhiều người trong video.

## D. Recommended architecture

### D1. Browser-side so với server-side

| Tiêu chí | Option A — browser inference | Option B — FastAPI inference |
|---|---|---|
| Tốc độ | Sau khi model đã cache có thể nhanh; lần đầu tải model/runtime, compile graph; laptop khác nhau | Thêm upload/network; cấu hình máy chủ ổn định, warm model |
| Download | SFace/YuNet ~39 MB weights cộng runtime; R50 lớn hơn; cache/version cần quản lý | Browser không tải weights |
| Compatibility | WASM là fallback CPU; WebGPU cần kiểm tra trình duyệt/driver/operators, không coi là luôn có | Browser chỉ cần camera và upload HTTPS |
| CPU/RAM | Chiếm tài nguyên máy sinh viên đồng thời với trang thi/webcam | Chiếm server; cần giới hạn concurrency và kiểm tra RSS mỗi worker |
| Privacy | Có thể giữ raw webcam local, nhưng reference/template phải có cách đến client hoặc vẫn gửi embedding lên server | Dữ liệu đi qua API và server; không cần gửi reference/embedding cho client |
| Kết quả bị can thiệp | Người dùng có thể đổi score/embedding/JS; gửi chữ ký do chính JS tạo không giải quyết được | Server tự tính, tự lưu kết quả và kiểm tra gate |
| Bandwidth | Tải model ban đầu, sau đó giảm upload nếu tính local | Mỗi verify gửi một JPEG multipart; đo bytes thực, tránh base64 tăng payload |
| Scale | Tản inference ra thiết bị nhưng khó bảo đảm môi trường và độ tin cậy | Scale worker/process; enrollment embedding làm giảm công việc trước giờ thi |
| Phù hợp repo | Cần thêm ML frontend và vẫn cần giải quyết gate đáng tin cậy | Tái sử dụng FastAPI, auth, private storage, status và gate đã có |

ONNX Runtime Web hỗ trợ CPU WASM và các backend GPU; WASM có coverage toán tử rộng hơn các provider GPU. Khả năng chạy ONNX không tự đảm bảo preprocessing/accuracy giống backend. [Tài liệu ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/).

**Chọn B.** Backend hiện là nơi quyết định bắt đầu bài thi. Gửi embedding hoặc `matched=true` từ client không cung cấp một quyết định đáng tin cậy cho gate đó. Server inference bảo vệ nơi tính quyết định; nó **không chứng minh ảnh upload là ảnh webcam mới chụp hoặc thẻ là thật**. Đây là giới hạn của phạm vi ảnh 1:1, không bổ sung liveness vào kế hoạch.

### D2. Flow đề xuất cho project

```text
ENROLLMENT / cập nhật hồ sơ
Ảnh thẻ / portrait đã gắn đúng users.id và được xác nhận nguồn
    → FastAPI identity enrollment
    → decode + card ROI + YuNet (đúng 1 face)
    → 5-point alignment 112×112
    → SFace → L2-normalized embedding A
    → PostgreSQL: template + version + nguồn ảnh + trạng thái approval

TRƯỚC KHI THI
Next.js verify/page.tsx → useIdentityCamera → JPEG
    → POST /api/v1/identity/exams/{exam_id}/verify + auth
    → backend lấy student_id từ JWT/current_user + kiểm tra assignment
    → đọc template A của student, đúng model/preprocessing/version
    → YuNet → alignment → SFace → normalized embedding B
    → cosine(A, B) → ngưỡng đã calibration / policy review
    → lưu IdentityVerification(student, exam, template_version, decision)
    → {data: {verified, score, ...}, meta: ...}
    → POST /api/v1/attempts kiểm tra record mới nhất/TTL/version
    → cho tạo attempt khi hợp lệ
```

Reference do sinh viên tự upload nên có trạng thái `pending_review`, hoặc được đối chiếu với nguồn hồ sơ có thẩm quyền trước khi kích hoạt. Không đổi tên ba ảnh selfie thành “ảnh thẻ” rồi coi yêu cầu đã hoàn thành. Việc xác nhận gắn ảnh với tài khoản là nghiệp vụ enrollment; không cần thêm OCR hay identification để làm 1:1.

### D3. API dựa trên router đang có

Giữ prefix `/api/v1/identity` và format phản hồi hiện tại; không tạo `/api/face/*` song song nếu không có nhu cầu version API độc lập.

| Endpoint | Đề xuất |
|---|---|
| `POST /api/v1/identity/enroll` | Chuyển input sang multipart `card_image`, `consent`; student lấy từ auth. Chuyển FE/BE cùng release hoặc dùng route `/enroll-card` tạm trong giai đoạn chuyển đổi. Template chỉ active sau khi reference được chấp thuận |
| `GET /api/v1/identity/status` | Bổ sung reference/template readiness và lý do cần cập nhật; không trả vector/đường dẫn private |
| `POST /api/v1/identity/check` | Webcam thử đối chiếu với template; không tạo quyền vào bài |
| `POST /api/v1/identity/exams/{exam_id}/verify` | Multipart `image`, `consent`; không nhận student_id tùy ý; backend tự lấy template |
| `GET /api/v1/identity/exams/{exam_id}/status` | Kiểm tra TTL + reference/model/policy version |
| `DELETE /api/v1/identity` | Xóa template, reference, verification theo chính sách; invalidate cache nếu có |
| `POST /api/v1/attempts` | Tiếp tục gate ở backend; không tin verification boolean hay id từ frontend nếu không đối chiếu quyền/version |

Không public endpoint embedding. Trích embedding enrollment là service nội bộ. Nếu quản trị viên đăng ký hộ sinh viên, có thể thêm route quản trị trong `identity.py`, bắt buộc role admin và audit người xác nhận; không dùng route student với `student_id` do client tự chọn.

Response tương thích trước tiên:

```json
{
  "data": {
    "verified": true,
    "status": "verified",
    "score": 0.72,
    "matched": true,
    "similarity": 0.72,
    "liveness_checked": false,
    "message": "Khuôn mặt khớp với hồ sơ đã đăng ký."
  },
  "meta": {"total": null, "page": null, "limit": null}
}
```

`matched/similarity` là alias có thể thêm để đáp ứng contract mong muốn; `verified/score` giữ UI hiện tại hoạt động. Hai cặp phải cùng một nguồn giá trị. `0.72` chỉ minh họa score, không phải xác suất hoặc threshold đề xuất. Threshold/policy version phải lưu trong audit server; không bắt buộc công khai threshold/score chi tiết cho UI thi production. Giữ field `threshold` nếu cần tương thích rồi thay contract có chủ đích.

Lỗi theo convention hiện hữu:

```json
{
  "error": {
    "code": "FACE_NOT_FOUND",
    "message": "Không phát hiện khuôn mặt trong ảnh thẻ.",
    "details": {"source": "card"}
  }
}
```

Ví dụ trên ghi nhận tên lỗi ở thời điểm phân tích. Phase 1 đã chuẩn hóa `FACE_NOT_FOUND` thành `NO_FACE_DETECTED` và `MULTIPLE_FACES` thành `MULTIPLE_FACES_DETECTED`; xem error contract và giới hạn compatibility trong phần final review phía trên.

### D4. Lưu embedding và versioning

Đề xuất mở rộng `StudentIdentity` để giữ nguồn reference, thêm bảng `student_face_templates` dưới ORM/migration hiện có:

```text
student_identities (bổ sung)
  card_image_path              TEXT NULL, private storage
  reference_status             pending_review / approved / rejected
  approved_by                  UUID NULL → users.id
  approved_at                  TIMESTAMPTZ NULL
  reference_version            INTEGER NOT NULL

student_face_templates (mới)
  id                           UUID PRIMARY KEY
  identity_id                  UUID → student_identities.id ON DELETE CASCADE
  reference_version            INTEGER
  embedding_data               BYTEA (float32 little-endian)
  embedding_dim                INTEGER (128 cho SFace)
  normalized                   BOOLEAN
  model_name                   TEXT
  model_sha256                 TEXT
  detector_sha256               TEXT
  preprocessing_version        TEXT
  source_image_sha256           TEXT
  created_at                   TIMESTAMPTZ
  UNIQUE(identity_id, reference_version, model_sha256, preprocessing_version)

identity_verifications (bổ sung)
  template_id / reference_version
  model_sha256 / preprocessing_version
  threshold_used / threshold_policy_version
  decision_reason
```

Ví dụ metadata API nội bộ, vector không gửi về browser:

```json
{
  "model_name": "opencv-sface-2021dec",
  "model_sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
  "embedding_dim": 128,
  "normalized": true,
  "preprocessing_version": "card-yunet-fivepoint-v1",
  "reference_version": 1
}
```

128 float32 = **512 byte/vector**; 512D ArcFace = **2,048 byte/vector**, chưa tính metadata/index/encryption. Với 10,000 sinh viên, SFace raw vectors khoảng 5.12 MB thập phân. JSONB dễ xem lúc prototype nhưng lớn hơn và dễ vô tình log; BYTEA + kiểm tra dimension/norm/finite thích hợp. Không cần pgvector hoặc vector search cho 1:1: lấy đúng một row theo khóa và tính dot product.

Lợi ích là trích card một lần, mỗi verify chỉ trích webcam. So với code hiện tại giảm từ 4 xuống 1 lần extraction mỗi lượt; **không đồng nghĩa toàn API nhanh gấp 4** vì còn decode/upload/DB/queue. Đổi model không được so vector cũ với vector mới, kể cả cùng dimension. Fingerprint phải gồm weights và preprocessing/detector policy; template mismatch trả lỗi hoặc rebuild có kiểm soát từ reference được giữ lại. Không tự chuyển model “tạm” trên request đang thi.

Migration: giữ cột selfie cũ trong giai đoạn chuyển tiếp, đánh dấu legacy source rõ ràng. Không tự backfill selfie thành template card đã approved. Model nâng cấp có thể tạo template version mới song song, kiểm tra parity/chất lượng rồi đổi active version; gate phải vô hiệu kết quả verification dùng version cũ khi policy yêu cầu.

Privacy: embedding vẫn là dữ liệu sinh trắc, không phải anonymization và không thể hash một chiều thông thường rồi tính cosine. Giới hạn truy cập DB, TLS, mã hóa storage/backup; không log vector. Quy định thời hạn giữ ảnh thẻ/webcam và consent trong nghiệp vụ; có thể chỉ giữ crop portrait cần thiết sau approval để giảm text/logo chứa dữ liệu cá nhân. Nếu xóa ảnh nguồn thì đổi model sẽ cần tái đăng ký. Quyền xóa phải bao gồm template, ảnh, cache và vòng đời backup.

### D5. Similarity, calibration và quyết định

Với `u=a/||a||`, `v=b/||b||`:

```text
cosine similarity s = u·v                [-1, 1], lớn hơn là giống hơn
cosine distance d_cos = 1 − s            [0, 2], nhỏ hơn là giống hơn
Euclidean distance d_L2 = ||u − v||      [0, 2]
d_L2² = 2 − 2s
MATCH khi s ≥ tau; tương đương d_cos ≤ 1−tau, d_L2 ≤ sqrt(2−2tau)
```

Quan hệ cuối chỉ đúng với vector đã L2-normalize. Dùng **cosine similarity** để khớp code hiện tại; SFace hỗ trợ cosine/L2, ArcFace thường dùng cosine trên normalized embeddings. Score không phải confidence được calibration theo xác suất; không hiển thị `0.72` thành “đúng người 72%”. Human dùng hàm similarity dựa trên distance riêng, không bê threshold của nó sang SFace. [OpenCV match implementation](https://github.com/opencv/opencv/blob/4.14.0/modules/objdetect/src/face_recognize.cpp), [Human embedding metric](https://github.com/vladmandic/human/wiki/Embedding).

`FACE_MATCH_THRESHOLD=0.363` hiện là tham số cấu hình lấy từ ví dụ SFace/LFW. Chính tutorial liệt kê threshold khác nhau giữa dataset; nó không được calibration cho ảnh thẻ, và median của ba reference hiện tại có phân phối khác một card reference. **Không giữ 0.363 như ngưỡng production mặc định đã được xác nhận.** [Bảng OpenCV](https://docs.opencv.org/4.13.0/d0/dd4/tutorial_dnn_face.html).

Calibration đề xuất:

1. Thu 20–50 người có đồng ý sử dụng dữ liệu. Mỗi người một ảnh thẻ và 3–5 webcam từ điều kiện/phiên chụp khác nhau; gắn nhãn điều kiện và nguồn thẻ. Không dùng frame liền nhau làm bằng chứng độc lập.
2. Chia **theo người**, ví dụ 60–70% calibration, phần còn lại test. Không để một người hoặc bản copy/crop của một ảnh sang cả hai tập. Giữ riêng một tập test cuối nếu đã dùng nhiều vòng chọn model.
3. Genuine: card_i với webcam_i. Impostor: card_j với webcam_i, j≠i, chỉ trong từng split. Các cặp này mô phỏng khai sai danh tính trong evaluation; hệ thống runtime vẫn chỉ kiểm tra 1:1.
4. Với từng model, quét threshold trên calibration: `FAR = false accepts / impostor pairs`, `FRR = false rejects / genuine pairs`; ROC biểu diễn TAR=1−FRR theo FAR. EER tại FAR≈FRR là diagnostic, không mặc định là ngưỡng thi.
5. Đề xuất mục tiêu thiết kế cần thống nhất trước khi triển khai thật: ưu tiên FAR thấp, ví dụ **≤10⁻³**, và kiểm tra FRR có chấp nhận được hay không. Chọn threshold cho TAR cao nhất trong ràng buộc FAR đó. Nếu không đạt, cần cải thiện dữ liệu/model hoặc review nghiệp vụ; không âm thầm hạ threshold.
6. Freeze weights, preprocessing, quality gates, threshold và retry policy; đánh giá trên test. Báo số pair, false accepts/rejects, intervals theo cụm người, failure-to-enroll/acquire, thay vì chỉ accuracy.

20–50 người chỉ là pilot: 50 người × 5 webcam cho 250 genuine và 12,250 impostor trước khi chia, nhưng các cặp dùng chung người/ảnh nên tương quan. “0 false accept” không chứng minh FAR=0. Quy tắc gần đúng `3/n` cho upper bound 95% khi 0 lỗi **giả định phép thử độc lập**; không áp máy móc cho toàn bộ cặp tương quan. Muốn chứng minh mức FAR rất thấp cần nhiều danh tính/phiên chụp độc lập hơn và kiểm tra đúng population.

Gần threshold: dùng vùng review được calibration (`tau_reject ≤ s < tau_accept`), không auto-pass. Response có thể `verified=false`, `status=review_required`; UI cho chụp lại có giới hạn hoặc chuyển quy trình hỗ trợ. Mismatch bình thường là HTTP 200 với `verified=false`; ảnh lỗi mới là 4xx. Mỗi retry làm thay đổi xác suất chấp nhận của cả phiên, nên cần cap/rate limit và đo FAR theo retry policy. Script hiện tính **một probe/lần**, chưa đánh giá policy review/retry.

### D6. Error handling và vận hành

| Tình huống | Mã đề xuất / có sẵn | HTTP và hành vi |
|---|---|---|
| Không có mặt | `FACE_NOT_FOUND` | 422, chỉ rõ source card/webcam, chụp lại |
| Nhiều mặt | `MULTIPLE_FACES` | 422, không chọn tùy tiện một mặt |
| Mặt nhỏ | `FACE_TOO_SMALL` | 422, yêu cầu ảnh nguồn/ROI tốt hơn |
| Mờ / tối | `FACE_TOO_BLURRY` / `FACE_TOO_DARK` | 422, hướng dẫn ánh sáng/giữ yên; gates cần calibration |
| Frame trống, decode lỗi, MIME/size | `EMPTY_IMAGE`, `INVALID_IMAGE`, `INVALID_IMAGE_TYPE`, `IMAGE_TOO_LARGE` | 422 hoặc 413; FE cũng kiểm tra video ready |
| Chưa có reference | `IDENTITY_NOT_ENROLLED` / mới `REFERENCE_IMAGE_MISSING` | 409, đăng ký/bổ sung thẻ |
| Card chưa approved | mới `REFERENCE_NOT_APPROVED` | 409, chưa cho verify để cấp quyền thi |
| Chưa có embedding | mới `IDENTITY_TEMPLATE_MISSING` | 409; tạo lại từ reference qua công việc có kiểm soát |
| Template khác version | mới `IDENTITY_TEMPLATE_OUTDATED` | 409; không so vector khác model |
| Không load được model | `FACE_MODEL_UNAVAILABLE` | 503; readiness fail, không cấp quyền |
| Queue đầy / quá nhiều lần thử | mới `FACE_SERVICE_BUSY` / `RATE_LIMITED` | 503/429, retry-after có giới hạn |
| Timeout xử lý | mới `FACE_VERIFICATION_TIMEOUT` | 504; budget server, không chỉ dựa vào timeout browser |
| Gần threshold | `review_required` trong decision | 200, không cấp gate, hỗ trợ kiểm tra lại |
| Không khớp | `FACE_MISMATCH` trong record | 200, không tạo quyết định verified |

`lib/api.ts` hiện timeout multipart sau 60 giây. Abort ở browser không chắc dừng thread inference; cần deadline server, semaphore/queue giới hạn và khóa idempotency nếu retry request để tránh lưu nhiều lần không rõ thứ tự. `FaceEngine.extract` còn có thể gặp runtime `cv2.error` ngoài constructor; nên map về lỗi inference có kiểm soát, không coi là mismatch.

Deployment đề xuất là **Linux VM/VPS/container có CPU, process FastAPI sống lâu, PostgreSQL và storage private bền vững**; đây là đề xuất, chưa có bằng chứng repository đã chọn nhà cung cấp. Khởi đầu cấu hình nhỏ rồi quyết định vCPU/RAM bằng load test; frontend có thể deploy riêng. Không đặt inference Python/native OpenCV vào Next.js Edge runtime.

Load model một lần mỗi worker, warm trước readiness; pin versions và SHA-256. Worker count nhân bản model/session/RSS; nhiều threadpool task không vượt qua được một DNN lock. Ban đầu giữ lock để tránh lỗi buffer, dùng ít worker và giới hạn OpenCV threads để tránh oversubscription. Chỉ tách worker inference/service riêng khi số đo cho thấy API cần độc lập tài nguyên.

Nếu thời gian xử lý thực tế là `t` giây/lượt trong một worker tuần tự, throughput trần xấp xỉ `workers/t`, thấp hơn khi tính CPU contention/DB/network. Không dùng con số nhận diện crop synthetic để đặt concurrency. Benchmark burst 10/25/50/100 client, p50/p95/p99, timeout, queue length, CPU và peak RSS; chọn mục tiêu UX trước, ví dụ p95 dưới 2 giây sau warm-up là **mục tiêu thử nghiệm**, không phải cam kết đã đạt.

Route hiện giữ row lock identity trong thời gian inference. Khi lưu template: lấy snapshot version, tính ngoài transaction dài, rồi mở transaction kiểm tra version chưa đổi trước khi lưu decision. Gate cũng kiểm tra version. Nhiều replica cần storage chung hoặc private object storage, không dựa vào một ổ local riêng cho mỗi replica.

## E. Files that need changes

Đường dẫn MODIFY dưới đây đều đã tồn tại; đường dẫn CREATE được đề xuất trong thư mục có thật của repository. Không tạo một `frontend/` giả.

| Đường dẫn | Trạng thái kế hoạch | Nội dung |
|---|---|---|
| `backend/app/services/face_recognition.py` | MODIFY | Tách extraction/quality cho card/webcam, metadata model, version, error mapping; giữ SFace |
| `backend/app/services/face_templates.py` | CREATE | Serialize/validate embedding, chọn template đúng version, enrollment/reference lifecycle |
| `backend/app/api/v1/identity.py` | MODIFY | Card enrollment, approval/readiness, compare một template, errors, hạn chế request, audit version |
| `backend/app/api/v1/attempts.py` | MODIFY | Gate thêm reference/template/policy version; giữ TTL/ownership |
| `backend/app/models/entities.py` | MODIFY | Card/reference fields, ORM template, verification metadata |
| `backend/alembic/versions/0007_face_templates.py` | CREATE | Migration mới, giữ migration 0005/0006; cần xác nhận thứ tự tại lúc triển khai |
| `backend/app/schemas/identity.py` | CREATE | Request/response/metadata typed rõ ràng |
| `backend/app/core/config.py` | MODIFY | Threshold policy/version, limits/deadline; không lấy số mới từ Internet |
| `backend/app/main.py` | MODIFY | Warm model/readiness/lifecycle, tiếp tục bảo vệ private storage |
| `backend/app/services/health.py` và `backend/app/api/v1/health.py` | MODIFY khi thêm readiness | Model đã load, đúng hash/config; tránh tiết lộ dữ liệu sinh viên |
| `backend/scripts/setup_face_models.py` | MODIFY | Pin upstream commit + model hash + license; hiện download từ nhánh `main` động |
| `backend/models/face/manifest.json` | CREATE | Artifact provenance, checksum, input/output contract, license |
| `backend/scripts/backfill_face_templates.py` | CREATE khi chuyển dữ liệu | Chỉ rebuild reference đủ điều kiện; dry-run và version; không biến selfie thành card approved |
| `backend/tests/test_identity.py` | MODIFY | Card/template/version, auth/gate, missing model, gần ngưỡng, noface/multiface, timeout |
| `app/student/identity/page.tsx` | MODIFY | Upload/preview card, trạng thái review/template, không còn yêu cầu 3 selfie làm reference |
| `app/student/exams/[examId]/verify/page.tsx` | MODIFY | Thông điệp thẻ, template readiness, retry/review; tiếp tục dùng camera hook |
| `components/identity/useIdentityCamera.ts` | MODIFY nếu cần | Chỉ lỗi frame/quality UX; capture hiện có đã tái sử dụng được |
| `lib/api.ts`, `lib/identity.ts` | MODIFY | Multipart card và type/alias/error/status mới |
| `docs/API_CONTRACT.md`, `docs/SETUP.md` | MODIFY | Contract/reference lifecycle/deploy/calibration |
| `openapi.json` | REGENERATE sau API thay đổi | Sinh từ FastAPI, không chỉnh thủ công bản snapshot trước |
| `backend/.env.example` | MODIFY khi triển khai | Tài liệu cấu hình mới, không chứa thông tin bí mật |
| `backend/app/api/deps.py`, `lib/api.ts` | MODIFY để xử lý rủi ro auth ở mục H | Thống nhất nguồn cookie/Bearer hoặc từ chối khi mâu thuẫn, kiểm thử nhiều tab khác tài khoản |

`backend/app/api/v1/router.py` đã mount identity; giữ router hiện có thì không cần route module mới. `package.json` không cần thêm thư viện ML cho phương án chọn. `schema.sql` chỉ đồng bộ nếu project duy trì schema snapshot, còn Alembic là đường nâng schema đề xuất; **không chạy hoặc chỉnh `PBL6.session.sql` trong đợt phân tích này**.

Artifact thực sự tạo trong đợt này:

```text
docs/FACE_VERIFICATION_ANALYSIS.md                 CREATED: báo cáo này
backend/scripts/benchmark_face_verification.py      CREATED: công cụ offline
```

## F. Dependencies

**Recommended stack không cần package mới** so với `backend/requirements.txt`: FastAPI, NumPy, Pillow, OpenCV headless, SQLAlchemy và multipart đã có. Không cần GPU, TensorFlow, PyTorch, InsightFace, ONNX Runtime hoặc npm ML để chạy SFace hiện tại. ONNX là định dạng file; OpenCV DNN đã đọc được file đó mà không cài ONNX Runtime.

Khi dựng môi trường mới, lệnh hiện hữu (chỉ hướng dẫn, chưa thực hiện):

```powershell
# Chạy tại backend/ khi bạn chủ động thiết lập môi trường
python -m pip install -r requirements.txt
```

Benchmark ArcFace bằng ONNX trực tiếp chỉ cần thêm `onnxruntime` vào một môi trường benchmark riêng, cộng model local được phép sử dụng:

```powershell
# Tùy chọn cho benchmark, KHÔNG cần cho SFace và chưa được chạy
python -m pip install onnxruntime
```

Nếu cần benchmark full SCRFD + InsightFace wrapper, thêm `insightface` trong môi trường riêng sau khi chọn/pin phiên bản và quyền model. Không dùng auto-download model trong startup API. Không đồng cài nhiều wheel OpenCV (`opencv-python`, `opencv-contrib-python`, `opencv-python-headless`) trong cùng env vì chúng chia namespace `cv2`.

Script đã thêm chỉ dùng standard library + OpenCV/NumPy/Pillow hiện có cho SFace; đo RSS trên Windows/Linux/macOS bằng API hệ điều hành, không bắt buộc `psutil`, sklearn hoặc matplotlib. ArcFace adapter dùng ONNX Runtime tùy chọn, không tự cài/tải gì.

## G. Implementation plan

### G1. Các phase sau khi chấp thuận thiết kế

| Phase | Việc triển khai | Điều kiện kết thúc |
|---|---|---|
| 1 — Face detection | Xác định nguồn card đáng tin cậy; decode/ROI/YuNet/quality cho card và webcam | Lỗi rõ ràng cho noface/multiface/nhỏ/mờ; không âm thầm chọn một mặt |
| 2 — Embedding extraction | Alignment đúng SFace; normalized 128D; manifest/hash; schema và versioned templates | Cùng input tạo vector hữu hạn, norm≈1; reference approved gắn đúng student |
| 3 — Verification | Cosine 1:1; policy cấu hình; review/retry/error; không dùng threshold tạm cho kỳ thi thật | Quyết định có thể tái hiện từ artifact/version/policy |
| 4 — API integration | Card enrollment, status, exam verify, gate TTL/version; UI và audit/private storage | User khác không dùng được reference/record; JS giả không mở gate |
| 5 — Threshold calibration | Chọn ngưỡng riêng theo dữ liệu card/webcam, mục tiêu FAR và retry policy | Threshold freeze, version và validation report; không có test leakage |
| 6 — Benchmark/acceptance | Holdout test + concurrency + privacy/retention lifecycle trong phạm vi tính năng | So FRR tại FAR mục tiêu, failure rates, p95, RSS; đạt tiêu chí mới rollout |

Benchmark pilot có thể chạy **ngay trước phase 1** để quyết định model; phase 6 là lần xác nhận cuối trên pipeline/API hoàn chỉnh. Không cần huấn luyện/fine-tune trên 20–50 người để bắt đầu; số đó dùng evaluation/calibration.

### G2. Script benchmark đã tạo

[benchmark_face_verification.py](../backend/scripts/benchmark_face_verification.py) chạy offline, không khởi động ứng dụng, không kết nối database, không ghi ảnh/embedding, không gọi mạng. Từ Phase 1, nhánh SFace import service dùng chung; không load cấu hình `.env` khi chỉ extract/compare. Chỉ ghi output vào **thư mục mới** được chỉ định.

Nó hỗ trợ:

- `--engine sface`: gọi trực tiếp `FaceEngine.extract_embedding` và `compare_embeddings`; dùng chung detection, alignment, quality và normalization với API, không duy trì bản sao pipeline SFace.
- `--engine arcface`: cùng YuNet/quality, alignment 5 điểm, ONNX local float32 NCHW 112×112 và output 512D. Phải chỉ rõ contract `--arcface-preprocessing rgb-127.5`. Không áp adapter này cho AdaFace/Raccoon/ONNX tùy ý.
- Split calibration/test khai báo **theo subject**; từ chối trùng subject/path hoặc byte-identical image giữa card/probe/splits. Không tự phát hiện mọi near-duplicate crop hoặc hai mã khác nhau cho cùng người: cần kiểm tra dataset thủ công.
- Genuine/impostor pairs, calibration threshold chỉ trên calibration, FAR/FRR/accuracy/balanced accuracy, ROC CSV, EER ở điểm empirical gần nhất kèm độ lệch FAR–FRR.
- Load time gồm import thư viện + construct engine; RSS/peak RSS process; latency extraction gồm đọc file/decode/detect/align/embedding; CPU time, p50/p95; per-image errors.
- Tỷ lệ genuine không được chấp nhận gồm cả trường hợp không tạo score, để việc loại ảnh khó không khiến kết quả trông tốt giả tạo.

Không đo HTTP, DB, burst concurrency, vùng review, nhiều lần retry, hoặc policy median ba selfie hiện tại. SFace trong script là **baseline recognizer/preprocessing hiện tại trên protocol card↔webcam mới**, không phải toàn bộ endpoint cũ. Nó bỏ bước re-encode JPEG để lưu ảnh của production nên không dùng thời gian script làm thời gian endpoint. ArcFace + YuNet là ablation recognizer, không được đặt nhãn “full buffalo_l”. Khi cần full buffalo_l phải bổ sung adapter SCRFD riêng.

Dataset cần cung cấp ngoài thư mục public và ngoài dữ liệu demo. Dùng subject ID giả danh, không dùng tên/email trong output. Ví dụ JSON tối thiểu để mô tả schema (ảnh ở đây là placeholder, **chưa tồn tại**; dataset thật nên 20–50 người và 3–5 webcam/người):

```json
[
  {"subject_id":"p01","split":"calibration","card_image":"p01/card.jpg","webcam_images":["p01/webcam1.jpg"]},
  {"subject_id":"p02","split":"calibration","card_image":"p02/card.jpg","webcam_images":["p02/webcam1.jpg"]},
  {"subject_id":"p03","split":"test","card_image":"p03/card.jpg","webcam_images":["p03/webcam1.jpg"]},
  {"subject_id":"p04","split":"test","card_image":"p04/card.jpg","webcam_images":["p04/webcam1.jpg"]}
]
```

Chạy từ root project bằng Python đã có:

```powershell
# Có thể chạy ngay, không cần dataset hoặc package mới
& './backend/.venv/Scripts/python.exe' backend/scripts/benchmark_face_verification.py --self-test
& './backend/.venv/Scripts/python.exe' backend/scripts/benchmark_face_verification.py --smoke --threads 1

# Sau khi chuẩn bị manifest + ảnh; các đường dẫn dataset/output là ví dụ do bạn chọn
& './backend/.venv/Scripts/python.exe' backend/scripts/benchmark_face_verification.py --manifest 'D:/face-benchmark/manifest.json' --output 'D:/face-benchmark/results/sface-run01' --engine sface --target-far 0.01 --threads 1

# Tùy chọn sau khi tự chuẩn bị ONNX Runtime và weights ArcFace đúng quyền/contract
& './backend/.venv/Scripts/python.exe' backend/scripts/benchmark_face_verification.py --manifest 'D:/face-benchmark/manifest.json' --output 'D:/face-benchmark/results/arcface-run01' --engine arcface --recognizer 'D:/face-benchmark/models/w600k_r50.onnx' --arcface-preprocessing rgb-127.5 --target-far 0.01 --threads 1
```

`--target-far 0.01` là mức **pilot minh họa**, không phải tiêu chuẩn kỳ thi; chọn mức khác theo policy và kích thước validation. Nếu không có cả genuine/impostor thành công ở mỗi split, script dừng thay vì tạo accuracy vô nghĩa. Run từng model trong process mới để số đo RSS/load có thể so sánh.

Output: `summary.json`, `pairs.csv`, `images.csv`, `roc_calibration.csv`, `roc_test.csv`, `errors.csv` khi có lỗi. ROC test chỉ dùng báo cáo, không dùng chọn lại threshold. Các pair scores vẫn nhạy cảm; lưu local có kiểm soát, không commit vào repository. Dùng ROC CSV để vẽ báo cáo khi có dữ liệu thật; hiện không tạo biểu đồ accuracy giả.

### G3. Kiểm chứng đã thực hiện và giới hạn

Đã chạy self-test metric (perfect/reversed distributions, bằng threshold, tied scores, reject-all, thiếu một loại pair). Đã chạy harness tổng hợp kiểm tra cả flow tạo JSON/CSV, tách subject, threshold freeze, mẫu bị mờ vào mẫu số end-to-end và từ chối subject trùng. Đây là kiểm tra tính đúng của công cụ, **không phải thử nhận diện người**.

Smoke trên máy hiện tại: Windows 11, Intel Core i5-12450H, 8 core/12 logical CPU, OpenCV 4.14.0.94, NumPy 2.5.3, Pillow 12.3.0, OpenCV 1 thread; 3 warm-up + 20 lần recognition crop noise 112×112:

| Phép đo | Kết quả một run |
|---|---:|
| Import + tạo YuNet/SFace engine | ~1,022 ms |
| RSS trước / sau load | ~19.5 / 77.0 MiB |
| SFace recognition-only p50 / p95 | ~32.9 / 42.7 ms |
| RSS cuối / peak RSS | ~145.1 / 153.1 MiB |
| Embedding output | 128D, normalized norm≈1 |
| Blank 640×480 detector check | Không có mặt, đúng kỳ vọng |

Các số này bao gồm trạng thái cache máy tại thời điểm chạy, không phải cold-start bảo đảm, RAM của FastAPI worker hoặc latency toàn pipeline. Model inference trên noise chỉ chứng minh runtime/shape chạy được và cung cấp một mốc hiệu năng hẹp. **Chưa có accuracy, FAR, FRR, ROC hoặc EER trên ảnh người thật; chưa có benchmark ArcFace.**

Trước khi rollout: bổ sung integration tests với PostgreSQL thực cho ownership/TTL/version/race, input ảnh được phép sử dụng cho noface/multiface/quality, và kiểm tra model parity khi đổi runtime. Unit tests có mock engine không chứng minh chất lượng nhận diện.

## H. Risks

1. **Nguồn reference sai:** student tự gắn ảnh của người khác vẫn có thể đạt similarity. Cần reference gắn đúng hồ sơ và approval; model không thay thế việc đó.
2. **Sai preprocessing:** RGB/BGR, double normalization, crop thiếu landmarks, model đổi nhưng version không đổi làm giảm accuracy mà API vẫn trả score hợp lệ.
3. **Domain gap:** ảnh thẻ in/chụp, mặt nhỏ, lóa, compress, thẻ cũ khác webcam. Cần đánh giá cả fail-to-detect/quality, không chỉ những pair dễ còn lại.
4. **Threshold không được chứng minh:** 0.363 từ LFW và median ba webcam không có cùng operating point với một card. Dataset pilot quá nhỏ để cam kết FAR rất thấp.
5. **License weights:** InsightFace source MIT không có nghĩa buffalo/w600k/Raccoon được dùng production bất kỳ; Human/FaceNet cũng cần xem đúng checkpoint nguồn.
6. **Nghẽn trước giờ thi:** một DNN lock/worker, bốn extraction hiện tại, row lock dài và CPU oversubscription. Lưu template giúp nhưng vẫn phải load test trên môi trường deploy.
7. **Template và verification cũ:** thay card/model/policy phải có version check; cập nhật reference trong lúc inference cần kiểm tra lại trước commit, không chỉ timestamp ở frontend.
8. **Private files nhiều replica/retention:** local disk có thể mất khi redeploy; ảnh verification hiện tích lũy đến khi xóa. Cần storage bền vững và retention rõ.
9. **Auth khi nhiều tab khác tài khoản:** FE dùng sessionStorage Bearer để tách tab, nhưng `deps.py` hiện ưu tiên cookie `auth_token` trước Bearer. Cookie chia sẻ giữa tab có thể khiến student thực tế ở backend khác UI. Cần xác định một nguồn auth chuẩn hoặc từ chối token mâu thuẫn; thêm regression test trước rollout tính năng định danh. Đợt này chưa sửa auth.
10. **Phạm vi bảo đảm:** kết quả chỉ nói hai ảnh đủ giống dưới model/policy; không xác thực giấy tờ hoặc chứng minh một người đang hiện diện trực tiếp. Không bổ sung các module ngoài phạm vi để che giới hạn đó.
11. **Reproducibility:** downloader hiện so hash với LFS pointer trên `main`; kiểm tra integrity tải xuống chưa đồng nghĩa pin một phiên bản bất biến. Lưu upstream commit, model hash, license, runtime và calibration version cùng release.

```text
Recommended stack: Next.js capture → FastAPI → OpenCV YuNet + SFace
Detector: YuNet 2023mar đã có trong repository
Recognition model: OpenCV SFace 2021dec, 128D
Runtime: OpenCV DNN, CPU-only
Deployment: FastAPI process sống lâu + PostgreSQL + private persistent storage
Similarity metric: Cosine trên L2-normalized embeddings; threshold calibration riêng
Embedding storage: PostgreSQL BYTEA float32 + reference/model/preprocessing version
Reason: Tái sử dụng kiến trúc và model đã chạy, ít dependency, license rõ;
        ưu tiên sửa nguồn ảnh thẻ, lưu template và đo chất lượng trước khi đổi model.
```
