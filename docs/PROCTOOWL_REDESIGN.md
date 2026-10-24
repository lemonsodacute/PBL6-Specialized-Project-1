# ProctoOwl — public home & product branding

Ngày thực hiện: 22/10/2026. Phạm vi thiết kế lại: trang public `/`. Các vùng đăng nhập chỉ thay tên/logo sản phẩm, giữ bố cục hiện tại.

## Rebrand

| Hạng mục | Kết quả |
| --- | --- |
| Tên cũ | AI PROCTO / AI Proctoring |
| Tên mới | **ProctoOwl** |
| Primary | **#006D77** |
| Tagline | Giám thị AI không bao giờ chớp mắt. |
| Logo/mark cú nguyên bản | Có |
| Hero cú nguyên bản | Có |
| Đồng tử theo con trỏ | Có, trên thiết bị hover + fine pointer |
| Hai luồng sáng từ mắt tới con trỏ | Có |
| Nội dung tham chiếu giả/không được hỗ trợ | **Không** |
| Đổi technical identifier | **Không** |
| Đổi business logic/API/backend/database/auth | **Không** |

Đã đổi các nhãn hiển thị được kiểm tra riêng: public navbar/footer/mô tả; header chung của login/register/khôi phục mật khẩu và phụ đề đăng ký; logo/accessible name sidebar Student/Teacher/Admin và footer Student; SupportAssistant, SupportConversation, tên dialog AIChatbox; metadata và nội dung SVG logo cũ.

Giữ tên file kỹ thuật `ai-proctor-logo.svg` để không đổi các tham chiếu CSS hiện tại. Nội dung file nay là logo ProctoOwl. Không đổi package, route, role, event, env, khóa storage hay giá trị lưu trữ. Nhãn AI mô tả chức năng vẫn được giữ. Kết quả tìm kiếm tên cũ trong mã frontend chỉ còn comment lịch sử trong `app/tokens.css`, không hiển thị cho người dùng.

## Trang chủ

Hero hai cột: headline “Thi trực tuyến, rõ ràng hơn.”, mô tả chức năng có thật, đăng ký `/login?mode=register`, đăng nhập `/login`; cú teal trên nền mint có chấm nhẹ và một card minh họa nhỏ. Navbar nổi nhẹ, liên kết tới section có thật, menu thu gọn trên màn hình nhỏ. Typography tận dụng Nunito/Inter local hiện có, không thêm font hoặc dependency.

Các phần có sẵn được giữ nguyên nội dung: 6 tính năng, 3 nhóm vai trò, 4 bước sử dụng, AI Support, xác minh/quyền truy cập/nhật ký, 3 FAQ, CTA cuối và footer. Source audit xác nhận toàn bộ nội dung từ section tính năng tới hết main giống bản trước.

Không thêm bảng giá, testimonial, metrics, số lượng người dùng, trial, video demo, route hoặc modal mới. Card chỉ dùng các khái niệm hiện có: camera/microphone, lịch sử sự kiện, thông tin hỗ trợ giám sát và giảng viên xem xét. Card ghi “Giao diện minh họa” và “Không phải dữ liệu phiên thi thực tế”, không hiển thị tên, số lượng hay cảnh báo backend giả. Tagline thương hiệu không thay thế vai trò quyết định của giảng viên.

## Hiệu ứng mắt cú

`PublicHero.tsx` dùng SVG nguyên bản và SVG overlay: mỗi mắt là gốc một cone có gradient trong suốt dần, blur nhẹ và một glow mờ ở đích. Đồng tử dịch chuyển tối đa 9 đơn vị SVG. Con trỏ trái/phải làm hai cone cùng hướng tới điểm đích; khi rời hero, đồng tử về giữa và luồng sáng tắt.

