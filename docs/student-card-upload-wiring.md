# Student Card: chọn file → preview → confirm

## Lỗi đã tái hiện

Regression test mở file picker qua nút thật, giữ GET status khi focus quay lại
trang, rồi chọn PNG. Với implementation cũ, số POST preview là **0**: refresh
status đặt `busy='status'` và thay toàn bộ nội dung bằng skeleton, gỡ input đang
được file picker sử dụng. Guard `if (busy) return` cũng bỏ file khi refresh đang
diễn ra. Test dùng trực tiếp `setInputFiles` trên input đã bỏ qua tình huống này.

Frontend nay có `statusLoading` riêng; refresh chỉ dùng skeleton khi chưa có
status ban đầu. Input và OCR preview giữ nguyên trong refresh nền. `operation`
chỉ khóa upload/confirm thật, không khóa khi đọc lại status. Epoch của status
ngăn GET cũ ghi đè kết quả confirm vừa thành công.

## Contract hiện có

- File JPG/PNG, tối đa 8 MB; reset input value để chọn lại cùng file.
- `FormData.append('image', file)` → POST `/identity/student-card/preview`.
- Client giữ Bearer per-tab và `credentials: include`; browser tạo boundary.
- Backend dùng envelope `{ data, meta }`. Preview chứa `preview_id`,
  `expires_at`, `card_preview_url`, `face_preview_url`, `extracted`,
  `comparison`, `can_confirm`, `blocking_errors`, `warnings`.
- Runtime validation kiểm tra contract trước JSX; không bỏ preview vì OCR
  thiếu field hoặc `can_confirm=false`. Không hiển thị payload/path sai cấu trúc.
- Confirm chỉ POST `{ preview_id }` → `/identity/student-card/confirm`.
  Response cập nhật status; profile/avatar được refetch bằng flow hiện có.

UI hiển thị spinner ngay khi nhận file, OCR partial và lỗi từng field. API lỗi
hoặc lỗi ảnh protected đều có thông báo an toàn và `Chọn ảnh khác`; lỗi ảnh
không xóa OCR đã đọc. Response lỗi không được đưa raw SQL/validation JSON lên UI.
Refresh profile/avatar/status không reset preview. Admin đổi version làm preview
hết hiệu lực để ngăn confirm dữ liệu cũ; thẻ VERIFIED ACTIVE vẫn không có upload.

## Log development

`CARD_FILE_SELECTED` chỉ chứa name/type/size của file. Các event
`CARD_PREVIEW_REQUEST_START`, `CARD_PREVIEW_RESPONSE`, `CARD_PREVIEW_ERROR`
chỉ chứa cờ kết quả/count/code/status. Không log OCR name/MSSV, ảnh, bytes,
base64, preview ID, filesystem path hoặc embedding. Log được tắt ở production.

## Môi trường dev

Audit phát hiện hai Next dev server (3000 và 3001) ghi cùng `.next-dev`, làm
manifest rỗng/sai JSON và route trả 404/500. Đã khôi phục một server và cố định
`npm run dev` ở cổng 3000. Lần chạy thứ hai báo port đang dùng thay vì tự chọn
3001 và ghi đè cache. Dev/build vẫn dùng hai thư mục đầu ra riêng.

## Phạm vi

Chỉ sửa frontend wiring/state/error UI và lệnh dev. Không sửa backend Student
Card, Tesseract, YuNet/SFace, FaceEngine hay cosine threshold 0.363.

## Kết quả kiểm tra

- Regression file picker trước sửa: POST preview = 0; sau sửa gửi 1 POST và
  render ảnh/OCR ngay cả khi GET status do focus vẫn đang chờ.
- 40 browser tests đạt: 34 Student Card/avatar và 6 stale-status/mobile layout
  (320, 375, 768, 1024, 1440 px). Có kiểm tra multipart/Bearer, partial OCR,
  400/401/403/422/500, same-file retry, malformed 200, protected-image failure,
  blocking errors, confirm và thẻ VERIFIED ACTIVE không có action upload.
- TypeScript kiểm tra source/test liên quan đạt; vẫn loại trừ lỗi type đã có
  trước trong `tests/e2e/exam-experience.spec.ts`.
- Chạy dev lần thứ hai báo EADDRINUSE ở 3000, không sinh server 3001. Server
  chính và backend tiếp tục chạy ở 3000/8000.
