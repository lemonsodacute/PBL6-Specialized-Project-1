# AI PROCTO — UI polish cuối

Đợt chỉnh sửa này tập trung vào lỗi trình bày sau Modern Academic, áp dụng cho Student, Teacher và Admin.

## Phạm vi đã chỉnh

| Hạng mục | Kết quả |
| --- | --- |
| Spacing, padding | Control dùng chiều cao 44px; icon tìm kiếm/xóa căn giữa; khoảng cách nội dung modal và trạng thái phản hồi đồng nhất. |
| Button, action | Nhãn dài được xuống dòng; action nhóm tự wrap; nút chính và menu của đề thi không chồng nhau trong cột hẹp. |
| Bảng responsive | Mobile giữ dạng card hoặc vùng cuộn riêng theo cấu hình hiện có. Bảng từ 6 cột ở tablet/desktop giữ chiều rộng cột tối thiểu, cuộn trong vùng bảng. |
| Modal | Giới hạn theo vùng nhìn thực tế của trình duyệt; nội dung cuộn riêng, header luôn hiện; bỏ sticky của thanh chọn câu hỏi bên trong modal để không che phân trang. |
| Dropdown, popover | Menu thao tác tính vị trí trong viewport; menu trong modal nằm trên modal. Menu tài khoản và popover lịch cuộn khi nội dung dài. Chuẩn hóa lớp hiển thị của inbox mobile. |
| Loading, empty, error | Skeleton, icon, mô tả và nút retry dùng cùng khoảng cách; giữ nguyên cơ chế tải và thử lại. |
| Nội dung dài | Tên, email, tiêu đề, badge và thông báo được wrap trong vùng chứa; tab dài cuộn trong hàng tab. |
| Phân trang | Nút 44px, page-size không tách nhãn; mobile chia hàng để summary, page-size và các nút không chèn nhau. |
| Floating chat | Launcher tránh các action đang hiện, cập nhật khi scroll, resize và nội dung thay đổi. |
| Camera | Widget tránh header, sidebar, mục lục câu hỏi và vùng submit/navigation; trạng thái thu gọn dùng ít chiều cao hơn. |
| Sidebar | Mục Làm kiểm tra tiếp tục active và submenu mở khi vào bài làm/kết quả. Các link active dùng cùng chỉ báo hiện có. |
| Sticky header | Giữ header 64px, đồng bộ offset khi cuộn đến phần nội dung và sticky guide. |
| Dark mode | Giữ nguyên palette và semantic colors; kiểm tra tương phản control và trạng thái ở cả hai theme. |
| Mobile / tablet | Kiểm tra 360, 390, 430, 768, 820 và 1024px; thêm kiểm tra biểu mẫu 320–1440px và viewport thấp. |

## Ràng buộc được giữ nguyên

- Navbar/sidebar vẫn **#006D77** ở light và dark mode.
- Hash của `app/tokens.css` và `app/theme.css` không đổi so với bản đầu đợt polish.
- Các file trong `lib` không đổi. Không sửa business logic, API client, backend, database, chấm điểm hoặc xử lý media.
- Không thêm dependency; không đổi cách gọi API hoặc điều kiện cho phép thao tác.

## Bằng chứng

Build production thành công, bao gồm lint và kiểm tra TypeScript. **101 trường hợp kiểm tra frontend khác nhau đã đạt**:

| Nhóm | Số ca | Log |
| --- | ---: | --- |
| Ba vai trò, nội dung dài, bảng, phân trang, sticky header, chat, modal, loading/empty/error; hai theme và 6 chiều rộng | 29 | `final-review.log` |
| Thiết lập thiết bị, camera, kéo thả, tránh navigation/submit, lưu câu trả lời và nộp bài | 24 | `exam-final.log` |
| Shell/theme/contrast, xác thực hồ sơ, biểu mẫu 320–1440px và vòng đời chat | 39 | `regression-complete.log` |
| Menu thao tác đề thi, bàn phím, overflow, không chồng nút và giữ điều kiện thao tác hiện có | 9 | `actions-final.log` |

Các log nằm trong `artifacts/final-polish/`. Sau chỉnh sửa chiều rộng cột cuối cùng, 9 ca tablet của ma trận được chạy lại và đạt trong `tablet-final.log`; không cộng lặp vào tổng 101.

Fixture hồi quy đã cập nhật nhãn không còn ký hiệu trang trí, origin theo cổng chạy test và nguồn video/audio tổng hợp ổn định. Không thay đổi mã xử lý nghiệp vụ để đáp ứng fixture.

- Bản sao trước chỉnh sửa: `artifacts/final-polish/before-polish.zip`.
- Hash trước chỉnh sửa và danh sách file thay đổi: `artifacts/final-polish/before-hashes.json`, `artifacts/final-polish/changed-files.json`.
- Build production: `artifacts/final-polish/final-build.log`.

## Ảnh kiểm tra

- [Mobile dark mode](../artifacts/final-polish/preview-mobile-dark.png)
- [Camera trên mobile](../artifacts/final-polish/preview-exam-mobile.png)
- [Sidebar và camera trên tablet](../artifacts/final-polish/preview-exam-tablet.png)
- [Menu trong modal 360 × 480px](../artifacts/final-polish/preview-modal.png)

Các kiểm tra trình duyệt dùng Chrome, API fixture và thiết bị camera/microphone giả lập. Kết quả xác nhận giao diện và tương tác phía frontend; không thay thế kiểm thử tích hợp với backend hoặc thiết bị thật.
