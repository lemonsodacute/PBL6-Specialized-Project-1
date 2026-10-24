# Public home — bố cục theo ảnh tham chiếu

Ngày: 22/10/2026.

Đã chỉnh trang `/` theo ảnh người dùng gửi: headline navy đậm ba dòng “Giám thị AI / không bao giờ / chớp mắt.”; nền mint chấm phủ toàn hero; CTA dạng pill, mũi tên trên điểm nhấn vàng; dòng giải thích vai trò quyết định của giảng viên. Bên phải là cú nhô sau card trắng bo lớn, lưới avatar pastel 4 × 2, một ô được nhấn viền, panel sự kiện nền mint phía dưới.

Giữ nguyên toàn bộ SVG con cú và mã eye tracking/spotlight của bản trước. Chỉ đổi vị trí/kích thước minh họa để phù hợp bố cục. Hai luồng sáng vẫn đậm, loe rộng theo con trỏ, có smoothing/rAF/ref và fallback reduced motion/touch.

Card ghi rõ “Giao diện minh họa” và không phải dữ liệu phiên thi thực tế. Các ô A–H là placeholder thí sinh, không phải tài khoản thật. Sự kiện ví dụ “Nhiều khuôn mặt” dựa trên event `multiple_faces` đã có trong frontend (`lib/teacher-reports.ts`). Không đưa tên người, môn thi, số lượng đang thi, điểm trung thực hoặc timestamp giả từ ảnh vào sản phẩm.

CTA chính vẫn đăng ký `/login?mode=register`, CTA phụ đăng nhập `/login`; liên kết trong preview cuộn tới `#tinh-nang`. Không tạo luồng thi thử hay video demo không tồn tại. Brand vẫn **ProctoOwl**, primary **#006D77**.

Các section tính năng, vai trò, cách hoạt động, AI Support, an toàn/phân quyền, FAQ, CTA cuối và footer giữ nguyên nội dung. Màu nền, typography và nút được đồng bộ theo phong cách mới. Desktop hai cột; tablet/mobile xếp dọc, card co theo viewport. Card và chú thích dùng flow layout để không chồng nhau khi font hoặc độ rộng thay đổi. Dark mode và focus-visible giữ hỗ trợ hiện có.

Files ứng dụng:

- `components/public/LandingPage.tsx`: headline, mô tả, dòng trust.
- `components/public/PublicHero.tsx`: monitoring preview dạng lưới và panel ví dụ.
- `components/public/PublicHome.module.css`: bố cục, palette, typography, pattern, CTA và responsive.

Cập nhật kỳ vọng giao diện trong `tests/e2e/proctoowl.spec.ts`, `public-homepage.spec.ts`, `neo-education.spec.ts`; bổ sung kiểm tra số ô preview, link thật và khoảng cách card/caption. Không sửa dashboard, sidebar, auth, API, backend hay database.

Source audit: `artifacts/home-reference-match/scope-audit.json`. Diff: `source-review.patch`. Build/tests và ảnh xem trước được lưu trong cùng thư mục artifacts; số liệu cuối nằm trong `validation-summary.json`.

Build production, TypeScript và lint các component public: PASS. Sau khi căn lại vị trí hero lần cuối, chạy chung toàn bộ public/ProctoOwl và surface light/dark: **37/37 PASS** trên production (`final-production-tests.log`). Phạm vi kiểm chứng gồm responsive 320–1440px, bố cục hai cột/stack, 8 placeholder, card/caption không chồng, contrast/focus/skip link, reduced motion/touch, hai beam + đồng tử, route và CTA auth, SSR/metadata, không gọi API/media riêng trên public. API trong kiểm tra workspace/auth dùng fixture; không có tuyên bố kiểm chứng backend thật.

Ảnh hero gần khổ mẫu: `artifacts/home-reference-match/hero-1040.png`. Mobile đủ hero: `hero-390.png`. Ảnh desktop 1440, tablet, dark và spotlight cũng có trong cùng thư mục. Không đo lại Lighthouse cho lượt chỉnh layout này.

Theo phản hồi tiếp theo, nâng riêng vị trí cú để card không che khuôn mặt: top desktop từ 25px thành -28px, tablet -28px, mobile -24px. Không đổi kích thước, SVG, eye tracking, card hoặc nội dung. Kiểm tra tương tác mắt PASS; ảnh cập nhật trong `artifacts/owl-position-fix/`.
