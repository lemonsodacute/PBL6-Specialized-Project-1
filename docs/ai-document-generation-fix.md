# AI DOCUMENT QUESTION GENERATION FIX

Ngày kiểm chứng: 28–29/10/2026.

## Root cause

Tài liệu `Tai_lieu_thu_nghiem_tao_cau_hoi_AI.docx` đã được trích xuất thành công: 6.116 ký tự, 56 phần văn bản, 8 chunk, 1 hình, kế hoạch 2 batch × tối đa 5 câu. Lỗi xảy ra tại provider, trước khi nhận được nội dung để parse.

- Log `AIActivity` của phiên gốc ghi nhiều lượt khoảng 90.000ms, không có HTTP response, và một lượt HTTP 503. Transport cũ gộp ReadTimeout/ConnectError/HTTP 5xx thành `AI_PROVIDER_UNAVAILABLE`, nên UI chỉ báo dịch vụ không khả dụng.
- Base URL, API key và env được nạp. Models endpoint trả HTTP 200 và liệt kê model; đây không phải lỗi thiếu key hoặc tên model không hợp lệ. ID từ models endpoint có tiền tố `models/`.
- `gemini-3.8-flash` timeout cả probe nhỏ có/không có JSON schema và khi đặt reasoning thấp. `gemini-3.5-flash` trả được probe nhỏ nhưng request tài liệu thật nhận HTTP 503/UNAVAILABLE với dấu hiệu temporary demand, kể cả khi bỏ hình.
- `gemini-3.5-flash-lite` đã xử lý chính nguồn tài liệu có hình và trả bản nháp hợp lệ. Đã chuyển **chỉ** `QUESTION_GENERATION_MODEL` sang model này. `SUPPORT_ASSISTANT_MODEL` giữ nguyên giá trị sẵn có.

## Thay đổi

1. Tách `AI_TIMEOUT`, `AI_PARSE_ERROR` khỏi provider unavailable; giữ riêng auth, rate limit, invalid response, model và request errors. API tài liệu ánh xạ timeout → 504, parse → 502.
2. Log chỉ ghi model đã kiểm tra an toàn, HTTP status, loại lỗi, category, stage, thời gian và retry delay. Không ghi API key, headers, prompt, tài liệu, raw exception/provider body hoặc model output.
3. Parser phân biệt lỗi envelope với JSON syntax và schema câu hỏi. Chấp nhận JSON hoàn chỉnh hoặc một code fence JSON; không tìm ngoặc tùy ý trong prose hoặc sửa output bị cắt. Vẫn từ chối refusal/tool calls/truncation và tiếp tục kiểm tra schema/nguồn/đáp án.
4. Giữ retry tối đa hai lần gọi trong cùng ngân sách timeout 90 giây. Auth/model/schema/parse errors không bị retry vô hạn. Hỗ trợ Retry-After dạng số và HTTP-date, không retry ngay khi thời gian chờ vượt giới hạn.
5. UI có thông báo ngắn, an toàn cho timeout và parsing. Logic lưu batch lỗi, bỏ qua batch hoàn tất, giữ plan ban đầu, kiểm tra trùng và import có xác nhận đã có sẵn và được giữ nguyên.

## Luồng đã truy vết

`upload_document` → `question_document_worker` / `extract_document` → `chunk_sections` → `generation_plan` → `generate_batch` → `OpenAICompatibleQuestionProvider` → `OpenAICompatibleClient` → JSON/schema/source validation → private session drafts → trang `documents` / bước **Xem câu hỏi**.

Question Bank chính chỉ được ghi qua endpoint `/import` sau review/xác nhận. Generation và retry không gọi endpoint đó.

## Tài liệu gốc và giới hạn phiên

Phiên gốc `809edde7-06f7-4955-96a8-34804cdd895e` có hai batch lỗi, hết hạn lúc `2026-10-28T15:17:56Z`. Khi tiếp tục ngày 29/10, đã xác nhận text trích xuất từ DOCX gốc khớp hoàn toàn trước khi backend dọn phiên hết hạn. Sau đó tải lại chính file qua API upload/parser bình thường, giữ yêu cầu 10 câu, mcq_single, hard. Không kéo dài TTL hoặc sửa trực tiếp trạng thái phiên hết hạn.

Lượt đầu trên phiên mới tạo **6 câu thật** (1 + 5), cả hai HTTP 200, parse/source validation thành công, một câu có hình. Ngân hàng trước/sau vẫn có 10 câu với fingerprint nội dung/phương án/đáp án không đổi. Đã xem trực tiếp ảnh preview và đáp án được đánh dấu trong UI.

Lượt kiểm chứng cuối trên phiên `884e737e-85fd-4dcf-ae04-ad1fde41cff1` đã PASS: phần đầu tạo 1 câu, UI chỉ POST `/batches/1` cho phần còn lại và chờ response HTTP 200, phần này tạo 5 câu. Toàn bộ 6 câu xuất hiện trong bước **Xem câu hỏi**, đáp án/options hợp lệ, không trùng nội dung. Draft ID của phần thành công đầu tiên vẫn có trong phiên cuối. POST lại `/batches/0` trả đúng các draft hiện có và không thêm provider activity.

Trong lượt kiểm chứng có một output bị từ chối vì citation không khớp nguồn (`UNGROUNDED_GENERATION`). Batch vẫn giữ trạng thái lỗi và không tạo draft/không ghi ngân hàng; retry thật sau đó thành công. Không nới lỏng validation để làm test đạt.

