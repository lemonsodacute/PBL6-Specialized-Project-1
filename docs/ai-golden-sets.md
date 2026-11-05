# Golden sets bổ sung cho AI Chatbox và Question Search

Đã thêm đủ 13 set theo yêu cầu: **60 câu Chatbox + 70 query Search**, kèm **10 query có dấu** để đối chiếu từng cặp với Set 9. Mọi case giữ `review_status = NEEDS_HUMAN_REVIEW`. Đây là bộ nhãn dự thảo để review; **chưa chạy benchmark mới, chưa có điểm chính xác mới**.

## Dữ liệu và tài liệu review

Các prompt gốc, expected facts và forbidden claims nằm trong source:

- [Chatbox: 60 case](../backend/evaluation/golden_sets/chatbox.json).
- [Search: 70 query gốc](../backend/evaluation/golden_sets/question-search.json).
- [Script chuẩn bị và kiểm tra](../backend/scripts/prepare_ai_golden_sets.py).

Gói review đã tạo tại `artifacts/ai-evaluation/golden-sets-v2/`:

- [REVIEW.md](../artifacts/ai-evaluation/golden-sets-v2/REVIEW.md): toàn bộ câu hỏi, kỳ vọng, phát biểu cấm, nội dung câu hỏi DB và ID đề xuất.
- [chatbox-review.csv](../artifacts/ai-evaluation/golden-sets-v2/chatbox-review.csv): review facts, vai trò, category, hành vi và ghi chú hiện thực.
- [question-search-review.csv](../artifacts/ai-evaluation/golden-sets-v2/question-search-review.csv): mỗi query một dòng, đủ cả query không có candidate.
- [search-candidate-review.csv](../artifacts/ai-evaluation/golden-sets-v2/search-candidate-review.csv): mỗi cặp query–question một dòng; có `human_grade`, `reviewer`, `review_notes` để điền.
- [question-corpus.csv](../artifacts/ai-evaluation/golden-sets-v2/question-corpus.csv): toàn bộ 200 câu thuộc phạm vi snapshot để kiểm tra cả false negatives của bước đề xuất.
- [KB-REVIEW.md](../artifacts/ai-evaluation/golden-sets-v2/KB-REVIEW.md): 27 bài KB để đối chiếu độ bao phủ.
- [chatbox-cases.json](../artifacts/ai-evaluation/golden-sets-v2/chatbox-cases.json), [question-search-cases.json](../artifacts/ai-evaluation/golden-sets-v2/question-search-cases.json), [manifest.json](../artifacts/ai-evaluation/golden-sets-v2/manifest.json): dataset và provenance máy đọc được.

`artifacts/` được Git ignore theo cấu hình hiện có. Fixture và script trong `backend/` cho phép tạo lại gói review từ DB; ID cụ thể trong gói hiện tại chỉ có ý nghĩa với snapshot đi kèm. Không đưa dữ liệu riêng của DB vào fixture dùng chung.

## Phân nhóm

| Set | Nội dung | Số case | Chỉ số sau khi duyệt và chạy |
|---|---|---:|---|
| 1 | Core Functions | 10 | Correctness, relevance |
| 2 | Identity & Face Verification | 10 | Correctness, hallucination |
| 3 | Online Classroom | 10 | Correctness, groundedness |
| 4 | Exam Monitoring / Proctoring | 10 | Correctness, groundedness |
| 5 | Out-of-scope / Escalation | 10 | Correct fallback / escalation rate |
| 6 | Adversarial Hallucination | 10 | False-premise correction, hallucination |
| 7 | Exact Keyword Search | 15 | Precision@1/3/5 |
| 8 | Semantic Search | 10 | Precision@K, Recall@5, MRR |
| 9 | Vietnamese Without Accents | 10 + 10 đối chiếu | So sánh chất lượng và độ trùng kết quả theo cặp |
| 10 | Typo Robustness | 10 | Báo cáo khả năng hiện tại riêng |
| 11 | Mixed Vietnamese + English | 10 | Precision@K, Recall@5, MRR |
| 12 | Long Natural-language Query | 10 | Precision@K, Recall@5, MRR |
| 13 | Negative Search | 5 | False retrieval rate |