Pointer listener thụ động cập nhật biến trong effect; một `requestAnimationFrame` xử lý lerp theo thời gian thực và ghi trực tiếp SVG attributes/style qua refs. Không cập nhật React state theo mousemove. Geometry được cache, đo lại khi vào hero/resize; không đọc layout trong mỗi frame. Animation ngừng khi đã ổn định, ra viewport hoặc tab ẩn. Listener, observers và rAF đều được cleanup khi unmount.

`prefers-reduced-motion: reduce` tắt tracking/beam; touch/coarse pointer giữ đồng tử chính giữa và ánh mắt tĩnh nhẹ. Không có giả lập cursor trên mobile. Giao diện và CTA sử dụng được khi không có animation.

## Responsive & accessibility

- Desktop 1440/1024: text trái, visual phải; navbar đủ CTA và section thật.
- Tablet 768: text trên, visual dưới; menu thu gọn.
- Mobile 390 và kiểm tra hồi quy tới 320: xếp dọc, CTA rõ, không tràn ngang. Cỡ ảnh minh họa và card co theo viewport.
- Light/dark đồng bộ; primary button vẫn #006D77. Dark dùng navy/teal và màu chữ sáng có tương phản.
- Skip link, một H1, heading/landmark, tên điều khiển, menu bàn phím, native FAQ details, focus-visible; SVG trang trí không gây nhiễu screen reader. Preview có caption riêng. Các control chính có vùng chạm ít nhất 44px.
- Kiểm tra tương phản tự động cho brand header/footer, headline, mô tả và CTA; kiểm tra reduced motion và touch bằng trình duyệt thật.

## Metadata

- Root title: `ProctoOwl - Hệ thống thi trực tuyến`.
- Root description: quản lý bài thi, xác minh danh tính và giám sát thi trực tuyến.
- Home title: `ProctoOwl - Giám thị AI hỗ trợ thi trực tuyến`.
- Home Open Graph: title/description tính năng thật, `website`, `vi_VN`; không tự đặt URL triển khai hoặc ảnh social giả.
- `app/icon.svg`: mark cú theo convention sẵn có của Next.js. Không thêm web manifest vì dự án chưa có.

## Files

Application:

1. `components/public/LandingPage.tsx`
2. `components/public/PublicHome.module.css`
3. `components/public/PublicHero.tsx` (mới)
4. `components/public/PublicBrand.tsx`
5. `components/auth/LoginForm.tsx`
6. `components/layout/AppShell.tsx`
7. `components/chat/SupportAssistant.tsx`
8. `components/chat/SupportConversation.tsx`
9. `components/ui/AIChatbox.tsx`
10. `app/layout.tsx`
11. `app/page.tsx`
12. `app/icon.svg` (mới)
13. `public/proctoowl-mark.svg` (mới)
14. `public/ai-proctor-logo.svg`

Tests: `tests/e2e/proctoowl.spec.ts` (mới); cập nhật tên hiển thị/kỳ vọng public trong `public-homepage.spec.ts`, `neo-education.spec.ts`, `admin-navigation.spec.ts`, `support-chat.spec.ts`, `ai-support-provider.spec.ts`. Các test student/dashboard giữ hành vi hiện tại. Không chạy suite support-chat phụ thuộc database thật chỉ vì thay một nhãn; kiểm chứng nhãn bằng suite AI Support dùng fixture.

Verification artifacts và bản nguồn trước khi sửa: `artifacts/proctoowl-redesign/`. `source-review.patch` và `scope-audit.json` giúp xem chính xác phạm vi thay đổi dù workspace không có Git.

## Validation

Build production **PASS**, TypeScript **PASS**, public lint **PASS** không có lỗi/cảnh báo. Build còn các cảnh báo hook/img có sẵn ở phần ứng dụng ngoài phạm vi.