Link review trên ứng dụng: [Xem 6 bản nháp](http://localhost:3000/dashboard/question-banks/55811f4d-185a-5f50-aba8-b64776da249e/documents?document=884e737e-85fd-4dcf-ae04-ad1fde41cff1). Phiên vẫn tuân thủ TTL hai giờ; cần đăng nhập tài khoản sở hữu tài liệu.

## Kết quả

| Mục | Kết quả |
|---|---|
| AI provider connection | PASS: request thật, HTTP 200. |
| Environment config | PASS: base URL/key/model nạp đúng; key chỉ ở backend/.env. |
| Model | `gemini-3.5-flash-lite` |
| Request | PASS cho text + ảnh + structured schema. |
| Response parsing | PASS cho các bản nháp thật; đáp án nằm trong options, mỗi mcq_single có một đáp án. |
| Failed-section retry | PASS: UI chỉ gọi phần 1 còn chưa hoàn tất; giữ nguyên phần 0 đã thành công. |
| Duplicate prevention | PASS ở lượt đầu: nội dung unique; gọi lại batch hoàn tất không tạo thêm câu/provider activity. |
| Real questions generated | **6 câu thật ở phiên cuối**, gồm 1 câu có hình nguồn. Không bù giả cho yêu cầu tối đa 10 câu. |
| Frontend | PASS: 11 regression + 1 real e2e; preview, options/answers, retry và idempotency đã kiểm tra. |
| Backend tests | 56/56 provider/document/image/AI-management + 17/17 Support regression PASS. |
| Frontend regression | 11/11 PASS: retry sau reload, partial success, giữ edit/removal/selection/plan và phân loại lỗi, gồm hai mã mới. |
| TypeScript | `tsc --noEmit`: exit 0. |
| Lint | Focused: không warning/error; toàn dự án exit 0, còn warning hook có sẵn. |
| Build | Production build exit 0, 42/42 trang; output riêng `.next-recovery-ai-document-generation-fix`. |
| Secret scan | PASS: không có API key thật trong artifact text/log hoặc JavaScript bundle production của frontend. |

Các unit/regression test dùng fixture để tạo lỗi có kiểm soát; các probe, validation tài liệu thật và preview thật không dùng fake/generated-question mocks. Real e2e yêu cầu opt-in `AI_DOCUMENT_REAL_E2E=1` để tránh tiêu quota khi chạy suite thông thường.

Real validation dùng tài khoản sở hữu tài liệu đã tồn tại, token kiểm chứng ngắn hạn qua helper auth sẵn có và API/auth/role checks thật; không đổi auth hoặc tạo tài khoản. Token chỉ lưu trong `backend/private`, không xuất vào report.

## Files changed

- `backend/.env` (local, gitignored): chỉ giá trị `QUESTION_GENERATION_MODEL`; không đổi key.
- `backend/.env.example`: bổ sung model mặc định đã xác minh.
- `backend/app/services/ai_provider.py`: phân loại lỗi, trace an toàn, JSON extraction và Retry-After.
- `backend/app/services/question_generation.py`: ghi rõ stage schema validation.
- `backend/app/api/v1/question_documents.py`: status cho hai mã lỗi mới.
- `lib/ai-provider.ts`: mã lỗi và thông báo UI.
- `backend/tests/test_ai_provider.py`, `backend/tests/test_question_documents.py`: kiểm tra mã lỗi/parser/retry/safe logs và trạng thái batch.
- `tests/e2e/question-documents.spec.ts`: thêm hai mã lỗi vào regression UI.
- `tests/e2e/document-generation-real.spec.ts`: kiểm chứng API/provider/UI thật, resume/idempotency và không import.
- `docs/ai-provider.md`, `docs/ai-document-generation-fix.md`: cấu hình và báo cáo.
- `artifacts/ai-document-generation-fix/`: script kiểm chứng, ảnh, log và các báo cáo đã loại bí mật.

Không đổi schema database, Question Bank/exam business logic, auth, Face Verification, Proctoring hoặc LiveKit.

## Bằng chứng và các lần chạy chưa đạt

- `diagnosis-before.json`, `provider-variants.json`, `document-probes.log`, `document-model-probes.json`: kết quả provider thực tế.
- `backend-runtime.log`: log API/provider thật, gồm HTTP 200, parse, draft persistence và loại lỗi.
- `real-validation.json`: số câu, metadata các lượt AI, fingerprint ngân hàng, plan và scan key.
- `before-real-retry.png`, `after-real-preview.png`: ảnh thực tế.
- `backend-tests.log`, `support-regression.log`, `frontend-regression.log`, `real-e2e.log`, `typecheck.log`, `lint*.log`, `build.log`.

Giữ log các lần e2e chưa đạt: locator tìm tên file đang bị ẩn ở bước Cấu hình; provider HTTP 503 trước khi chọn model hoạt động; test đọc session quá sớm nhận DOCUMENT_BUSY/409 trong khi batch vẫn xử lý; một lần bị validation nguồn từ chối. Test đã sửa để chờ response batch thực tế thay vì chỉ chờ nút retry tạm ẩn. Lượt cuối chạy từ generation đến retry/UI/idempotency đạt trong khoảng 45 giây; các lượt trước không được tuyên bố PASS.

Chưa chạy toàn bộ backend/e2e suite. Sáu câu được sinh là bản nháp có cấu trúc và nguồn hợp lệ; giảng viên vẫn cần review chất lượng/ngữ nghĩa trước khi import. Số câu yêu cầu là giới hạn trên, không bù bằng nội dung giả khi nguồn không đủ căn cứ.
