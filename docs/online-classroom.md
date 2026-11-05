# Online Classroom — vận hành và kiểm tra

Phòng học dùng LiveKit SFU: mỗi trình duyệt kết nối SFU, không tạo mesh giữa các sinh viên. Backend giữ quyền truy cập và trạng thái trong `live_classes`; `ongoing` là LIVE, `scheduled` là SCHEDULED, `ended` là ENDED. Luồng gọi trong kỳ thi vẫn dùng transport hiện có.

## Chạy trên máy Windows này

Từ thư mục gốc project:

```powershell
./scripts/start-classroom-sfu.ps1
```

Trên Windows, `npm run dev` tự kiểm tra và khởi động SFU chạy nền nếu `backend/.env` đã trỏ đến `ws://localhost:7880` hoặc `ws://127.0.0.1:7880`. `npm run dev:sfu` chạy riêng bước này; gọi lại không tạo tiến trình thứ hai. Lần đầu chưa có cấu hình, chạy script trên để tạo credentials rồi khởi động lại FastAPI. SFU từ xa không bị thay đổi. Có thể chạy `./scripts/start-classroom-sfu.ps1 -Background` trực tiếp; log riêng nằm ở `backend/private/livekit/`, không commit.

Script tải LiveKit Server 1.13.9 từ release chính thức, kiểm tra SHA-256, tạo key/secret ngẫu nhiên cho SFU cục bộ, cập nhật **chỉ các biến LIVEKIT** trong `backend/.env`, và chạy SFU. Cấu hình có secret nằm trong `backend/private/livekit/livekit.yaml`, đã được ignore. Không chạy bằng `--dev` vì chế độ đó mặc định cho tạo phòng tự động. Có thể dùng `-ConfigureOnly` để chuẩn bị cấu hình; script giữ credential cục bộ đã có khi chạy lại.

Ở terminal khác:

```powershell
cd backend
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend dùng API thật: đặt `NEXT_PUBLIC_API_URL=http://localhost:8000` trong `.env.local`, sau đó `npm ci` / `npm run dev`. Production mock fallback đã được gỡ. Giảng viên mở `/dashboard/live-classes`, sinh viên mở `/student/live-classes`. Sinh viên phải được ghi danh trong lớp bằng chức năng quản lý lớp hiện có.

Không cần `NEXT_PUBLIC_LIVEKIT_URL`: endpoint token trả `server_url` (và `url` để tương thích client cũ). `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` chỉ tồn tại phía server. Nếu truy cập từ máy khác, `NEXT_PUBLIC_API_URL` và `LIVEKIT_URL` phải truy cập được từ máy đó; thêm origin frontend chính xác vào `CORS_ORIGINS`. Client chặn URL SFU loopback từ trang từ xa và chặn `ws://` từ trang HTTPS, báo `REALTIME_CONFIG_MISSING` trước khi SDK kết nối. Backend production cũng yêu cầu WSS.

Cấu hình cục bộ chỉ phục vụ trình duyệt trên máy này (`localhost`). Cho nhiều máy, cần SFU/LiveKit Cloud được truy cập qua WSS, frontend HTTPS, và cấu hình ICE/TURN/firewall phù hợp. `LIVEKIT_URL` phải là địa chỉ **trình duyệt của mọi người** truy cập được, không dùng localhost khi triển khai từ xa. `LIVEKIT_API_URL` có thể là địa chỉ HTTP nội bộ từ FastAPI đến SFU.

