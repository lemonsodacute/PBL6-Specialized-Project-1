# Final QA — AI PROCTO — 21/10/2026

## Phạm vi và cách đọc kết quả

Giữ nguyên Modern Academic, CSS/color system, navbar/sidebar `#006D77`, dark mode, YuNet/SFace/threshold 0.363, OCR và provider/model Gemini. Hash CSS theme, `face_config.py` và `face_recognition.py` khớp snapshot trước QA. Không đổi công thức chấm điểm, schema nghiệp vụ hoặc dữ liệu người dùng để tạo kết quả đẹp.

Có ba mức bằng chứng riêng:

1. UI regression với fixture API: kiểm tra trạng thái/interaction/layout/error, không chứng minh provider/SFU hoạt động.
2. Acceptance PostgreSQL QA + API thật và browser thật: kiểm tra persistence, quyền, điểm và luồng tài khoản.
3. Integration Gemini, OCR worker, YuNet/SFace và LiveKit thực: kết quả ghi riêng, không thay bằng mock khi lỗi.

Database acceptance do `release_qa_runtime.py` tạo có tên riêng; helper không thay `.env`. Database ứng dụng chỉ được đọc để audit/head/schema và đồng bộ 10 comment mô tả baseline có backup; không thay business rows. Migration round-trip dùng database tạm có tên/guard riêng.

## Lỗi đã sửa

