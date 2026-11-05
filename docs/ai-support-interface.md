# Giao diện Hỗ trợ AI theo HTML mẫu

Đã chuyển phần nội dung hai tab sang component React/CSS Module hiện có, dùng banner teal–tím, nền xanh nhạt, tab dạng pill, trường nhập bo tròn, thẻ chỉ số có viền màu và danh sách bài hướng dẫn có nhãn vai trò/trạng thái. Dùng lại Nunito và Lucide đã cài; không thêm thư viện, font hay JavaScript của trang HTML mẫu.

`AISupportHeader` và `AISupportPage.module.css` chia sẻ banner, bảng màu, kiểu nút và trường nhập giữa hai trang. `KnowledgePage.module.css` định dạng danh sách và modal; CSS dashboard hiện có tiếp tục định dạng các phần thống kê chi tiết. Bảng màu được giới hạn trong hai trang và modal của chúng, với biến thể sáng/tối theo ThemeProvider hiện có. Các màu chữ vàng/xanh được điều chỉnh độ đậm để đọc rõ trên nền nhạt.

Các nhãn đã Việt hóa gồm menu Hỗ trợ AI, Hoạt động AI, Kho tri thức, Sinh viên/Giảng viên, Danh mục, Đang sử dụng/Đã tạm ngưng, Từ khóa, Trang liên quan và Tình trạng dịch vụ AI. Giá trị role/category/status gửi lên API vẫn giữ nguyên.

## Luồng hiện có được giữ lại

- Route `/admin/ai-support/activity` và `/admin/ai-support/knowledge`, liên kết Next.js, lịch sử điều hướng và trạng thái tab hiện tại.
- WorkspaceShell, thông tin tài khoản thật, AuthContext, AdminLayout và các kiểm tra quyền hiện có.
- API hoạt động, bộ lọc ngày đang áp dụng, xuất CSV, công thức chỉ số, xử lý mẫu số bằng 0, thông tin dịch vụ và trạng thái lỗi/thử lại.
- API danh sách/tạo/sửa bài viết, debounce tìm kiếm, reset danh mục khi đổi vai trò, cấu trúc payload, route liên quan, từ khóa và trạng thái xuất bản.
- Modal và quản lý focus/Escape hiện có. Không dùng các toast giả hoặc bản ghi mẫu từ HTML làm dữ liệu sản phẩm.

Các biểu đồ tiếp tục dùng số liệu thật mà API hỗ trợ. Không tạo chuỗi thời gian hay các giá trị theo ngày từ những thanh minh họa trong HTML. Các trạng thái đang tải, rỗng, lỗi và dữ liệu chưa đủ vẫn hiển thị rõ ràng.

## Kiểm tra

- 25 ca trình duyệt riêng biệt đạt qua các lượt chạy: 12 ca dashboard hiện có; 6 cấu hình Kho tri thức ở 390/768/1440px và sáng/tối; 3 ca lọc, tạo/sửa và lỗi/hủy; 2 ca chặn tài khoản Student/Teacher; 1 ca menu thu gọn; 1 ca tài khoản Admin thật.
- Kiểm tra số liệu tổng hợp, ngày lọc/xuất CSV, trạng thái dịch vụ, cấu trúc POST/PUT không đổi, điều hướng tab, modal, nhãn tiếng Việt và không tràn ngang.
- Ca dữ liệu thật đọc số liệu và danh sách bài hướng dẫn từ API bằng tài khoản Admin hiện có; không tạo tài khoản hay lưu chỉnh sửa vào kho tri thức thật. Nội dung, vai trò, trạng thái xuất bản và thời gian cập nhật bài viết cùng số lượng tài khoản giữ nguyên sau kiểm tra.
- TypeScript và ESLint tập trung: đạt, không có lỗi/cảnh báo ở các file được kiểm tra.
- Build production: đạt (42 trang tĩnh), dùng thư mục riêng `.next-recovery-ai-support-design`; các thay đổi cấu hình TypeScript do Next.js tự sinh đã được hoàn nguyên. Còn các cảnh báo lint có sẵn ở phần khác của dự án.
- Các cặp màu chữ/phông nền chính của nhãn và nội dung phụ đã được đo độ tương phản tối thiểu 4,5:1 trong bảng màu sáng/tối.
- Các kiểm thử cũ về màu sidebar được cập nhật theo theme tối đang có. Kiểm tra chuyển workspace cho tài khoản không phải Admin cho phép thời gian biên dịch route lần đầu của Next.js dev server; không thay đổi logic xác thực.

Log, ảnh chụp desktop/mobile/sáng/tối và bằng chứng kiểm thử nằm trong `artifacts/ai-support-design/` cùng các log `artifacts/ai-support-design-*.log`. Token kiểm thử tài khoản thật ở fixture riêng được Git bỏ qua và không đưa vào báo cáo.

## File sản phẩm thay đổi

- `components/admin/AISupportHeader.tsx` (mới)
- `components/admin/AISupportPage.module.css` (mới)
- `components/admin/KnowledgePage.module.css` (mới)
- `components/admin/AIActivityDashboard.tsx`
- `components/admin/AIActivityDashboard.module.css`
- `components/admin/AISupportTabs.tsx`
- `components/admin/AISupportTabs.module.css`
- `components/admin/ai-activity.ts` (chỉ chuỗi nhãn tiếng Việt)
- `app/admin/ai-support/knowledge/page.tsx`
- `lib/admin-navigation.ts` (chỉ nhãn menu)

Không sửa backend, endpoint, schema, phân quyền hay dữ liệu nghiệp vụ.
