# ProctoOwl Public Home — typography refinement

Ngày: 22/10/2026. Áp dụng duy nhất `/`.

| Vai trò | Font thực tế |
| --- | --- |
| Hero headline | **Nunito ExtraBold 800**, fallback được người dùng chỉ định khi Fredoka lỗi tiếng Việt |
| Section/card headings | **Nunito 700** |
| Buttons và wordmark | **Nunito 700** |
| Body, mô tả, metadata, monitoring data | **Be Vietnam Pro 400–500** |
| Navigation | **Be Vietnam Pro 500** |
| Vietnamese rendering | **PASS** với font đã áp dụng |

Đã tải và kiểm tra bản Fredoka từ Google Fonts upstream, SHA-256
`2ba02e68b152868aef9ba28e24b3648c7d457fe6f25c761f2c2c53fb61a73fc8`.
Font thiếu các ký tự như `ị`, `ờ`, `ớ`, `ắ`, `đ` và các combining mark cần cho
tiếng Việt. Vì người dùng cho phép fallback Nunito ExtraBold, toàn bộ hero dùng
Nunito 800 để tránh trộn Fredoka với font hệ thống giữa một từ. Không đưa Fredoka
không sử dụng vào bundle. Đây là ngoại lệ 800 dành riêng hero theo fallback đã
yêu cầu; các heading/nút còn lại dùng 700 và dữ liệu/body dùng 400–500.

Hero chuyển từ Inter 900 với tracking -0.065em sang Nunito 800, cỡ
`clamp(50px, 5.2vw, 72px)`, line-height 1.08, tracking -0.015em. Giữ các cỡ chữ
responsive hiện có ở tablet/mobile. Chữ rộng và tròn hơn, khoảng chữ thoáng hơn;
không tô màu riêng từng từ. Navy/teal và tất cả màu giữ nguyên.

Font mới self-host bằng `next/font/local`, `font-display: swap`; Be Vietnam Pro
hai weight tổng 72.984 byte. Nunito tái sử dụng asset hiện có và license tương
ứng; không thêm dependency ứng dụng. Public Home ngừng import bộ education
typography có Baloo 2 không dùng trên trang này. Student vẫn dùng cấu hình cũ.

## Vietnamese QA

Đã kiểm tra cmap của font nguồn và WOFF2 đóng gói, gồm chữ hoa/thường và NFC/NFD:

- Giám thị AI / không bao giờ / chớp mắt.
- Xác minh danh tính
- Lịch học và lịch thi
- Điểm số / Kết quả

Đã render 1440px trước/sau và một trang proof tiếng Việt. Chrome DevTools Protocol
`CSS.getPlatformFontsForNode` xác nhận font glyph thực tế: Nunito ở hero/heading,
Be Vietnam Pro ở body/navigation; không có Arial/system fallback được dùng cho
các node kiểm tra. `glyph-coverage.json`, `browser-font-audit.json` và
`vietnamese-proof.png` trong `artifacts/public-cute-typography/` lưu bằng chứng.

## Scope

Chỉ đổi các thuộc tính font/weight/size/line-height/letter-spacing và font variables
trong CSS của public page. Không đổi grid/flex/gap/padding, màu, nội dung, cấu trúc
CTA, monitoring preview, vị trí/SVG cú, eye animation, beam, route hoặc business
logic. Chênh lệch kích thước chữ/wrapping là hệ quả của font mới, không có refactor
bố cục. `PublicHero.tsx`, `AppShell.tsx` và bộ typography Student byte-identical
với trước thay đổi. `scope-audit.json` xác minh phạm vi.

Files ứng dụng thay đổi:

- `components/public/LandingPage.tsx`: chỉ đổi font import/class opt-in.
- `components/public/PublicHome.module.css`: chỉ font properties/variables.
- `components/public/typography.ts`: cấu hình local font mới, scoped public.
- `components/public/fonts/`: hai WOFF2 Be Vietnam Pro, SIL OFL và README.

Ảnh: `before-1440.png`, `after-1440.png`, các bản full-page và
`vietnamese-proof.png`. Kết quả build/browser checks cuối được lưu trong
`validation-summary.json` cùng thư mục artifacts.

Build production và lint: **PASS** (TypeScript được kiểm tra trong build).
Browser production regression: **37/37 PASS**, gồm typography-induced reflow ở
320–1440px light/dark, card/caption, CTA/route/auth redirect, contrast/focus,
reduced motion/touch và eye tracking/spotlight. Đã lặp kiểm tra actual glyph font
và ảnh 1440px trên production sau build. Các cảnh báo hook/img tồn tại sẵn ở
những vùng ứng dụng khác được giữ nguyên; component public đã sửa không có lint
warning. Không kiểm chứng database thật; các ca auth/workspace dùng fixture.