- Gỡ mock login/mock data/quick login/mock attempt khỏi production imports; API lỗi không hiện dữ liệu mẫu.
- Logout gọi API xóa HttpOnly cookie; sửa Admin login destination, guard sai workspace và Teacher/Admin layout. Bỏ middleware đọc role từ JWT chưa xác minh; API vẫn xác thực JWT rồi lấy role/ownership thực từ database.
- Bảo vệ URL recording, snapshot và export theo quyền attempt/exam. Public uploads không phục vụ đường dẫn legacy/unreferenced. Response private/no-store/nosniff.
- Chặn CSV/XLSX formula injection trong field do user nhập; giữ numeric cell cho số liệu.
- Chặn chuỗi rỗng/quá dài, null không hợp lệ và khoảng thời gian ngược; kiểm tra date khi cập nhật một phần exam. Giữ policy về assignment/enrollment và grading.
- Audit log chuẩn hóa địa chỉ IP trước khi ghi vào PostgreSQL INET; host không hợp lệ không làm login trả 500.
- Log OCR/email/submit/WebRTC không chứa nội dung thẻ, reset token, response bài làm hoặc exception object thô. Không log filename ảnh thẻ.
- Sửa fresh migration bị trùng table/column do baseline lịch sử; đồng bộ metadata comments và sửa rollback enum để giữ loại thông báo khác.
- Sửa debounce search/filter để request không kết hợp bộ lọc mới với từ khóa cũ.
- Menu thao tác không còn tự đóng bởi scroll event khi mở trong modal; vị trí cập nhật theo anchor, focus không làm cuộn trang. Có regression mobile cho modal thẻ sinh viên.
- Sửa MCQ render/restore cho cả string choices và `{id,text}`; kết quả hiển thị nhãn thay ID. Payload chấm điểm vẫn dùng giá trị gốc, backend grading không đổi.
- Sửa transport Gemini: request được dùng đủ timeout cấu hình; không hủy ở nửa deadline để giữ thời gian cho một retry. Retry vẫn tối đa hai lần và nằm trong ngân sách còn lại. Integration thật qua cả Question và Support.
- SFU local bật loopback candidate phù hợp với `node_ip: 127.0.0.1`; sửa DTLS timeout ở context thứ hai. 6/6 LiveKit acceptance thật đã qua; media đầu vào tổng hợp, SFU/ICE/WebRTC/API đều thật.
- Nâng Next.js lên 15.5.28 và PostCSS đã vá; production npm audit không có advisory. Cơ sở: [Windows RCE advisory của Next.js](https://github.com/advisories/GHSA-p293-qw3h-jr36), [hướng dẫn migration Next.js 15](https://nextjs.org/docs/app/guides/upgrading/version-15). Dev toolchain braces còn advisory upstream, ghi rõ ở limitations.

## Ma trận yêu cầu

| # | Nội dung | Bằng chứng / giới hạn |
| --- | --- | --- |
| 1 | Auth | PostgreSQL register/login/email case/refresh/disabled/logout; browser thật ba role, reload, wrong workspace, Back |
| 2 | Profile/card | API/UI preview-confirm-replace-revoke-reference lifecycle; OCR và face thật riêng; private physical-card fixture chưa được cung cấp |
| 3 | Face | YuNet/SFace thật: same face .9931, different face .1255, no/multiple/small/invalid; version/reference gate có API/PG regression |
| 4 | Class | API PG create/add/exclude duplicate/remove/reappear; UI candidates/race/filter |
| 5 | Bank | API PG CRUD/search/delete và UI bulk/pagination; không production mock import |
| 6 | AI Question | 3 live integration: DOCX draft/regenerate/import, DOCX/PDF vision/source mapping/protected image, Support; rating/review/retry có API/PG/UI regression |
| 7 | Exam create | API PG create/questions/assignment/publish; UI select/quick-random/edit/close/error regression |
| 8 | Student list | Status/sort/exclude-submitted có API/unit/UI; result/history dựa attempt status |
| 9 | Attempt | PG save/reload/submit hai lần; UI device/media/timer/reconnect/teardown regression; browser thật core attempt xác nhận riêng |
| 10 | Score | Cùng attempt DB 3.5/4, Student result, Teacher result và Reports đều khớp |
| 11 | Manual grade | Negative/over-max 422; wrong Teacher/Student 403; authorized grade cập nhật tổng từ DB |
| 12 | Monitor | API và UI trạng thái/events/camera controls; không dùng ảnh/video giả làm dữ liệu production. Chưa chứng minh camera vật lý từ xa |
| 13 | Live Class | 6/6 SFU/browser thật: video/audio, participants, controls/chat, refresh/reconnect, leave/end, revoked stale token và attendance; chưa thử phần cứng/WAN |
| 14 | Notification | PG persisted read/all-read/count, support reply; UI menu/count/deep link/race |
| 15 | AI Support | Gemini thật + KB source/persist; chặn theo active exam/role, không truy vấn nội dung đề để trả lời support |
| 16 | Escalation | PG guided KB → escalation → Admin inbox → reply qua websocket; isolation/close/empty message |
| 17 | Admin user/card | Backend role/ownership; UI action timing, status/revoke/profile requests và protected avatar |
| 18 | Audit | Admin-only API, sanitized IP, search/filter regression; không trả private exception input |
| 19 | Knowledge Base | Admin-only managed KB APIs; category/role/retrieval/source regression |
| 20 | AI Activity | Metadata-only activity/metrics và admin permission regression |
| 21 | Public home | Responsive/light/dark/CTA/auth routing tests; không gọi API dữ liệu riêng khi chưa login |
| 22 | Mock/fallback | Không còn business mock import trong app/components/lib; mock folder chỉ giữ fixture không dùng ở production |
| 23 | Error states | UI loading/empty/error/retry/network và pending-action regression, không success giả |
| 24 | Permission | PG direct API role, forged role claim, IDOR/random UUID, wrong owner/class/attempt, disabled account |
| 25 | Validation | PG whitespace/length/null/date/UUID/duplicate/score; upload MIME/size/malformed và empty message trong suite |
| 26 | File security | Card/document/question image/private media ownership; path traversal/name validation/no-store |
| 27 | Secrets | First-party source/docs và browser chunks được so với configured secrets + patterns; Git history chưa có metadata để audit |
| 28 | Logging | OCR/email/submit/WebRTC/AI diagnostics đã lọc, validation không trả credential input |
| 29 | Responsive/dark | Automated geometry/contrast + screenshots 360/390/430/768/1024/1440 và visual spot check ba role |
| 30 | Floating UI | Chat/camera avoidance, menu/modal z-index, submit/pagination/navigation geometry regression |
| 31 | Build/tests | Lệnh/log/count cuối tại checklist; không lấy test bị skip làm pass |
| 32 | Migration | Fresh upgrade → head22, ORM check; rollback/upgrade integration và baseline adoption trên DB tạm |
| 33 | Demo seed | Ba role, class, bank, published/current/upcoming exams, graded attempt, support/notification/live schedule trong QA DB |
| 34 | Demo script | `docs/demo-script.md`, flow 10–15 phút và expected result theo account/route |
| 35 | README | Stack/setup/env/migration/Gemini/OCR/face/realtime/test/demo commands; không chứa password seed thật |
| 36 | Limitations | `docs/known-limitations.md`, gồm biometric calibration, physical fixture/device/WAN, mail transport và dev advisory |
| 37 | Checklist | `docs/release-checklist.md`, chỉ tick khi có bằng chứng |
| 38 | Final | Chỉ kết luận READY khi gate bắt buộc qua; production deployment có điều kiện cấu hình riêng |

## Bằng chứng kiểm thử

Artifacts được giữ local và ignore trong `artifacts/release-qa/`:

- `backend-tests-final.log`: 596 tests, OK, 13 skip có lý do.
- `backend-final-recheck.log`: 25 tests sau sửa timeout/export, OK; gồm test mới về full timeout budget.
- `configuration-final.log`: 6 tests OK, gồm load `.env.example` và production guard từ chối placeholder/insecure settings.
- `gemini-live-final.log`: 3 integration với Gemini thật, OK (214.083s), không auto-import trước review.
- `ocr-live.log`: 7 tests, OK, 2 skip private fixtures; 5 chạy worker local thật.
- `face-live.json`, `face-mismatch.json`: actual ONNX inference; không chứa embedding hoặc ảnh.
- `final-targeted.log`: 9/9 thành công; gồm ba role login/refresh/routing/logout/back trên API thật, core attempt MCQ/essay autosave/refresh/submit/manual grade/result/grades cùng 3.5/4 và 5 regression từng lỗi.
- `support-live.log`: 1/1 thành công trên ba browser context, PostgreSQL/REST/WebSocket thật: session lifecycle, escalation, Admin reply, unread/read, IDOR, refresh/history/mobile, retry không nhân đôi và đóng/mở phiên mới. `menu-support.log` giữ lần đầu 9 ca card pass/1 assertion nhãn cũ fail; nhãn đã cập nhật và support chạy lại thành công.
- `migrations-upgrade.log`, `migrations-check.log`, `migrations-current.log`, `configured-db-check.log`: fresh/head/schema consistency.
- `livekit-final.log`: 6/6 thành công (1.4 phút); `livekit-media.log` xác nhận riêng ca media sau sửa loopback. `livekit-initial.log` giữ lần lỗi trước sửa.
- `frontend-tests-final.log`: lần 2 workers có 433 pass, 5 fail, 10 skip và worker error; không tính lệnh này là pass. Các ca fail được sửa fixture/assertion/cleanup và recheck 9/9; full regression một worker có log riêng.
- `frontend-regression-interrupted.log`: dừng chủ động khi phát hiện menu trong modal tự đóng bởi scroll; đã sửa product code, thêm mobile regression và build lại thành công.
- `frontend-final-all.log`: full 450 ca, một worker, bật cả ba bộ acceptance thật; 448 pass, 2 fail, exit 1 (24.4 phút). LiveKit 6/6 và auth/attempt thật 4/4 đều pass. Hai lỗi còn lại: camera setup 768px chưa render trong timeout assertion và support history cuộn trước khi danh sách ổn định.
- `final-flake-recheck.log`: sau chỉnh thời gian chờ camera, chờ chat hết loading/đã cuộn tới tin mới và dùng wheel thực, chạy mỗi ca hai lần: 4/4 pass (1.9 phút). Chỉ sửa test sau full, không đổi product code. Không chạy lại toàn bộ 450 sau chỉnh test; kết quả full vẫn ghi FAIL, không thay bằng kết quả recheck.
- `frontend-check-exits.json`: production build/lint/TypeScript đều exit 0; `typescript-final.exit` xác nhận TypeScript 0 sau các chỉnh sửa test cuối.
- `secret-scan.json`, `npm-audit-production.json`: scan có phạm vi đã ghi rõ; không phải penetration test/chứng nhận security.

Fixtures/credentials và thông tin kết nối chỉ nằm trong `backend/private/release-qa/` đã ignore. Không publish artifacts/trace/private data hoặc `.env` cùng source. Workspace không có Git history để xác nhận trạng thái tracked files; phải kiểm tra trên repository thực trước khi publish.

Kết luận: **READY cho demo local** với các giới hạn đã công bố. Mọi ca trong 450 đã có lần kiểm chứng thành công, gồm recheck sau chỉnh test; không có critical product bug đang mở từ đợt audit này. Chưa chứng nhận production release: cần full command xanh trên CI ổn định, cấu hình production/SMTP và rehearsal thiết bị/WAN theo checklist.
