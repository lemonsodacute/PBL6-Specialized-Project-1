# Ngân hàng câu hỏi của giảng viên

## Trang và schema

- `/dashboard/question-banks`: danh sách ngân hàng, tạo, đổi tên, ngừng sử dụng bằng API hiện có.
- `/dashboard/question-banks/{id}`: breadcrumb, câu hỏi và bộ lọc; chọn theo trang/kết quả, giữ lựa chọn qua trang/bộ lọc; bulk chủ đề, ngừng sử dụng, thêm vào đề nháp.
- `/dashboard/question-banks/{id}/documents`: wizard tài liệu → cấu hình → review → xác nhận nhập.

DB có `QuestionBank.subject` dạng chuỗi tùy chọn, nhưng không có entity Subject/Course. UI không dùng field này, không tạo môn giả. Loại câu, difficulty, topic, trạng thái, điểm và đáp án dùng schema Question hiện có. Migration `0013_question_images` thêm `Question.images_json` để giữ attachment và nguồn của ảnh; không thay đổi chấm điểm. Chạy `alembic upgrade head` trước khi chạy phiên bản backend này. Ngày cập nhật ngân hàng được cập nhật khi chỉnh sửa câu hỏi/nhập tài liệu.

Random dùng `/random-select` của backend, giữ đúng bộ lọc, phân bố và số câu; thiếu câu trả lỗi thay vì tự đổi tỷ lệ. Thay một câu/cả bộ loại trừ các câu đang chọn. Chọn ngẫu nhiên và chuyển lựa chọn sang form tạo đề chỉ tạo preview; việc ghi đề vẫn qua thao tác xác nhận hiện có.

## Tài liệu và bản nháp

PDF có text layer và DOCX được hỗ trợ. Giới hạn 10 MiB, 200 trang PDF, 500.000 ký tự đã đọc; DOCX giới hạn 3.000 ZIP entries và 40 MiB sau giải nén. Kiểm tra extension, MIME, cấu trúc, mã hóa và macro. Parser chạy trong subprocess, tối đa 30 giây và hai tiến trình đọc đồng thời. PDF không có text trả thông báo để chuyển đổi file; không gọi OCR nhận diện thẻ hay Face Verification.

File gốc không được lưu bởi ứng dụng. Text/chunk/draft nằm ở `backend/private/question-documents`, ngoài static `/uploads`; không trả đường dẫn filesystem. Session được kiểm tra ngân hàng, chủ ngân hàng và người tạo ở mỗi endpoint, kể cả admin cần đúng người tạo session. Response tài liệu dùng `Cache-Control: no-store`.

Session có TTL 2 giờ. Background sweep kiểm tra mỗi 60 giây, thêm kiểm tra khi truy cập; file ghi tạm còn sót sau crash cũng được dọn theo TTL. Nguồn được xóa ngay khi nhập thành công hoặc giảng viên đổi/bỏ tài liệu. Biên nhận nhập còn lại đến TTL; file khóa rỗng không chứa nội dung nguồn. UUID ngẫu nhiên không chứa tên người dùng. Mỗi session có file lock để tránh hai lượt tạo/import đồng thời. Khi triển khai nhiều instance, dùng shared private volume và quyền truy cập thư mục chỉ dành cho service.

Mode nhập có sẵn đọc dạng:

```text
Câu 1: HTML dùng để làm gì?
A. Cấu trúc trang web
B. Trang trí trang web
Đáp án: A
Giải thích: HTML mô tả cấu trúc.
```

Hỗ trợ nhãn `Question`/`Answer`, nhiều đáp án `A, B` hoặc đáp án bằng nguyên văn phương án. Tự luận/vấn đáp cần một đáp án mẫu. Câu thiếu nội dung/đáp án được giữ để sửa, không bịa nội dung và không tự chọn đáp án. Nội dung gốc không được viết lại bằng AI.

