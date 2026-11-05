# AI QUESTION GENERATION QUALITY

Đã bổ sung kiểm tra chất lượng riêng cho bản nháp sinh từ tài liệu. Không thay đổi schema database, Question Bank CRUD, chấm thi, auth, AI Support, Face Verification, Proctoring hoặc LiveKit. Các thay đổi có sẵn trong workspace ngoài phạm vi này được giữ nguyên.

## Kết quả chính — AI thật

Chạy 9 tổ hợp `mcq_single / mcq_multi / essay` × `easy / medium / hard`, mỗi tổ hợp yêu cầu 3 câu. Dùng ba DOCX đã có trong `D:/Download`, không tạo tài liệu hay phản hồi AI giả:

- `Tai_lieu_thu_nghiem_tao_cau_hoi_AI.docx`: 8 chunk, 1 hình.
- `ChuongV_DuToan_TrienKhai.docx`: 16 chunk, không có hình.
- `On_tap_quan_tri_mang_test_AI_dap_an.docx`: 49 chunk, 20 hình.

Model đang dùng: `gemini-3.5-flash-lite`, qua endpoint Gemini tương thích OpenAI hiện có. Tác vụ này không đổi khóa hoặc cấu hình model.

| Chỉ số của lượt đánh giá chính | Số lượng |
|---|---:|
| Generated candidates | 25 |
| Generated questions giữ trong preview | 21 |
| Valid — đạt toàn bộ kiểm tra tự động | 11 |
| Cần giảng viên xem lại | 10 |
| Rejected — không đưa vào preview | 4 |
| Grounded — lượt kiểm tra riêng xác nhận có căn cứ | 15 |
| Chưa xác nhận được căn cứ | 5 |
| Unsupported | 1 |
| Duplicate được phát hiện trong lượt thật | 0 |
| Ambiguous / sai cấu trúc đáp án bị loại | 4 |
| Lệch độ khó được gắn cờ | 7 |

Các cờ có thể giao nhau. `Generated candidates = 21 giữ lại + 4 bị loại`; 15 có căn cứ + 1 không được hỗ trợ + 5 chưa xác nhận = 21 bản nháp. Không cộng số liệu của những lượt thử trước hoặc bài kiểm tra retry riêng vào bảng này. Không tính tỷ lệ chất lượng giả định.

| Loại | Độ khó | Nháp giữ lại | Đạt tự động | Cần xem lại | Phủ phần nguồn đã giao |
|---|---|---:|---:|---:|---:|
| Một đáp án | Dễ | 3 | 3 | 0 | 3/3 |
| Một đáp án | Trung bình | 2 | 1 | 1 | 2/3 |
| Một đáp án | Khó | 2 | 1 | 1 | 2/3 |
| Nhiều đáp án | Dễ | 3 | 3 | 0 | 3/3 |
| Nhiều đáp án | Trung bình | 1 | 1 | 0 | 1/3 |
| Nhiều đáp án | Khó | 2 | 0 | 2 | 2/3 |
| Tự luận | Dễ | 3 | 2 | 1 | 3/3 |
| Tự luận | Trung bình | 3 | 0 | 3 | 3/3 |
| Tự luận | Khó | 2 | 0 | 2 | 2/3 |

Nguồn số liệu: [verified.json](../artifacts/ai-question-quality/verified.json), [summary.json](../artifacts/ai-question-quality/summary.json). Bản nháp đầy đủ được lưu trong khu vực private phía backend, không đưa khóa/token vào báo cáo.

## Thay đổi