SFU local dùng `rtc.node_ip: 127.0.0.1` và `rtc.enable_loopback_candidate: true`. Đợt QA 21/10 đã gặp DTLS timeout ở context thứ hai khi thiếu loopback candidate; sau bổ sung, ca hai role qua remote video/audio, refresh/reconnect, chat, end và attendance. Tùy chọn này có trong [cấu hình chính thức LiveKit](https://github.com/livekit/livekit/blob/master/config-sample.yaml); không áp dụng địa chỉ loopback cho deployment nhiều máy.

## Cấu hình production

Các biến sau chỉ đặt ở FastAPI; không có `NEXT_PUBLIC_*` cho credential:

```dotenv
LIVEKIT_URL=wss://rtc.your-domain.example
LIVEKIT_API_URL=https://rtc.your-domain.example
LIVEKIT_API_KEY=<server-api-key>
LIVEKIT_API_SECRET=<server-api-secret>
```

- Dùng mẫu [infra/livekit/livekit.yaml](../infra/livekit/livekit.yaml) với self-hosted SFU. Điền key ID và URL webhook; cung cấp key/secret bằng secret manager/private config. Không publish file có secret.
- **Tắt auto-create rooms**: self-hosted `room.auto_create: false`, hoặc tắt auto-create trong project LiveKit Cloud. Backend gọi CreateRoom sau khi khóa và kiểm tra session LIVE. Token không cấp `roomCreate`/`roomAdmin`. DeleteRoom khi kết thúc sẽ ngắt tất cả kết nối; token đã cấp không thể tạo lại phòng.
- Cấu hình webhook trỏ về `/api/v1/live-classes/provider-webhook`. Backend kiểm chữ ký JWT và hash của raw body qua SDK, không nhận event từ browser chưa được xác thực. Endpoint phải truy cập được từ SFU. Proxy cần giữ Authorization header và raw body.
- Cấu hình SFU không cho remote unmute. Giảng viên có thể tắt micro; yêu cầu bật micro gửi một lời nhắc để sinh viên tự xác nhận. Chính sách nguồn publish được thực thi tại SFU, gồm microphone và screen share.
- Nếu SFU lỗi khi kết thúc, DB vẫn ENDED và chặn token ngay. `provider_close_pending` lưu bền; worker thử DeleteRoom lại mỗi 5 giây kể cả sau restart. Client kiểm trạng thái mỗi 5 giây và tự đóng media khi buổi đã kết thúc hoặc quyền bị thu hồi. Khi SFU không truy cập được, API trả thông báo lỗi, không chuyển sang phòng mẫu.
- API secret không được gửi về browser. Room token TTL 60 giây, room/identity do backend xác định. SDK giữ kết nối/reconnect và cập nhật token của kết nối; frontend chỉ xin token lúc tham gia/thử lại. Phòng dài hơn access-token của ứng dụng tái dùng API refresh hiện có; chỉ cập nhật token nếu response vẫn thuộc cùng user.

Tham khảo chính thức: [Server configuration](https://github.com/livekit/livekit/blob/master/config-sample.yaml), [self-hosting](https://docs.livekit.io/transport/self-hosting/), [JS client SDK](https://docs.livekit.io/reference/client-sdk-js/).

## API và điểm danh

- `POST /live-classes`: tạo lịch, kiểm timezone, tiêu đề, end > start và lớp phụ trách.
- `POST /{id}/start`: chỉ SCHEDULED; khóa row tránh start đồng thời. Lỗi SFU thì chưa chuyển LIVE.
- `POST /{id}/token`: chủ lớp/admin hoặc sinh viên ghi danh, chỉ LIVE. Response `no-store`. Không tạo điểm danh khi xin token.
- `POST /{id}/join`: gửi SID sau kết nối; backend kiểm participant/SID thực sự tồn tại ở SFU. Cũng dùng để xác nhận lại sau reconnect. Teacher tham gia được, chỉ student ghi điểm danh.
- `POST /{id}/leave`: SID của kết nối đang rời; không xóa kết nối mới nếu một tab/refresh cũ gửi leave trễ.
- `POST /{id}/end`: chỉ quản lý đúng lớp/session; ENDED lưu `actual_end`, đóng các khoảng điểm danh, DeleteRoom. Gọi lại an toàn, không đổi thời gian kết thúc ban đầu.
- `GET /{id}/attendance`: chỉ chủ lớp/admin; sinh viên không được đọc điểm danh cả lớp.

Migration `0012_live_classroom` thêm `active_since`, `participant_sid`, `last_event_at` vào aggregate `class_attendance` đang có, giữ unique `(live_class_id, student_id)`. `joined_at` là lần đầu, `left_at` là lần rời cuối, `duration_sec` cộng các khoảng kết nối thật, không cộng thời gian đã rời. SID bảo vệ khỏi leave/webhook trễ và join trùng. Webhook `participant_left` xử lý cả đóng tab/crash mà browser không kịp gửi leave. Cần webhook hoạt động để điểm danh chính xác trong các tình huống này.

Teacher xem điểm danh trực tiếp từ panel hoặc chọn **Xem chi tiết** sau buổi. ENDED/SCHEDULED mở trang thông tin, không xin quyền camera/mic. Camera/mic tắt vẫn tham gia được; mic meter không phải điều kiện tham gia. Participant count/tile lấy từ SFU, có cả giảng viên và các sinh viên khác. Chat đi qua API xác thực quyền/policy và gửi qua data channel reliable của chính LiveKit, tối đa 1.000 ký tự, 200 tin trên mỗi client, không lưu lịch sử sau refresh. Client bỏ qua gói chat/control do participant tự gửi để không giả mạo tên hay quyền host. Reactions dùng gói ephemeral lossy, không ghi DB.

## Chẩn đoán lỗi kết nối (18/10/2026)

Trước khi sửa, tái hiện bằng session kiểm thử riêng trên API thật: GET session HTTP 200 (`ongoing`), POST token HTTP 503 (`CLASSROOM_PROVIDER_UNAVAILABLE`). `LIVEKIT_URL=ws://localhost:7880`, internal API `http://127.0.0.1:7880`, cả key và secret đều có; CORS trả `http://localhost:3000`. Không có listener ở 7880/7881: SFU chưa chạy. UI dùng `friendlyError` chung nên che mất mã lỗi provider, dẫn đến thông báo “Kiểm tra mạng”. Sau khi chạy SFU, cùng session/token endpoint trả HTTP 200. Một lỗi độc lập trong transport cũng được sửa: lỗi mở thiết bị sau `room.connect()` từng gọi `disconnect()` và bị báo nhầm lỗi phòng.

Luồng hiện tại: tải session → API xác thực và kiểm quyền/trạng thái → backend ensure room `classroom-<session UUID>` → cấp JWT server-side TTL 60 giây → client connect SFU → xác nhận SID thật qua `/join` → render participant → publish camera/mic. Preview thiết bị trước khi tham gia là tùy chọn; capture dùng cho publish chỉ bắt đầu sau khi connect. Từ chối camera/mic giữ nguyên phòng và báo `DEVICE_PERMISSION_ERROR`.

| Mã | Ý nghĩa |
| --- | --- |
| `ROOM_NOT_LIVE` | Session chưa bắt đầu; không cấp token |
| `SESSION_ENDED` | Session đã kết thúc/hủy; không cấp token |
| `UNAUTHORIZED` | API 401/403 |
| `SESSION_NOT_FOUND` | API 404, gồm session ngoài quyền để không lộ dữ liệu |
| `TOKEN_REQUEST_FAILED` | Lỗi cấp token/HTTP lỗi không thuộc nhóm đã xác định |
| `REALTIME_CONFIG_MISSING` | Thiếu/sai cấu hình, credential bị provider từ chối, URL không hợp lệ hoặc mixed content |
| `REALTIME_CONNECTION_FAILED` | SFU không truy cập được hoặc token 200 nhưng SDK/WebSocket/ICE thất bại |
| `NETWORK_ERROR` | Không tới được API hoặc API timeout, không dùng cho mọi lỗi SDK |
| `DEVICE_PERMISSION_ERROR` | Không mở được camera/mic; room vẫn kết nối |

State giao diện: `IDLE`, `CONNECTING`, `CONNECTED`, `RECONNECTING`, `DISCONNECTED`, `ERROR`. “Thử lại” có khóa chống double-click, chờ cleanup room/listeners/tracks trước khi xin token mới; không giữ JWT cũ. Refresh tải session cũ, cấp token mới cho cùng room name. Leave, end, unmount và pagehide dọn kết nối; các kết quả async đã lỗi thời không được mở lại phòng.

DEV console có `[classroom]` cho session/token/provider/connect/publish/error; backend có `classroom session_loaded/authorized/provider_request/token_issued/token_failed`. Chỉ ghi session ID/status, provider, HTTP status, room name, URL-configured boolean, connection state và mã lỗi an toàn. Không ghi JWT/key/secret hay exception nguyên bản. Production không ghi các trace này. Trong Network, xem `/live-classes/{id}/token`, sau đó LiveKit `/rtc` WebSocket: không có token request là vấn đề UI; 401/403 là auth; 404 là session/quyền; 5xx xem safe code; token 200 rồi SDK thất bại là nhánh SFU/URL/WebSocket/ICE.

## Kiểm tra

Backend:

```powershell
cd backend
.venv/Scripts/python.exe -m unittest tests.test_live_classroom -v
```

Kiểm tra trình duyệt **SFU thật**, không mock transport/API:

```powershell
# FastAPI + SFU + frontend phải đang chạy. Từ backend:
.venv/Scripts/python.exe -m scripts.classroom_e2e_fixture
# Từ thư mục gốc:
$env:CLASSROOM_REAL_E2E='1'
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'
npx playwright test tests/e2e/live-classroom.spec.ts --output="$env:LOCALAPPDATA/Temp/codex-classroom-playwright"
# Sau kiểm tra, từ backend:
.venv/Scripts/python.exe -m scripts.classroom_e2e_fixture --cleanup
```

Fixture là các user/lớp riêng phục vụ test trong DB thật, không dùng làm fallback UI. File private chứa access token hết hạn theo cấu hình ứng dụng; không commit. Cleanup chỉ xóa đúng UUID của fixture, không xóa dữ liệu người dùng khác. Test mặc định skip nếu không bật `CLASSROOM_REAL_E2E=1`. Media trình duyệt được giả lập để test tự động; audio/video signaling/subscription, backend, SFU, DB và quyền truy cập đều chạy thật.

Kiểm tra thủ công thêm hai máy với webcam thật và mạng production để xác nhận thiết bị/TURN: join, mic/camera, đổi thiết bị, mất mạng ngắn, refresh, đóng tab, logout, kết thúc phòng. Kiểm tra LED camera tắt sau leave/unmount/end và không có horizontal scroll trên mobile. Không suy ra năng lực hàng trăm người hay chất lượng mạng WAN từ test localhost.


## Nâng cấp lớp học 24/10/2026

Chạy migration `0024_classroom_controls` trước khi dùng frontend/backend mới. Migration chỉ mở rộng `live_classes` với `classroom_state` (JSONB) và `controls_sync_pending`; dùng lại bảng điểm danh, users, enrollment và notifications. Nhãn thông báo `classroom_activity` được thêm vào enum hiện có. Không tạo subsystem lớp học hay chat hỗ trợ mới.

- `POST /{id}/admission`: kiểm membership/lifecycle/khóa/loại khỏi lớp trước khi xin token. Mặc định giữ luồng cũ (phòng chờ tắt, chat bật, sinh viên được bật mic, screen share sinh viên tắt). Khi bật phòng chờ, chỉ người được host duyệt mới nhận token. Teacher/admin đúng quyền không phải chờ.
- `DELETE /{id}/admission`: hủy yêu cầu đang chờ; không thu hồi người đã được duyệt.
- `POST /{id}/policy`: host cập nhật chat, nguồn screen share/mic, phòng chờ, khóa lớp. Lưu DB trước, sau đó cập nhật room metadata và participant grants thật tại SFU. Worker lifecycle có sẵn thử lại projection lỗi; token luôn theo policy DB mới nhất.
- `POST /{id}/actions`: admit/reject/admit_all, mute/mute_all, request_unmute, remove, lower_hand/lower_all. Host không thể dùng endpoint này với lớp khác hoặc áp dụng thao tác sinh viên lên host. Remove lưu lệnh cấm tham gia lại cho buổi này trước khi ngắt SFU; webhook cũng từ chối token cũ của người đã bị loại.
- `POST /{id}/hand`: lưu timestamp server, đồng bộ bằng participant metadata chỉ server được ghi. Không dùng client-supplied role/name để xác định host.
- `POST /{id}/chat`: chỉ người có kết nối SFU và quyền chat được gửi. Tên/id/time là server tạo. Không có polling chat.

Room metadata đồng bộ policy realtime, participant metadata đồng bộ host/giơ tay, track events đồng bộ mic/camera/screen share/active speaker/quality. Người đang ở ngoài SFU chờ duyệt dùng nhịp refresh session hiện có (tối đa khoảng 5 giây); danh sách video/participants trong lớp không poll. Hủy yêu cầu chờ khi rời phòng, pagehide hoặc unmount nếu trình duyệt gửi được request keepalive. Mất mạng tạm thời giữ reconnect của SDK, không gọi leave cho trạng thái RECONNECTING.

`/live-class/[id]` dùng canvas riêng toàn viewport. Grid/speaker lưu lựa chọn tại localStorage; audio remote được gắn một lần ngoài grid nên đổi speaker/screen-share layout không phát âm thanh trùng. Video màn hình có vùng chính, camera ở dải bên dưới. Mobile dùng bảng participants/chat dạng bottom sheet có focus trap/Escape. Các điều khiển ít dùng vào Thêm; thiết bị chuyển bằng `switchActiveDevice` của SDK. Loa chỉ hiện khi browser có `setSinkId`. Fullscreen là browser API. Không có recording/captions/breakout/polls giả.

Khóa Web Locks theo user/session ngăn tab thứ hai vào cùng lớp trên cùng origin nếu browser hỗ trợ. Trình duyệt không hỗ trợ vẫn được bảo vệ bởi LiveKit identity duy nhất và thông báo duplicate identity. Không cấp bí mật provider cho frontend. Attendance được tạo khi xác nhận SID thật, dừng khi leave/remove/end hoặc webhook disconnect; schema giữ MSSV từ user và thời lượng tích lũy thật.

Kiểm thử nâng cấp có thể dùng runtime PostgreSQL QA tách biệt sẵn có:

```powershell
# từ backend, chuẩn bị DB QA và migration
.venv/Scripts/python.exe scripts/release_qa_runtime.py prepare
.venv/Scripts/python.exe scripts/release_qa_runtime.py run -- python -m alembic upgrade head
# khởi động API qua cùng runtime và seed fixture bằng CLASSROOM_FIXTURE_PATH riêng
# từ root, bật CLASSROOM_REAL_E2E=1, CLASSROOM_RELEASE_QA=1
# đặt CLASSROOM_FIXTURE_PATH tới đúng fixture đó rồi chạy:
npx playwright test tests/e2e/live-classroom.spec.ts
```

Media tự động là canvas/oscillator/screen capture giả lập chỉ trong test; API, SFU, data channel, permissions, DB và role auth thật. Cần kiểm tra webcam/micro thật và ICE/TURN khi triển khai nhiều máy. Không suy ra chất lượng WAN hay tải lớp lớn từ test localhost.


Kết quả kiểm tra 24/10: 31 backend + 2 PostgreSQL concurrency + 8 browser/provider tests PASS; TypeScript và production build PASS. Xem [báo cáo nâng cấp](online-classroom-upgrade-report.md).