## Nguồn ID và giới hạn của nhãn đề xuất

Snapshot được lấy bằng transaction PostgreSQL `REPEATABLE READ READ ONLY`: 215 câu tổng cộng trong DB, 200 câu thuộc 20 ngân hàng active và loại câu hỏi được endpoint hỗ trợ. Phạm vi giữ câu inactive nếu endpoint mặc định vẫn trả về chúng. Snapshot lúc `2026-10-26T17:46:11.719022+00:00`; SHA-256 corpus:

```text
b50bbc9c65b595f6767e4c2918c25c076b1efab6424ebefa3cc40fe424ec4ae7
```

`relevant_question_ids` và `highly_relevant_question_ids` trong gói review chỉ chứa ID thật từ snapshot. Script đề xuất nhãn bằng các quy tắc nội dung/chủ đề có thể đọc trong `RULES`, độc lập với thứ hạng của search. Đây chưa phải ground truth đã duyệt; tên trường giữ đúng format người dùng yêu cầu. Mức 2 là trực tiếp, mức 1 là liên quan một phần, mức 0 là không liên quan. `highly_relevant_question_ids` luôn là tập con của `relevant_question_ids`.

72 query có candidate trực tiếp theo quy tắc dự thảo; 3 query chỉ có candidate liên quan một phần: `REST API authentication`, `JavaScript event listener`, `TCP handshake`. Không gán câu trả lời hoàn toàn đúng cho một ý định chỉ có nội dung gần tương tự. Các mức 1 như hashing so với encryption, GET so với cập nhật bằng PUT, hoặc React so với DOM cần được reviewer xem kỹ và có thể loại bỏ.

Năm query negative có danh sách ID rỗng theo giả thuyết người dùng đưa ra. Quy tắc negative không tự chứng minh corpus thiếu chủ đề; `negative_expectation = PENDING_CORPUS_REVIEW` yêu cầu kiểm tra toàn corpus trước khi duyệt. Tương tự, không tìm được candidate bằng quy tắc không có nghĩa không tồn tại câu phù hợp.

Endpoint hiện tại tìm **trong một ngân hàng**. Gói review có `bank_contexts` để chia ID theo đúng ngân hàng nhưng không giả lập một search toàn cục. Trước benchmark phải cố định ngân hàng cho từng query; nếu chạy cùng query qua nhiều ngân hàng, ghi rõ số query gốc và số query–bank trials, tránh tăng trọng số ngầm. Negative controls cũng cần ngân hàng cụ thể. Không dùng tất cả ID từ các ngân hàng khác nhau làm mẫu số Recall của một lần gọi endpoint.

Set typo là phép đo khả năng, không phải yêu cầu bắt buộc fuzzy search. Set semantic và câu dài đo khoảng cách giữa nhu cầu người dùng và chức năng hiện tại; không mặc định endpoint SQL tìm chuỗi hiện tại là semantic AI search. Các cặp có/không dấu dùng cùng relevance labels, nhưng phải chạy độc lập mới biết kết quả có tương đương hay không.

## Các điểm cần review ở Chatbox

- Reset mật khẩu có API tạo và sử dụng token; code hiện chưa có email provider. Không hứa email đã được gửi.
- Enrollment/check 3-selfie cũ trả HTTP 410. Xác minh hiện dùng reference thẻ đã xác nhận và YuNet/SFace. Route verify lưu kết quả nhưng `image_path=None`; điều này không có nghĩa các luồng recording khác không lưu video.
- Recording phụ thuộc quyền host, Egress và thao tác bật; sinh viên xem lại theo trạng thái publish và quyền truy cập. Host gửi yêu cầu bật mic, không bật âm thầm.
- Alert và xác minh danh tính không tự chứng minh gian lận. Timeline/evidence phụ thuộc dữ liệu đã lưu; không tạo bằng chứng giả để lấp chỗ trống.
- READY là trạng thái cần kiểm chứng runtime/model. Benchmark Chatbox/Search không phải accuracy của nhận diện mặt hoặc proctoring.
- Case hỏi khả năng Admin chạy với role student; giao diện admin hiện là hộp thư hỗ trợ, không giả lập một AI chatbot dành riêng cho admin.