Giảng viên sửa draft ở frontend; bản chỉnh sửa được gửi khi xác nhận import. Tải lại trang giữ session, draft gốc và tiến độ AI; các chỉnh sửa/lựa chọn chưa nhập chỉ nằm trong phiên trang hiện tại. Câu được chọn cần có nội dung, phương án/đáp án hợp lệ, điểm > 0 và tối đa hai số lẻ. Chống trùng bằng NFKC + casefold + chuẩn hóa whitespace, với ngân hàng hiện tại và trong lượt chọn. Toàn bộ câu được nhập trong một transaction. UUID draft được dùng làm UUID câu chính thức, biên nhận/hash giữ retry idempotent kể cả sau commit mà chưa lưu được biên nhận.

### Điều kiện import và giải thích tại bước review

Trước đây nút “Tiếp tục thêm N câu” dùng `busy || expired || !selection.length || invalidSelection || !complete`. `invalidSelection` gồm lỗi `draftProblems`, nội dung đã có trong ngân hàng và trùng nội dung giữa các câu đang chọn. `complete` yêu cầu mọi batch đã hoàn tất; API import cũng kiểm tra điều này. Vì vậy 15 câu hợp lệ từ ba batch thành công vẫn bị khóa nếu batch còn lại lỗi, chẳng hạn `UNGROUNDED_GENERATION`.

Import hiện chỉ cần phiên đã cấu hình, còn hạn, không có thao tác đang chạy và ít nhất một câu được chọn; **tất cả câu đang chọn** phải hợp lệ và không trùng. Batch chưa xong không chặn các câu đã tạo thành công. Footer và bước xác nhận nhắc rõ số phần chưa xong, cho phép quay lại thử lỗi, và báo việc nhập thành công sẽ kết thúc phiên/xóa nguồn cùng các bản nháp không nhập. Retry, transaction, kiểm tra UUID thuộc phiên và kiểm tra ảnh phía server vẫn giữ nguyên.

Đánh giá chất lượng hiện là analytics tùy chọn trong `AIDraftReview.decision` (`accepted`, `edited`, `rejected`), không có trường `draft.review_status` hoặc quality gate bắt buộc trong schema import. Không yêu cầu bấm “Đạt” để mở khóa; 10 câu đạt + 5 câu chưa đánh giá vẫn có thể nhập đủ 15 nếu đều hợp lệ. “Cần sửa” dùng giá trị API hiện có `edited`, giữ trạng thái sau khi lưu nội dung để teacher tự cập nhật đánh giá. “Loại bỏ” tự bỏ chọn và không cho chọn lại cho đến khi đổi đánh giá, kể cả sau khi tải lại trang/chọn tất cả. Nút đánh giá active có dấu chọn, `aria-pressed` và kiểu màu cố định.

Form chất lượng có rating 1–5 sao riêng (`quality_rating`), lý do nằm dưới sao, ghi chú chỉ hiện khi chọn “Khác” (`reason_note`). Migration `0021_draft_quality_rating` thêm hai field nullable; tái sử dụng `reason` và `decision`. Rating/lý do/quyết định tự lưu riêng, không suy ra quyết định từ số sao. Nhóm Quyết định và nhóm Thao tác có tiêu đề/divider riêng; các nút quyết định có màu success/warning/danger nhẹ và viền active. Thao tác nhập/sửa/tạo lại/bỏ chờ các đánh giá đang lưu hoàn tất để không làm mất ghi chú; lỗi lưu có nút thử lại.

Footer tách số câu được tạo, đã chọn, hợp lệ sẵn sàng thêm và các quyết định đánh giá. Câu đang chọn có lỗi vẫn chặn cả lượt nhập; số sẵn sàng chỉ đếm câu hợp lệ, và footer giải thích phải sửa hoặc bỏ chọn câu lỗi. Mỗi card hiển thị đầy đủ lỗi nội dung, điểm, phương án, đáp án, metadata có giới hạn độ dài, trùng nội dung và ảnh không thuộc phiên. Source page/section/excerpt là metadata, không bắt buộc phải có; không có draft-status gate riêng. `IMAGE_REQUIRES_VISION` là cảnh báo kiểm tra thủ công, không phải lý do khóa import. Lỗi tải ảnh có hướng dẫn thử lại ngay tại ảnh; API import vẫn xác minh association và lưu ảnh thật. Generation error chỉ ảnh hưởng batch tương ứng, không tự làm các draft đã tạo thành công mất hiệu lực.