- Generator nhận tiêu chí nhận thức cụ thể cho từng độ khó, yêu cầu phương án nhiễu hợp lý, đáp án mẫu và tiêu chí chấm tự luận. Câu nhớ một dữ kiện không được coi là khó chỉ vì có tình huống dài.
- Giữ chunk/section/page và trích dẫn nguồn. Gợi ý trích dẫn được lấy nguyên văn từ nguồn; máy chủ vẫn kiểm tra trích dẫn thật, không tự sửa trích dẫn sai thành đúng.
- Kiểm tra cấu trúc từng ứng viên riêng. Một ứng viên sai không làm mất các câu hợp lệ cùng lô. Câu nhiều đáp án phải có ít nhất hai đáp án đúng và ít nhất một phương án sai.
- Thêm lượt AI kiểm tra riêng về nguồn, bộ đáp án, độ rõ ràng, phương án nhiễu, tự luận, độ khó và gần trùng. Kiểm tra độ khó yêu cầu các thao tác phân tích thực sự; có thêm quy tắc gắn cờ câu nhớ dữ kiện rõ ràng.
- Trích dẫn kiểm định sai định dạng hoặc lượt kiểm tra lỗi được đánh dấu **chưa xác nhận**, không tính thành unsupported và không tự cho đạt.
- Phân bố nguồn theo toàn tài liệu, bỏ trang bìa chỉ có nhiều dòng tiêu đề in hoa. Tạo bù tối đa một lần cho phần còn thiếu trong cùng thời gian chờ; không sinh lại những câu đã thành công.
- Nếu tạo bù lỗi, lưu yêu cầu còn thiếu và lỗi an toàn trong phiên tài liệu. Lượt retry chỉ gửi phần thiếu, loại trừ nội dung đã có, giữ nguyên ID/nội dung câu thành công. HTTP 200 có kết quả một phần vẫn hiển thị trạng thái cần retry.
- Cảnh báo gần trùng Việt/Anh; kiểm tra lại khi import từ tài liệu, trong khóa ngân hàng hiện có. Metadata chất lượng không làm thay đổi mã nhận diện của một lần import đã xác nhận.
- Preview có “Kiểm tra tự động: Đạt / Cần xem lại”, lý do ngắn, nguồn và nút kiểm tra lại. Câu cần xem lại không được chọn mặc định. Sửa nội dung làm mất trạng thái đã kiểm tra. Giảng viên vẫn sửa/chọn/bỏ chọn/xóa/xem đáp án và xác nhận import riêng; đánh giá của giảng viên không bị AI ghi thành “Đạt”.

## Xác nhận theo yêu cầu

| Mục | Kết quả |
|---|---|
| Single-choice validation | PASS — cấu trúc và bộ đáp án được kiểm tra; câu nội dung đáng ngờ được gắn cờ |
| Multi-answer validation | PASS — loại 4 ứng viên sai bộ đáp án trong lượt chính |
| Essay validation | PASS — có đáp án mẫu; kiểm tra nội dung/tiêu chí chấm, giữ cờ khi chưa xác nhận được |
| Difficulty matching | **FAIL — 7 bản nháp lệch mức độ, đã gắn cờ** |
| Document coverage | **FAIL — 5/9 lô chưa phủ đủ nguồn kế hoạch**; 4/9 lô phủ đủ 3 phần |
| Retry failed sections | PASS — giữ thành công, gửi phần còn thiếu; xem bằng chứng dưới đây |
| Auto-import | **NO** |
| Human review | PASS — preview, sửa, chọn/bỏ chọn, xóa và xác nhận import còn nguyên |

PASS ở các mục validation thể hiện bộ kiểm tra và đường đi của dữ liệu hoạt động; không có nghĩa mọi câu đã được giảng viên chấp nhận. Lượt kiểm định dùng cùng nhà cung cấp AI trong một yêu cầu riêng, nên vẫn có giới hạn nhận định nội dung. Nhãn “Đạt” tự động không thay thế đánh giá chuyên môn. Không tạo nội dung thiếu căn cứ chỉ để đủ số lượng hoặc che các trường hợp FAIL.

## Kiểm chứng