72 ca E2E riêng biệt đã được kiểm chứng PASS qua các lượt. Lượt production đầu: 71 PASS, 1 lỗi chờ animation khi máy tải nặng. Đã sửa smoothing theo elapsed time thật; lượt cuối **15/15 PASS** gồm toàn bộ 14 ca ProctoOwl và một ca Support, bổ sung kiểm tra geometry sau resize và tương phản footer dark. 58 ca hồi quy còn lại đã PASS trong lượt production trước và không đổi mã liên quan sau đó. Không tuyên bố một lượt cuối chạy lại cả 72 ca. Log chi tiết nằm trong `production-tests.log` và `final-focused-tests.log`.

| Lighthouse 13.5.0, production localhost | Desktop | Mobile mô phỏng |
| --- | --- | --- |
| Performance | 99 | 76 |
| Accessibility | 100 | 100 |
| Best practices | 100 | 100 |
| SEO | 100 | 100 |
| LCP | 0,8 giây | 4,1 giây |
| TBT | 20 ms | 270 ms |
| CLS | 0,003 | 0 |

Đây là phép đo lab một lượt cho mỗi preset, không phải số liệu thiết bị/người dùng thực. Mobile còn tải CSS dùng chung toàn ứng dụng và provider infrastructure hiện có; không tái cấu trúc root layout vì ngoài phạm vi. Báo cáo HTML/JSON: `lighthouse-desktop.report.*`, `lighthouse-mobile.report.*`. Lighthouse accessibility 100 không đồng nghĩa chứng nhận WCAG đầy đủ; đã kiểm tra thêm bàn phím, reduced motion và touch bằng E2E.

Kết quả máy đọc được: `artifacts/proctoowl-redesign/validation-summary.json`.

Ảnh: `hero-1440-light.png`, `hero-768-light.png`, `hero-390-light.png`, các bản dark tương ứng; full page `home-1440-light.png` / `home-390-light.png`; hiệu ứng `eye-spotlight-left.png` / `eye-spotlight-right.png`; brand auth/workspace/support trong cùng thư mục artifacts.

## Brief gửi lại và tinh chỉnh spotlight

Người dùng gửi lại brief mục 1–18 và xác nhận **giữ ProctoOwl như hiện tại** khi được hỏi về dòng AI PROCTO trong file cũ. Giữ thiết kế đã triển khai, cùng tên/metadata ProctoOwl, không đổi tên lại theo file cũ.

Theo yêu cầu tinh chỉnh tiếp theo, cone sáng đã đậm hơn: opacity gradient từ 0,5 → 0,32 → 0,14 → 0; nửa độ rộng tăng theo khoảng cách `min(150, distance × 0.24)` thay cho giới hạn 26px trước đó. Vì vậy luồng sáng loe dần từ mắt ra phía đích, rộng tối đa khoảng 300px; blur 6px giữ mép mềm. Cơ chế tracking, smoothing và fallback không đổi. Chỉ sửa `components/public/PublicHero.tsx` cho phần tinh chỉnh này; lint và 2 ca tracking/touch PASS. Ảnh trước/sau trong `artifacts/proctoowl-spotlight-adjustment/`.

Đối chiếu brief gửi lại: source audit tiếp tục PASS; chạy lại 35 ca trong `proctoowl.spec.ts` và `public-homepage.spec.ts` trên dev server. Kết quả được lưu tại `artifacts/proctoowl-public-review/`. Điểm Lighthouse trong bảng trên là lượt production trước lần tăng cường spotlight, không phải phép đo lại sau tinh chỉnh.

Kết quả lượt rà soát: **34 PASS, 1 timeout** chờ heading đăng nhập sau khi bấm quay lại từ form đăng ký; ca đó **PASS khi chạy lại riêng** mà không sửa source hoặc assertion. Tổng cộng 35 ca riêng biệt đã PASS qua hai lượt; không phải 35/35 trong một lượt. Rà soát này không thêm thay đổi vào application source vì các yêu cầu đã có trong bản hiện tại. Chi tiết trong `review.json`, `tests.log`, `auth-cta-recheck.log`.
