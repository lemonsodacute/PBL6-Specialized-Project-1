# Release checklist — 21/10/2026

Trạng thái: **READY cho demo local theo phạm vi kiểm chứng bên dưới**. Production deployment chưa được nghiệm thu. Gemini thật, LiveKit và Support browser thật đã qua. Full frontend cuối trả exit 1: 448/450 thành công, hai ca lỗi đồng bộ test. Sau sửa cách chờ UI/cuộn, hai ca được chạy hai lần mỗi ca: 4/4 thành công, TypeScript cuối exit 0. Không ghi full command là PASS và chưa chạy lại toàn bộ 450 sau chỉnh test; không có thay đổi product code sau lượt full này.

- [x] Production frontend build trên Next.js 15.5.28 đã vá critical advisory; build cuối sau sửa routing/answer adapter thành công.
- [x] Backend 596 tests OK (13 skip), 25 recheck OK sau sửa timeout/export, Gemini 3/3 thật OK.
- [x] Frontend: 448/450 trong full cuối; hai ca timing được sửa và recheck 4/4. Toàn bộ 450 ca có lần kiểm chứng thành công; full command vẫn được ghi exit 1.
- [x] TypeScript/lint/build cuối trên source hoàn tất, exit 0; lint có warnings đã ghi trong known limitations.
- [x] Fresh PostgreSQL upgrade head `0022_support_session_lifecycle`.
- [x] ORM/schema không còn drift; configured DB chỉ sửa 10 comment, không sửa business rows.
- [x] Secret scan source/docs + `.next/static`: 652 file, không tìm thấy configured secret/pattern; kiểm tra Git history riêng khi có repository.
- [x] Không còn production import/mock business fallback; lỗi API không chuyển sang dữ liệu mẫu.
- [x] API role/IDOR/disabled account và media ownership trên PostgreSQL QA.
- [x] Browser thật ba vai trò: login, refresh, wrong workspace, logout/back (3/3).
- [x] Browser thật làm bài với option ID/text và essay: autosave, refresh, submit, manual grade và Student/Teacher/bảng điểm cùng 3.5/4.
- [x] Attempt save/reload/submit hai lần và manual grade; DB/Student/Teacher/Report cùng điểm 3.5/4.
- [x] Class enrollment candidates/duplicate/remove và question CRUD bằng API thật.
- [x] Support escalation → Admin reply qua websocket và notifications/persistence trên PostgreSQL QA.
- [x] Support browser thật 3 role: escalation/realtime/unread/read/isolation/retry/history/refresh/mobile và close/new session.
- [x] Gemini Support thật, có source KB và persisted session.
- [x] Gemini Question thật DOCX/PDF images/source mapping/regenerate/import; transport giữ nguyên provider/model.
- [x] OCR worker thật: 5 ca thành công; 2 ca cần private fixture được skip.
- [x] YuNet/SFace thật: face hợp lệ, no-face, multiple, small, invalid image; mismatch xác nhận riêng trong artifact.
- [x] LiveKit SFU thật với Teacher/Student browser riêng: 6/6 ca media, participants, reconnect/end/attendance, device denial, cleanup/retry; sửa local loopback candidate.
- [x] Regression responsive 360/390/430/768/1024/1440+, dark mode, floating action; camera setup 768px recheck hai lần thành công.
- [x] Seed DEMO riêng có ba role, class/bank/exams/completed attempt/notification/support/live schedule; không fake identity.
- [x] [README](../README.md), [demo script](demo-script.md), [known limitations](known-limitations.md).
- [ ] Cấu hình triển khai production, email transport thật, remote device/WAN rehearsal.

## Bằng chứng và lệnh

Logs/trace QA nằm trong `artifacts/release-qa/` đã ignore; credentials/fixtures nằm trong `backend/private/release-qa/`. Không chia sẻ các thư mục này như public artifact. Các lệnh tái lập nằm trong README; chỉ chạy acceptance trên QA database do helper tạo.

Các dịch vụ tạm phục vụ QA đã dừng sau kiểm tra; QA database và seed DEMO được giữ lại. Khởi động lại bằng lệnh QA runtime trong README; cấu hình kết nối database ứng dụng không bị thay đổi.

Logs cuối: `frontend-final-all.log` (448 pass, 2 fail, 24.4 phút, exit 1), `final-flake-recheck.log` (4/4 pass), `typescript-final.exit` (0), `livekit-final.log` (6/6 pass), `support-live.log` (1/1 pass). Full cuối cũng xác nhận lại 6/6 LiveKit và 4/4 browser auth/attempt thật. Trước phát hành production cần full regression xanh trên môi trường CI ổn định, probe lại provider ở môi trường đích và nghiệm thu cấu hình/SMTP/thiết bị/WAN. [Báo cáo QA theo 38 mục](final-qa-report.md).