- Backend: **48 tests PASS**, gồm quality boundaries, document API, image transport và AI management; thêm **1 test PASS** cho trạng thái nguồn còn thiếu khi provider timeout. Không có phản hồi AI thành công giả trong các test quality mới; transport tests cũ được tách khỏi lượt kiểm định riêng để giữ phạm vi kiểm tra.
- E2E: **10 PASS**, gồm 9 trường hợp trạng thái giao diện/feedback/retry và 1 trường hợp dùng auth thông thường cùng bản nháp AI thật. Không gọi import trong bài kiểm chứng thật. Màn hình hiển thị đáp án/cờ, sửa/chọn/bỏ chọn/xóa hoạt động; không tràn ngang ở 1440, 390 và 320px.
- Provider failure: chạy một phiên 2 lô bằng AI thật; chèn **ngoại lệ timeout có chủ đích** riêng ở lô 1, không tạo phản hồi hay câu hỏi giả. Lô lỗi trả 504; retry thật trả 200, giữ nguyên 2 bản nháp thành công và thêm 1 bản nháp mới. Gọi lại lô đã hoàn tất không tạo bản sao. Đây là kiểm tra lỗi có kiểm soát, không phải bằng chứng nhà cung cấp đã mất kết nối tự nhiên: [provider-retry.json](../artifacts/ai-question-quality/provider-retry.json).
- Kiểm tra yêu cầu nguồn còn thiếu ở backend xác nhận lỗi không xóa `pending_requirements` và nội dung thành công nằm trong danh sách loại trừ của retry. Bài E2E riêng kiểm tra HTTP 200 một phần vẫn có nút retry. Lượt thử bổ sung bằng provider thật không gặp nhánh lỗi tạo bù: [partial-retry.json](../artifacts/ai-question-quality/partial-retry.json); không tuyên bố đã quan sát lỗi tự nhiên ở lượt này.
- Ngân hàng thật: **10 câu trước và sau**, fingerprint nội dung/đáp án không đổi. Không nhập tự động.
- TypeScript: **PASS**, `tsc --noEmit`.
- Lint các file TypeScript liên quan: **PASS**, không cảnh báo/lỗi. Build toàn dự án vẫn có các cảnh báo hooks có sẵn ở file khác; không mở rộng sửa chúng.
- Production build cuối: **PASS**, Next.js 15.5.28, 42 trang, dist riêng `.next-recovery-ai-question-quality`. `tsconfig.json` và `next-env.d.ts` được khôi phục nguyên byte sau build.
- Secret scan: kiểm tra khóa provider thật trong artifacts của tác vụ và static bundle production, không in khóa. Kết quả lưu ở [secret-scan.json](../artifacts/ai-question-quality/secret-scan.json).

Logs: `artifacts/ai-question-quality/backend-final-verified.log`, `backend-partial-retry.log`, `e2e-final.log`, `typecheck-final.log`, `lint-final.log`, `build-final.log`. Lần thử E2E đầu không chạy được vì thiếu Chromium bundled; lần cuối dùng Edge đã cài và đạt đầy đủ 10 test. Không tính lần chưa chạy đó thành PASS.

Ảnh preview dữ liệu thật: [1440px](../artifacts/ai-question-quality/real-preview-1440.png), [390px](../artifacts/ai-question-quality/real-preview-390.png), [320px](../artifacts/ai-question-quality/real-preview-320.png).

## File thay đổi trong tác vụ chất lượng

Backend:

- `backend/app/services/question_quality.py` — kiểm tra chất lượng, gần trùng, fingerprint và tổng hợp.
- `backend/app/services/question_generation.py` — prompt, lọc từng ứng viên, tạo bù có giới hạn và lưu yêu cầu thiếu.
- `backend/app/services/question_document_drafts.py` — chọn nguồn và public quality summary.
- `backend/app/services/ai_metrics.py` — chỉ số chất lượng dạng số.
- `backend/app/schemas/question_documents.py` — metadata của bản nháp và payload kiểm tra lại, không phải schema database.
- `backend/app/api/v1/question_documents.py` — kiểm tra lại bản nháp, lưu retry phần thiếu, chống gần trùng khi import tài liệu.

Frontend:

- `app/dashboard/question-banks/[bankId]/documents/page.tsx`
- `app/teacher-workspace.css`
- `components/teacher/GeneratedQuestionQuality.tsx`
- `lib/question-quality.ts`
- `lib/question-documents.ts`
- `lib/api.ts`

Tests và báo cáo:

- `backend/tests/test_question_quality.py`
- `backend/tests/test_question_documents.py`
- `backend/tests/test_document_images.py`
- `tests/e2e/question-documents.spec.ts`
- `tests/e2e/question-quality-real.spec.ts`
- `docs/ai-question-generation-quality.md`

Các script đánh giá opt-in và kết quả nằm trong `artifacts/ai-question-quality/`. Token xác thực dùng để kiểm chứng chỉ lưu ở `backend/private/`; không đưa vào frontend bundle hay báo cáo.