## Cấu hình AI server

Cài dependencies backend, sau đó đặt ở `backend/.env` hoặc biến môi trường server:

```dotenv
QUESTION_GENERATION_BASE_URL=https://your-provider.example/v1
QUESTION_GENERATION_API_KEY=<server-secret>
QUESTION_GENERATION_MODEL=<model-supporting-json-schema>
QUESTION_GENERATION_SUPPORTS_VISION=false
QUESTION_GENERATION_TIMEOUT=90
```

Restart backend sau khi cấu hình. Không dùng biến `NEXT_PUBLIC_*` cho key. Khi chưa đủ cấu hình, capabilities báo AI chưa khả dụng; mode nhập có sẵn vẫn hoạt động. Adapter `QuestionGenerationProvider` gọi API tương thích OpenAI `/chat/completions` với structured output `json_schema` và `strict: true`. Provider/model phải hỗ trợ định dạng này; không fallback sang template hoặc tạo dữ liệu giả. Cách truyền schema và xử lý refusal dựa trên [tài liệu Structured Outputs chính thức](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

Text được chia chunk tối đa 2.400 ký tự, giữ trang/phần nguồn. Kế hoạch phân bổ trải đều từ đầu đến cuối tài liệu, tối đa năm câu/lượt. Không gửi toàn bộ tài liệu dài vào một prompt. Batch thành công được lưu private; batch lỗi có thể tiếp tục sau reload mà không tạo lại batch đã xong. Tạo lại một câu chỉ thay UUID đó.

System prompt xem tài liệu/chủ đề/câu đã có là dữ liệu không đáng tin, không có tools, không cho thực thi chỉ dẫn trong tài liệu. Server kiểm tra schema, số câu theo từng chunk, đáp án, phương án, trùng nội dung và trích dẫn phải nằm trong chunk. Metadata trang/phần được lấy từ mapping server, không tin số trang do model tự tạo. Không log key, text tài liệu hoặc nội dung trả về của provider.

Trích dẫn đúng nguồn không chứng minh toàn bộ lập luận và đáp án đúng. Giảng viên vẫn cần review trước bước xác nhận. Chưa cấu hình credentials thực nên kiểm tra adapter dùng HTTP test transport; chưa thực hiện lượt AI trực tiếp với provider bên ngoài.

## Kiểm tra

```powershell
cd backend
& .venv/Scripts/python.exe -m unittest tests.test_question_documents tests.test_question_selection
```

Tests backend dùng SQLite isolation, DOCX/PDF thật: parse text, scan/mật khẩu, file hỏng/MIME/macro/size, ownership, private/TTL, sửa rồi nhập, thiếu đáp án, trùng, rollback, retry và batch resume. Adapter được kiểm tra bằng HTTP transport, gồm structured schema, key chỉ trong Authorization, refusal/output không đủ/citation sai.

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:PLAYWRIGHT_BASE_URL='http://localhost:3100'
npx playwright test tests/e2e/question-documents.spec.ts tests/e2e/teacher-workspace.spec.ts
```

Browser tests dùng API fixtures; server/parser được kiểm tra riêng bằng integration tests. Trên máy Windows hiện tại Chromium bundled chưa cài, nên dùng Edge. Ghi test artifacts ra ngoài workspace khi chạy Next dev để Tailwind không quét file trace và kích hoạt rebuild liên tục. TypeScript toàn repository hiện có lỗi sẵn trong `tests/e2e/exam-experience.spec.ts` với `MediaStreamConstraints | undefined`; source frontend và tests của thay đổi này được kiểm tra riêng.

## Preview và ảnh tài liệu

Bước Tài liệu hiển thị tên/loại file, số ký tự thực tế, số hình ảnh, số trang PDF và số câu hỏi từ parser. Với Word, số trang chỉ lấy từ metadata `docProps/app.xml` khi có giá trị hữu ích và được ghi là ước tính; không suy đoán từ số đoạn văn. Tài liệu chưa có cấu trúc câu hỏi không hiển thị số câu. Preview ưu tiên câu hỏi đầu tiên, tối đa 1.000 ký tự và cắt ở cuối dòng khi phù hợp. Chunk ID, paragraph index, storage path không được render ra UI.

DOCX giữ thứ tự text/run/picture trong đoạn và bảng, bao gồm bảng lồng nhau, ảnh DrawingML và VML. Ảnh có UUID, vị trí đoạn, đoạn gần nhất và số câu hỏi gần nhất. PDF dùng text layer, `page.images` và visitor transformation matrices của pypdf để giữ số trang/bbox gần đúng, sắp theo vị trí đọc. Không OCR PDF có text. Ảnh PDF không xác định được vị trí được giữ theo trang và không tự gán vào câu hỏi. PDF scan chưa có OCR fallback trong flow này và trả lỗi hướng dẫn chuyển đổi; không gọi Student Card OCR. Word có ảnh vector không giải mã được cần chuyển ảnh sang PNG/JPEG. Giới hạn thêm: 250 ảnh, 20 triệu pixel/ảnh, tổng PNG sau giải mã 24 MiB. Không bỏ ảnh âm thầm khi vượt giới hạn.

Trước import, ảnh nằm trong thư mục UUID ở private document storage. Preview dùng API kiểm tra đúng owner/session/TTL, Bearer token của từng tab, response `no-store` và blob URL được thu hồi khi đóng preview. Gallery tải tối đa 12 ảnh mỗi lần, có nút xem thêm; request quá thời gian có nút thử lại. Bản nháp giữ `images[]`, `source_page`, `source_section`, `source_excerpt` và `warning_codes`. Editor cho teacher bổ sung ảnh chưa xác định association từ cùng tài liệu. Không cho gửi ảnh từ phiên khác hoặc bỏ ảnh đã liên kết khi import. Metadata ảnh được lấy lại từ server, không tin path/URL do client gửi.

Import copy PNG vào `backend/private/question-images/{question_uuid}` trước transaction commit, lưu metadata vào `images_json`, rồi xóa toàn bộ text/chunk/draft/ảnh nguồn. DB rollback xóa bản copy; retry sau commit nhưng mất biên nhận dùng cùng UUID và không nhân đôi. TTL/hủy chỉ xóa nguồn tạm. Sweep dọn các bản copy mồ côi sau crash sau 2 giờ, kiểm tra DB trước khi xóa; ảnh của câu đã lưu được giữ lại. API ảnh chính thức chỉ cho chủ ngân hàng/giảng viên của đề/admin và sinh viên có lượt thi thật chứa câu hỏi đó; cần `attempt_id` của chính sinh viên. Serializer sinh viên không chứa đoạn nguồn có đáp án. Ảnh được render trong review/editor/chi tiết câu hỏi và khi sinh viên làm bài.

Chỉ bật `QUESTION_GENERATION_SUPPORTS_VISION=true` sau khi xác minh provider/model hỗ trợ ảnh. Request gửi text, phương án và PNG base64 trong cùng message theo [OpenAI Images and Vision](https://developers.openai.com/api/docs/guides/images-vision); key vẫn chỉ ở Authorization phía server. Câu hỏi có hình dài hơn một chunk kèm ngữ cảnh đầy đủ (giới hạn 16.000 ký tự/câu), giữ ảnh với mọi chunk liên quan. Server kiểm tra image IDs/model output theo nguồn và giữ ảnh đi kèm draft. Model không hỗ trợ vision không được gọi trên nguồn có ảnh: trả `IMAGE_REQUIRES_VISION`; mode nhập có sẵn vẫn giữ văn bản/đáp án/ảnh và cảnh báo để review thủ công.

Kiểm tra thêm: `python -m unittest tests.test_document_images` (DOCX/PDF có ảnh thật, 87 câu được đếm thật, mapping, ownership, TTL/hủy, rollback/retry/persistence, quyền sinh viên, payload vision và fallback).