`application_evidence` là các file để đối chiếu, có hash trong manifest. `kb_coverage_review` vẫn chờ review: tính năng có trong code không có nghĩa trợ lý đã được cung cấp bài KB về tính năng đó. Không đưa expected facts hoặc nội dung source vào prompt của hệ thống khi benchmark. Cần ghi nhận riêng fallback an toàn, độ bao phủ KB và mức đáp ứng câu hỏi; fallback an toàn không tự động nhận điểm đầy đủ cho nội dung chưa trả lời.

## Quy trình duyệt và chấm tiếp theo

1. Review `REVIEW.md` cùng snapshot KB/source. Sửa facts và forbidden claims khi cần; ghi reviewer, ngày và lý do. Các facts về runtime phải kèm bằng chứng hiện hành.
2. Với Search, điền `human_grade` 0/1/2 trong CSV candidate và kiểm tra `question-corpus.csv` để thêm ID bị bỏ sót. Duyệt cả empty/negative query; chọn bank scope trước khi chạy.
3. Lưu nhãn đã duyệt thành một phiên bản mới, giữ nguyên bản dự thảo và snapshot. CSV là biểu mẫu review, script hiện không tự nhập quyết định CSV trở lại JSON. Chỉ đổi trạng thái sang đã duyệt khi người review đã xác nhận, có metadata reviewer và thời điểm.
4. Chạy trên dataset đã duyệt với scorer phù hợp. Schema 2 dùng facts bằng ngôn ngữ tự nhiên và phạm vi review toàn corpus; chưa tương thích trực tiếp rubric trích xuất KB của evaluator schema 1. Evaluator cũ hiện chặn dataset chưa review và schema 2 để tránh báo điểm sai hoặc gọi provider nhầm.

Rubric đề xuất cho lần chấm tiếp theo: Correctness 0/1/2 tương ứng sai hoặc không đáp ứng / đáp ứng một phần / đáp ứng đủ facts và điều kiện. Chấm hallucination dựa trên khẳng định thực tế không có căn cứ và forbidden claims; không suy ra hallucination chỉ từ việc câu trả lời thiếu ý. Set 5 báo tỷ lệ phản hồi giữ đúng giới hạn hoặc chuyển hỗ trợ trên 10 case, đồng thời kiểm tra không khẳng định đã thực hiện thao tác.

Search dùng relevance đã duyệt: grade > 0 cho Precision/Recall/MRR, grade 2 nếu báo cáo thêm strict precision; không trộn hai định nghĩa. Báo cáo nDCG có thể dùng cả grade 1/2. Negative false retrieval là tỷ lệ query negative đã duyệt trả về ít nhất một kết quả không liên quan; báo riêng, không gán Recall cho query không có relevant ID. Các chỉ số này là kế hoạch chấm, chưa phải kết quả đo.

## Chạy lại

Từ thư mục gốc dự án, kiểm tra gói đã tạo, không kết nối DB hoặc ghi file:

```powershell
& backend/.venv/Scripts/python.exe backend/scripts/prepare_ai_golden_sets.py --validate-only
```

Tạo snapshot/gói review mới từ DB đang cấu hình; dùng thư mục mới để không ghi đè nhãn đã review:

```powershell
& backend/.venv/Scripts/python.exe backend/scripts/prepare_ai_golden_sets.py --output artifacts/ai-evaluation/golden-sets-next
```

Script không gọi provider, không sửa DB và không tính accuracy. Nếu thư mục đã chứa dataset, script từ chối ghi đè. Snapshot có checksum; bằng chứng nguồn có hash. Bộ baseline và báo cáo đánh giá trước đó vẫn được giữ riêng.

Kiểm tra tự động từ thư mục `backend`:

```powershell
& .venv/Scripts/python.exe -m unittest tests.test_ai_evaluation tests.test_ai_golden_sets
```

17 test đã pass, gồm metric baseline, ID giả, checksum, cặp có/không dấu, nhầm normalization DB với ML, trạng thái chưa duyệt, chặn rubric không tương thích và xuất CSV đầy đủ các trường tùy chọn.
