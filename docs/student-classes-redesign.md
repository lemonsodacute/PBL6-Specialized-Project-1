# Lớp học phần sinh viên — dùng chung thiết kế với giảng viên

Đã thiết kế lại `/student/classes` theo trang Lớp học của giảng viên: hero sáng có minh họa owl, ba ô thống kê, bộ lọc rõ ràng và danh sách thẻ lớp dạng hàng ngang. Giữ khung trang, sidebar, topbar và màu nền riêng của khu vực sinh viên.

## Thực hiện

- Tách phần trình bày thành `ClassCollectionList`, dùng chung cho hai phía; `TeacherClassList` giữ vai trò wrapper tương thích.
- Sinh viên thấy “Không gian học tập”, “Lớp học phần”, “Danh sách học phần” và lời mô tả dành cho việc học. Các liên kết chỉ trỏ tới `/student/classes/{id}`; không thêm thao tác quản trị.
- Dùng lại hero và bốn minh họa lớp hiện có. Mỗi hàng có tên, mô tả, chip học kỳ khi tên lớp có dữ liệu tương ứng, giảng viên, sĩ số và nút mở lớp.
- Số liệu lấy từ rows/meta của hook hiện có. Các tổng chỉ tính trên trang được ghi rõ khi phân trang; không gán cứng số liệu. Giảng viên không có ID trong dữ liệu được coi là chưa đủ thông tin để tính số giảng viên, hiển thị dấu “—”.
- Tìm kiếm, sắp xếp, phân trang, thông báo `class_access`, trạng thái tải/lỗi và retry vẫn dùng cơ chế cũ. Không đổi route, API, auth, role, enrollment hay backend.
- Student có class CSS riêng để không kích hoạt các selector đổi màu sidebar của teacher. Tái sử dụng layout, màu hero/card, border, chip và hình minh họa; loại style grid thẻ sinh viên cũ để tránh xung đột.
- Không thêm dependency/font/ảnh mới. Giữ font local và xử lý reduced motion sẵn có.

## File sản phẩm

1. `components/classes/ClassCollectionList.tsx` — phần hiển thị chung mới.
2. `components/classes/ClassCollection.tsx` — chuyển nhánh student sang view chung; hook và API giữ nguyên; admin vẫn dùng bảng quản lý.
3. `components/classes/TeacherClassList.tsx` — wrapper cho view teacher.
4. `components/teacher/TeachingCollectionHeader.tsx` — hỗ trợ tiêu đề và mô tả theo đối tượng, mặc định teacher.
5. `components/teacher/TeachingCollection.module.css` — chia sẻ layout với student, giữ các selector shell chỉ cho teacher và giới hạn override filter/typography trong trang mới.
6. `app/student-visual.css` — bỏ style grid thẻ lớp cũ không còn dùng.

Kiểm chứng: thêm `tests/e2e/student-classes-design.spec.ts`; chỉnh selector cảnh báo/retry trong `tests/e2e/class-pages-design.spec.ts` để không nhầm lỗi danh sách với lỗi nguồn lựa chọn của dropdown. Không đổi hành vi kiểm tra.

## Kết quả kiểm chứng

- TypeScript: **PASS**, `typecheck-final.log`.
- Lint các component/test liên quan: **PASS**, `lint-final.log`.
- **17 ca E2E riêng biệt đã đạt qua các lần chạy**: 7 ca student responsive/theme; 3 ca chức năng student; 1 ca admin; 6 ca hồi quy teacher. Có kiểm tra link, quyền hành động, giá trị thống kê, trạng thái lỗi, retry, tìm kiếm/sắp xếp và phân trang.
- Đã kiểm tra student ở 320/390/768/1024/1440px light và 390/1440px dark; không tràn ngang, hình tải được, trường/nút đạt chiều cao tối thiểu 44px.
- Lần đầu có 11 ca đạt, 6 ca cần sửa fixture/selector hoặc chạy lại. Đã bổ sung CORS credentials cho fixture phân trang, giới hạn locator vào alert của nội dung, dùng region chứa bảng admin, chờ điều hướng route động và chọn đúng lỗi danh sách khi dropdown cũng có lỗi. Các lần chạy sau đạt 3, 2 và 1 ca còn lại. Không mô tả là một lần chạy sạch 17/17. Logs: `e2e.log`, `e2e-retry.log`, `e2e-final-fixes.log`, `e2e-error-final.log`.
- 8 cặp ảnh trước/sau: student và teacher, 1440/390px, light/dark. `comparison.json` xác nhận màu sidebar/topbar giữ nguyên, nội dung teacher không đổi, không overflow trong các ảnh.
- Các ảnh và test dùng fixture UI, không ghi dữ liệu thật. Không kiểm chứng lại toàn bộ backend/enrollment hoặc media/WebRTC vì không thay đổi các phần này.
- Production build: **PASS**, Next.js 15.5.28, 42/42 trang tĩnh (`build.log`). Dùng dist riêng `.next-recovery-student-classes-redesign`, khôi phục nguyên byte `tsconfig.json` và `next-env.d.ts` sau build. Còn cảnh báo hook có sẵn ngoài phạm vi sửa; không có lỗi build mới.

TypeScript ban đầu đã quét các bản sao `.tsx` trong artifacts; các snapshot này được đổi thành `.tsx.txt` rồi kiểm tra lại thành công. Không sửa cấu hình TypeScript để né kiểm tra.

## Hình ảnh

Tại `artifacts/student-classes-redesign/`: [trước desktop](../artifacts/student-classes-redesign/before-student-1440-light.png), [sau desktop](../artifacts/student-classes-redesign/after-student-1440-light.png), [sau mobile](../artifacts/student-classes-redesign/after-student-390-light.png), [sau dark](../artifacts/student-classes-redesign/after-student-1440-dark.png). Ảnh tham chiếu teacher và dữ liệu đối chiếu cũng nằm trong thư mục này.
