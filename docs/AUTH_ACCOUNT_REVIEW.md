# Authentication và Hồ sơ sinh viên — hoàn thiện

## Kiến trúc hiện tại

- Frontend dùng Next.js App Router; `/login` chứa các chế độ đăng nhập, đăng ký, quên mật khẩu và đặt lại mật khẩu.
- `components/auth/AuthContext.tsx` giữ user/token trong `sessionStorage` của từng tab. Backend cũng cấp cookie JWT access/refresh với HttpOnly.
- API: `POST /api/v1/auth/login`, `/register`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`; `GET /api/v1/auth/me`.
- Backend xác minh JWT và lấy user từ database trong `get_current_user`; các API giới hạn role qua `require_role`/`roles`.
- Role hiện có: `student`, `teacher`, `admin`. Sau authentication, frontend lấy role từ response: sinh viên → `/student`; giảng viên/admin → `/dashboard`, nơi nội dung được chọn theo role.
- Mật khẩu được hash bằng bcrypt. Validation hiện tại là 8–128 ký tự; giao diện không tự thêm yêu cầu chữ hoa, số hoặc ký hiệu.

## Dữ liệu có sẵn

| Trường | Trạng thái |
| --- | --- |
| `full_name`, `email`, `password_hash`, `role` | Có trong `User`; password hash không được trả về frontend |
| `student_code`, `teacher_code`, `major`, khóa học | Chưa có; không tạo trường hoặc dữ liệu giả |
| Lớp | Qua `Class`/`ClassEnrollment`, không phải trường đăng ký tài khoản |
| Avatar | Có `avatar_url` |
| Trạng thái | Có `is_active` |
| Dữ liệu hồ sơ khác | Có `phone`, `created_at`, `last_login_at`, `updated_at` |

Không có model Student/Teacher độc lập chứa mã định danh học vụ. Backend public register luôn tạo sinh viên. Admin có endpoint quản lý tài khoản để cấp role giảng viên.

## Registration

- Giữ form đã hoàn thiện: họ tên, email, vai trò sinh viên, mật khẩu và xác nhận mật khẩu.
- Tên sau khi trim phải có 2–255 ký tự, email đúng định dạng, mật khẩu 8–128 ký tự, xác nhận phải khớp.
- Hai mật khẩu có nút hiện/ẩn riêng; chỉ báo độ mạnh là gợi ý, không bổ sung quy tắc bắt buộc.
- Lỗi được liên kết với input; email trùng hiển thị “Email này đã được sử dụng.”
- Loading vô hiệu hóa form/nút; guard đồng bộ chặn gửi trùng trong khi request đang chạy.
- Thành công vẫn tự đăng nhập theo response backend.
- Không cho chọn giảng viên/admin ở public registration, không gửi role hoặc confirm password trong payload. Giảng viên được admin cấp theo nghiệp vụ có sẵn.

## Login và phục hồi mật khẩu

- Chỉ email và mật khẩu; role được lấy từ tài khoản đã xác thực.
- Thông báo chung cho sai email/password, thông báo riêng cho lỗi mạng, rate limit và tài khoản không thể đăng nhập.
- Tìm email khi đăng nhập không phân biệt hoa/thường, kể cả email cũ do admin nhập có chữ hoa.
- Tài khoản `is_active=false` bị chặn trước khi cấp token/cookie. Chỉ báo trạng thái này sau khi mật khẩu đã đúng; sai mật khẩu vẫn nhận `INVALID_CREDENTIALS` như tài khoản không tồn tại.
- Quên/đặt lại mật khẩu kết nối API có sẵn, dùng token thực do server cấp. Không giả lập gửi email hoặc hard-code token trong sản phẩm.
- Khi chuyển form, focus chuyển đến trường phù hợp; token được cấp xong thì focus mật khẩu mới, reset thành công thì quay lại đăng nhập.
- Giữ logo, font, nền xanh nhạt, card trắng và teal primary; dùng cùng UI responsive đã hoàn thiện.

## Backend thay đổi trong lần hoàn thiện này

| File / endpoint | Thay đổi |
| --- | --- |
| `backend/app/api/v1/auth.py` — `/login` | Tìm email không phân biệt hoa/thường; trả HTTP 403 với code `ACCOUNT_DISABLED` khi đúng mật khẩu nhưng tài khoản đã vô hiệu hóa; không cấp phiên |
| `backend/app/schemas/auth.py` — `RegisterRequest` | Trim họ tên trước validation độ dài; `extra='forbid'` từ chối role hoặc trường ngoài schema bằng HTTP 422 |
| Database | Không đổi schema, không migration |
| Password/token | Không đổi password policy, hash format, cấu trúc JWT/cookie, refresh hoặc logout |

Payload đăng ký hợp lệ vẫn là `{ full_name, email, password }`. Khác biệt tương thích cần biết: trước đây trường thừa bị bỏ qua; nay request gửi thêm role hoặc trường khác nhận 422. Role của tài khoản mới vẫn luôn là `student`.

## Hồ sơ sinh viên

Phần hồ sơ đã triển khai được giữ lại và kiểm tra cùng auth:

- Account menu mở bằng tên/email hoặc avatar; chứa **Hồ sơ sinh viên** và một nút **Đăng xuất**.
- Route `/student/profile` gọi `/auth/me` và `/classes`; user được xác định từ phiên xác thực, không nhận ID sinh viên tùy ý.
- Hiển thị tên, email, điện thoại, role, trạng thái, ngày tạo và lớp học phần thực có; ảnh lỗi/thiếu dùng initials.
- Mô tả trung tính **Ảnh hồ sơ của sinh viên.** Avatar chưa được coi là ảnh tham chiếu đáng tin cậy cho nhận diện.
- Có loading, lỗi/retry, thiếu dữ liệu, layout mobile và thao tác bàn phím.
- Không thêm upload, không chuyển enrollment vào hồ sơ.

Phần mở rộng response `/auth/me` cho hồ sơ (`phone`, `avatar_url`, `is_active`, `created_at`) đã có từ lần triển khai trước; lần hoàn thiện này không sửa thêm API hồ sơ.

## Tests/build

Kết quả cuối:

- **91/91 test backend đạt**, gồm 11 test auth/account mới và các test hồ sơ/Face Verification hiện có.
- **28/28 test trình duyệt đạt trên production build**: 17 test auth và 11 test hồ sơ sinh viên.
- **Typecheck đạt** với `--noEmit --incremental false`.
- **Production build đạt**, tạo 28 static pages và biên dịch thành công các route động.
- Đối chiếu snapshot: **46 file được bảo vệ không đổi**, gồm core/model/service backend, migration, Face Verification, exam attempts, hồ sơ và cơ chế AuthContext/API hiện có. Không có trailing whitespace trong các file code thay đổi lần này.
- Lint chưa có cấu hình; không tuyên bố lint pass và không cài dependency.

Test backend dùng database mock và tài khoản tổng hợp; test trình duyệt chặn API bằng fixtures, không đăng ký hoặc thay đổi dữ liệu thật.

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
$env:PLAYWRIGHT_CHANNEL = 'msedge'
# Khởi động preview trên cổng 3100 trước; có thể đổi URL sang dev server đang chạy.
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:3100'
node node_modules/@playwright/test/cli.js test auth-ui student-profile
# Trong thư mục backend:
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
```

Production build được thực hiện trên bản sao source riêng cùng ổ đĩa để không ghi đè `.next` của workspace. Dev server cổng 3000 đã dừng trong khi kiểm tra, nên dùng production server riêng cho browser tests. Không cài dependency mới.

## Files changed

- `app/login/page.tsx`: focus khi chuyển chế độ và sau reset.
- `backend/app/api/v1/auth.py`: email lookup và chặn tài khoản vô hiệu hóa.
- `backend/app/schemas/auth.py`: validate tên đã trim và từ chối trường thừa.
- `backend/tests/test_auth_account.py`: 11 test backend mới cho auth/account.
- `tests/e2e/auth-ui.spec.ts`: bổ sung focus, lỗi mạng/retry, giới hạn mật khẩu và lỗi đăng ký.
- `docs/AUTH_ACCOUNT_REVIEW.md`, `docs/FRONTEND_UI_REVIEW.md`: cập nhật báo cáo.

Các file UI/profile đã làm từ trước được liệt kê trong [báo cáo frontend](FRONTEND_UI_REVIEW.md).

## Remaining TODO

- **Ghi nhớ đăng nhập:** chưa hiển thị checkbox. Token theo tab và cookie dùng chung cần một chính sách persistence thống nhất; `get_current_user` hiện ưu tiên cookie khi cả cookie và Bearer cùng có mặt. Không tự đổi cơ chế phiên chỉ để thêm UI.
- **Email reset production:** backend có tạo token nhưng chưa có dịch vụ gửi email; UI không thông báo đã gửi email.
- **Mã sinh viên/giảng viên, ngành/khóa:** cần model/nghiệp vụ thật trước khi bổ sung.
- **Middleware role:** hiện decode JWT cookie mà chưa xác minh chữ ký ở Next middleware; API FastAPI tự xác thực riêng. Việc này được ghi lại, chưa đổi permission architecture trong tác vụ UI.
- **Lint:** repository chưa cấu hình ESLint; lệnh lint hiện yêu cầu thiết lập. Không cài thêm dependency.

FaceEngine, YuNet, SFace, thresholds, enrollment/verification, exam workflow và face embedding không bị sửa trong lần hoàn thiện auth này.
