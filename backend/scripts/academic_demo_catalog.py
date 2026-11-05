"""Manually authored curriculum; no AI-provider calls or fabricated documents."""
# Multiple choice: prompt | correct answer | distractor | distractor.
# Essay: prompt | grading guidance. Options are rotated deterministically by seed.
CATALOG = {
 'web': [
  ('HTML và CSS nền tảng', '''Thẻ HTML nào biểu diễn nội dung điều hướng chính?|nav|canvas|strong
Thuộc tính nào nối nhãn label với ô nhập có id tương ứng?|for|src|target
CSS box-sizing: border-box tính chiều rộng khai báo như thế nào?|Bao gồm nội dung, padding và border|Chỉ tính nội dung|Bao gồm cả margin
Flexbox dùng thuộc tính nào để căn các phần tử theo trục chính?|justify-content|font-weight|border-collapse
Khi ảnh mang ý nghĩa nội dung, thuộc tính nào cung cấp mô tả thay thế?|alt|rel|method
Đơn vị rem trong CSS phụ thuộc vào giá trị nào?|Cỡ chữ của phần tử gốc|Chiều rộng của ảnh|Cỡ chữ của phần tử cha trực tiếp trong mọi trường hợp
Pseudo-class nào hỗ trợ hiển thị tiêu điểm bàn phím phù hợp?|:focus-visible|:visited-only|:keyboard-text
Thuộc tính nào giúp ảnh co trong khung mà giữ tỉ lệ?|object-fit: contain|white-space: nowrap|text-transform: uppercase
Thiết kế một form đăng ký học phần có thể dùng bằng bàn phím. Nêu ba yêu cầu truy cập.|Nhãn gắn với ô nhập; thứ tự Tab hợp lý; tiêu điểm rõ; thông báo lỗi liên kết với trường; không chỉ dùng màu.
Giải thích khác biệt giữa CSS Grid và Flexbox khi xây dựng trang danh sách học phần.|Grid tổ chức hàng và cột; Flexbox tập trung một trục. Chọn theo quan hệ bố cục, không theo loại nội dung.'''),
  ('JavaScript và REST API', '''Khai báo nào tạo biến JavaScript có phạm vi khối và cho phép gán lại?|let|var luôn có phạm vi khối|const cho phép gán lại
Phương thức nào chuyển chuỗi JSON hợp lệ thành giá trị JavaScript?|JSON.parse|JSON.stringify|Object.toString
HTTP GET nên dùng chủ yếu cho mục đích nào?|Đọc biểu diễn tài nguyên|Xóa tài nguyên|Thay đổi mật khẩu
Mã HTTP nào biểu thị tài nguyên không tồn tại?|404|201|204
HTTP PUT thường thể hiện thao tác nào?|Thay thế biểu diễn tài nguyên tại URI đã biết|Chỉ đọc dữ liệu|Thiết lập kết nối WebSocket
Promise.all trả về kết quả thành công khi nào?|Khi mọi promise đầu vào đều hoàn thành thành công|Ngay khi promise đầu tiên thành công|Luôn bỏ qua promise bị reject
Hàm preventDefault trên sự kiện submit thường được dùng để làm gì?|Ngăn hành vi gửi form mặc định của trình duyệt|Xóa toàn bộ listener trên trang|Dừng mọi request đang chạy
Khi render danh sách React, key nên có đặc điểm nào?|Ổn định và duy nhất giữa các phần tử cùng cấp|Luôn là số ngẫu nhiên mới mỗi render|Luôn giống nhau cho mọi phần tử
Mô tả cách xử lý một request lưu bài làm bị gửi lại do mất mạng.|Dùng định danh/idempotency key, kiểm tra phiên và quyền, transaction, trả lại kết quả đã lưu thay vì tạo bản ghi trùng.
Thiết kế endpoint phân trang danh sách học phần và giải thích các trường phản hồi.|Tham số trang/giới hạn, thứ tự ổn định, dữ liệu trang hiện tại và tổng số; kiểm tra quyền và giới hạn kích thước trang.'''),
 ],
 'database': [
  ('SQL và truy vấn quan hệ', '''Lệnh SQL nào dùng để đọc dữ liệu từ bảng?|SELECT|INSERT|DROP
Mệnh đề nào lọc các hàng trước bước gom nhóm?|WHERE|HAVING|ORDER BY
INNER JOIN trả về tập hàng nào?|Các hàng có điều kiện nối khớp ở hai phía|Mọi hàng ở hai bảng không xét điều kiện|Chỉ các hàng không khớp
COUNT(*) đếm giá trị nào?|Số hàng trong tập kết quả|Chỉ số cột khác NULL|Tổng giá trị của cột đầu tiên
LEFT JOIN giúp giữ lại tập hàng nào?|Tất cả hàng ở bảng bên trái|Chỉ hàng có khóa ngoại NULL|Tất cả hàng ở bảng bên phải và không giữ bên trái
Từ khóa nào loại bản ghi lặp trong kết quả SELECT?|DISTINCT|UNIQUE INDEX luôn thay cho SELECT|CASCADE
Điều kiện kiểm tra NULL đúng trong SQL là gì?|IS NULL|= NULL luôn đúng với NULL|LIKE NULL
HAVING thường được dùng để lọc loại dữ liệu nào?|Kết quả sau khi gom nhóm|Tên cơ sở dữ liệu|Thứ tự cột vật lý
Viết truy vấn đếm số sinh viên theo lớp, vẫn hiển thị lớp chưa có sinh viên.|Dùng classes LEFT JOIN enrollments, GROUP BY lớp, COUNT(enrollments.student_id), tránh COUNT(*) cho số thành viên.
Giải thích vì sao phân trang cần ORDER BY ổn định với khóa phụ duy nhất.|Các hàng bằng nhau theo tiêu chí chính có thể đổi vị trí; thêm id làm khóa phụ giúp tránh trùng hoặc thiếu giữa các trang.'''),
  ('Transaction và thiết kế dữ liệu', '''Thuộc tính Atomicity trong ACID có ý nghĩa gì?|Các thay đổi trong transaction cùng thành công hoặc cùng rollback|Mọi truy vấn luôn chạy song song|Mỗi bảng chỉ có một cột
Khóa ngoại chủ yếu bảo đảm điều gì?|Toàn vẹn tham chiếu giữa các bảng|Mọi giá trị văn bản đều duy nhất|Mọi truy vấn đều dùng chỉ mục
Chuẩn hóa dữ liệu thường giúp giảm vấn đề nào?|Dư thừa và bất thường cập nhật|Số kiểu dữ liệu được SQL hỗ trợ|Nhu cầu kiểm tra quyền
UNIQUE(class_id, student_id) ngăn điều gì?|Một sinh viên bị ghi danh trùng trong cùng lớp|Một sinh viên học nhiều lớp khác nhau|Một lớp có nhiều sinh viên
Chỉ mục B-tree thường phù hợp với thao tác nào?|Tra cứu bằng và truy vấn khoảng có thứ tự|Mã hóa dữ liệu không thể giải mã|Thay thế hoàn toàn khóa ngoại
ROLLBACK làm gì với thay đổi chưa commit?|Hủy thay đổi của transaction|Xóa mọi tài khoản trong hệ thống|Tự động commit tất cả kết nối
Truy vấn SELECT FOR UPDATE thường dùng để làm gì?|Khóa các hàng được chọn trong transaction|Đọc dữ liệu từ bản sao công khai|Tự động xóa các hàng trùng
Một thiết kế nhiều-nhiều giữa sinh viên và lớp thường cần gì?|Bảng liên kết ghi danh|Một cột chứa mật khẩu ở bảng lớp|Một bảng sinh viên cho mỗi lớp
Thiết kế transaction chuyển tiền giữa hai tài khoản và nêu tình huống rollback.|Khóa/kiểm tra số dư, trừ và cộng trong cùng transaction, rollback khi không đủ tiền hoặc cập nhật thất bại.
Giải thích khác biệt giữa ràng buộc duy nhất và kiểm tra trùng ở giao diện.|Ràng buộc DB bảo vệ cả request đồng thời và mọi đường ghi; giao diện chỉ hỗ trợ trải nghiệm, không bảo đảm toàn vẹn.'''),
 ],
 'network': [
  ('TCP/IP và dịch vụ mạng', '''TCP cung cấp đặc điểm nào cho luồng byte?|Truyền tin cậy và đúng thứ tự|Không bao giờ cần thiết lập kết nối|Chỉ hoạt động trong một máy
UDP có đặc điểm nào ở tầng vận chuyển?|Không bảo đảm giao nhận và thứ tự như TCP|Luôn truyền lại mọi gói bị mất|Luôn nhanh hơn TCP trong mọi ứng dụng
DNS thường phục vụ mục đích nào?|Phân giải tên miền thành thông tin địa chỉ|Lưu mật khẩu người dùng dạng rõ|Thay thế địa chỉ IP ở tầng mạng
Default gateway được dùng khi nào?|Gửi gói tới mạng ngoài mạng cục bộ|Mở một tệp trên ổ cứng|Tính toán checksum của tệp
IPv4 có độ dài địa chỉ bao nhiêu bit?|32|16|128
HTTPS bổ sung lớp bảo vệ nào cho HTTP?|TLS bảo vệ kết nối|Tự động loại bỏ mọi lỗi ứng dụng|Bỏ qua việc xác minh máy chủ
DHCP thường cấp cấu hình nào cho thiết bị?|Địa chỉ IP và các tham số mạng|Mã nguồn ứng dụng web|Khóa chính cho bảng SQL
ARP trong mạng Ethernet IPv4 dùng để làm gì?|Tìm địa chỉ MAC ứng với địa chỉ IPv4 cục bộ|Phân giải tên miền toàn cầu|Thực hiện mã hóa TLS
Mô tả các bước kiểm tra khi máy truy cập được IP nhưng không truy cập được tên miền.|Kiểm tra DNS cấu hình, truy vấn phân giải, bộ nhớ đệm DNS và khả năng kết nối tới máy chủ DNS; tách lỗi phân giải khỏi lỗi định tuyến.
So sánh lựa chọn TCP và UDP cho truyền tệp với cuộc gọi thời gian thực.|Tệp ưu tiên toàn vẹn/thứ tự; gọi ưu tiên độ trễ và chịu mất gói có kiểm soát. Nêu vai trò cơ chế phục hồi ở ứng dụng.'''),
  ('Routing, VLAN và vận hành', '''Subnet mask được dùng để xác định điều gì?|Phần mạng và phần host của địa chỉ IPv4|Mật khẩu Wi-Fi|Phiên bản trình duyệt
VLAN chia miền quảng bá ở tầng nào?|Tầng liên kết dữ liệu|Tầng ứng dụng|Tầng trình bày
Router chuyển tiếp gói chủ yếu dựa trên thông tin nào?|Địa chỉ IP đích và bảng định tuyến|Tên người dùng đăng nhập|Nội dung CSS của trang
Một access port của switch thường thuộc bao nhiêu VLAN dữ liệu?|Một VLAN dữ liệu|Mọi VLAN mà không cần cấu hình|Không thuộc VLAN nào trong mọi trường hợp
Trunk 802.1Q được dùng để làm gì?|Mang lưu lượng nhiều VLAN qua một liên kết|Mã hóa mật khẩu ứng dụng|Tạo địa chỉ IPv4 công cộng
TTL của gói IPv4 giúp hạn chế điều gì?|Gói đi vòng lặp định tuyến vô hạn|Mất điện tại máy chủ|Lỗi chính tả tên miền
Firewall stateful khác với lọc gói đơn giản ở điểm nào?|Theo dõi trạng thái kết nối|Luôn cho phép mọi cổng TCP|Không xem được địa chỉ nguồn
Nguyên tắc cấu hình rule firewall an toàn là gì?|Chỉ mở luồng cần thiết theo nguồn, đích và cổng|Mở mọi cổng để tránh lỗi|Dùng cùng một rule cho mọi hệ thống
Thiết kế hai VLAN cho phòng máy và bộ phận quản trị, nêu yêu cầu định tuyến giữa VLAN.|Tách miền quảng bá; cấu hình gateway/L3; chỉ cho phép các luồng liên VLAN cần thiết bằng ACL/firewall; ghi lại sơ đồ địa chỉ.
Giải thích vì sao kết nối WebSocket thành công chưa chứng minh luồng WebRTC hoạt động.|Signaling và media dùng các đường truyền/cổng khác nhau; cần kiểm tra ICE, NAT, UDP/TCP/TURN và firewall.'''),
 ],
 'security': [
  ('Xác thực và phân quyền', '''Authentication trả lời câu hỏi nào?|Người dùng là ai?|Tài nguyên được sắp xếp ra sao?|Dữ liệu chiếm bao nhiêu byte?
Authorization trả lời câu hỏi nào?|Người dùng được phép làm gì?|Mật khẩu dài bao nhiêu ký tự?|Máy chủ có bao nhiêu CPU?
Nguyên tắc least privilege có nghĩa gì?|Chỉ cấp quyền cần thiết để thực hiện công việc|Mọi tài khoản đều là admin|Bỏ kiểm tra quyền cho request nội bộ
Mật khẩu nên được lưu dưới dạng nào?|Hàm băm mật khẩu thích hợp kèm salt|Văn bản rõ|Mã hóa Base64 như cơ chế bảo mật
IDOR thường xuất hiện khi nào?|Máy chủ tin vào id tài nguyên mà không kiểm tra quyền sở hữu/truy cập|Mọi dữ liệu được mã hóa TLS|Mọi API đều yêu cầu pagination
JWT đã ký có bảo đảm dữ liệu bên trong được giữ bí mật không?|Không, payload thường chỉ được mã hóa biểu diễn|Có, luôn mã hóa bằng khóa công khai|Có, vì trình duyệt không đọc được JSON
Đối với endpoint quản trị, kiểm tra quyền nên đặt ở đâu?|Máy chủ, ngoài các kiểm tra giao diện|Chỉ ẩn nút trên giao diện|Chỉ dựa vào tên đường dẫn
MFA giúp tăng bảo vệ bằng cách nào?|Kết hợp các yếu tố xác thực độc lập|Gửi lại cùng một mật khẩu hai lần|Chia sẻ tài khoản quản trị
Thiết kế kiểm tra quyền xem bản ghi lớp học của một sinh viên.|Kiểm tra tài khoản hoạt động, ghi danh hiện tại, bản ghi đã công khai/chưa hết hạn và quyền ở mỗi yêu cầu media.
Phân tích rủi ro khi chỉ kiểm tra role nhưng bỏ qua quyền sở hữu tài nguyên.|Hai giảng viên cùng role có thể xem dữ liệu lớp của nhau; cần kiểm tra quan hệ quản lý/được giao ở backend.'''),
  ('Mật mã và bảo mật Web', '''Hàm băm mật mã có mục đích cơ bản nào?|Ánh xạ dữ liệu thành giá trị băm với tính chất bảo mật thích hợp|Luôn khôi phục được bản rõ bằng khóa|Nén mọi tệp xuống kích thước nhỏ hơn
SQL injection thường được ngăn ở lớp truy vấn bằng cách nào?|Tham số hóa truy vấn|Nối chuỗi trực tiếp với input|Chỉ đổi tên bảng
XSS xảy ra khi điều gì có thể chạy trong ngữ cảnh trang?|Mã do kẻ tấn công chèn vào nội dung không được xử lý an toàn|Mọi cookie đều là httpOnly|Mọi trường nhập đều có placeholder
Cookie httpOnly chủ yếu giảm khả năng nào?|JavaScript đọc cookie trực tiếp|Máy chủ đọc cookie|Người dùng gửi request HTTPS
CSRF lợi dụng yếu tố nào?|Thông tin xác thực tự động đi kèm request của trình duyệt|Khóa ngoại trong cơ sở dữ liệu|Cơ chế sắp xếp mảng
Khóa bí mật của provider nên được đặt ở đâu?|Cấu hình phía máy chủ|Bundle JavaScript công khai|Thuộc tính data-secret trong HTML
HTTPS bảo vệ dữ liệu ở trạng thái nào?|Đang truyền trên kết nối được bảo vệ|Mọi dữ liệu trên ổ đĩa mặc định|Mọi ảnh chụp màn hình của người dùng
Đặc tính idempotent có ích gì khi mạng làm gửi lại yêu cầu?|Giảm nguy cơ áp dụng cùng thay đổi nhiều lần|Thay thế việc xác thực|Bảo đảm mọi request thành công
Nêu biện pháp bảo vệ upload ảnh ngoài việc kiểm tra đuôi tệp.|Giới hạn kích thước, kiểm tra kiểu/nội dung, tên tệp do server tạo, lưu riêng tư và kiểm tra quyền khi truy cập.
Giải thích tại sao ẩn nút tải xuống không tương đương DRM.|Trình duyệt được cấp quyền vẫn nhận byte media; kiểm soát truy cập khác với bảo vệ sao chép tuyệt đối.'''),
 ],
 'software': [
  ('Yêu cầu và kiểm thử phần mềm', '''Yêu cầu phi chức năng mô tả loại đặc tính nào?|Hiệu năng, độ tin cậy, khả năng sử dụng|Chỉ tên nút trên giao diện|Chỉ cấu trúc thư mục mã nguồn
Acceptance criteria có vai trò gì?|Xác định điều kiện để chấp nhận một yêu cầu|Thay thế tất cả test tự động|Liệt kê mọi biến cục bộ
Unit test thường tập trung vào phạm vi nào?|Một đơn vị hành vi nhỏ có ranh giới rõ|Toàn bộ hệ thống triển khai thật trong mọi test|Chỉ ảnh chụp giao diện
Integration test kiểm tra điều gì?|Sự phối hợp giữa các thành phần|Chỉ cú pháp tên biến|Chỉ định dạng Markdown
Regression test nhằm mục đích gì?|Phát hiện hành vi cũ bị hỏng sau thay đổi|Chứng minh phần mềm không bao giờ có lỗi|Thay thế việc xem xét yêu cầu
Một test hữu ích nên ưu tiên kiểm tra điều gì?|Hành vi quan sát được và kết quả có ý nghĩa|Số dòng mã bằng một hằng số|Mọi chi tiết cài đặt nội bộ
Bug có thể tái hiện nên được mô tả bằng gì?|Các bước, kết quả thực tế, kết quả mong đợi và môi trường|Chỉ câu ứng dụng bị lỗi|Chỉ tên lập trình viên
Boundary-value testing tập trung vào đâu?|Giá trị tại và gần ranh giới miền dữ liệu|Chỉ giá trị ngẫu nhiên bất kỳ|Chỉ trường hợp thành công phổ biến
Viết tiêu chí chấp nhận cho chức năng nộp bài khi mạng mất rồi kết nối lại.|Không mất câu trả lời đã lưu; không tạo lượt nộp trùng; phản hồi rõ; trạng thái server là nguồn sự thật; kiểm thử retry.
Phân biệt mức độ nghiêm trọng và độ ưu tiên của lỗi bằng một ví dụ.|Mức nghiêm trọng là tác động; ưu tiên là thứ tự xử lý theo hoàn cảnh kinh doanh. Ví dụ lỗi hiển thị ở trang giới thiệu trước buổi demo.'''),
  ('Kiến trúc ứng dụng và Git', '''Tách giao diện khỏi logic nghiệp vụ giúp điều gì?|Giảm phụ thuộc và dễ kiểm thử|Tự động loại bỏ mọi bug|Không cần kiểm tra API
API contract thường mô tả những gì?|Dữ liệu vào/ra, lỗi và quy tắc tương tác|Chỉ màu nút bấm|Chỉ tên người triển khai
Một transaction boundary nên bao quanh điều gì?|Các thay đổi cần bảo đảm nhất quán cùng nhau|Mọi request của mọi người dùng cùng lúc|Toàn bộ vòng đời trình duyệt
Git branch được dùng chủ yếu để làm gì?|Phát triển một nhánh thay đổi độc lập|Sao lưu mật khẩu trong repository|Thay thế cơ sở dữ liệu
Code review có mục đích nào?|Đánh giá tính đúng, khả năng bảo trì và rủi ro của thay đổi|Chỉ đếm số commit|Bảo đảm không cần test
Một migration tốt cần được kiểm tra điều gì?|Tương thích dữ liệu và ràng buộc hiện có|Chỉ tên file theo thứ tự chữ cái|Chỉ số lượng bảng tạo mới
Idempotent job có ưu điểm nào?|Chạy lại mà không nhân đôi tác dụng đã hoàn tất|Không bao giờ cần kiểm tra lỗi|Luôn xử lý tức thời
Observability hữu ích nhất khi cung cấp gì?|Thông tin đủ để hiểu hành vi và lỗi mà không lộ bí mật|Toàn bộ mật khẩu trong log|Chỉ thông báo hệ thống đang chạy
Thiết kế cách phân biệt trạng thái lớp học và trạng thái xử lý bản ghi.|Hai lifecycle riêng, liên kết bằng khóa lớp; kết thúc lớp yêu cầu stop nhưng file chỉ READY khi provider/storage xác nhận.
Giải thích cách giữ seed dữ liệu có thể chạy lại an toàn.|Dùng namespace/khóa ổn định, transaction, chỉ ghi dữ liệu thuộc seed, kiểm tra ràng buộc và bảo toàn tài khoản hiện có.'''),
 ],
 'ai': [
  ('Dữ liệu và đánh giá mô hình', '''Tập validation thường được dùng cho việc gì?|Lựa chọn siêu tham số và đánh giá trong quá trình phát triển|Thay thế toàn bộ dữ liệu huấn luyện|Chứa duy nhất đầu ra triển khai thực tế
Data leakage xảy ra khi nào?|Thông tin không sẵn có khi dự đoán lọt vào quá trình huấn luyện/đánh giá|Mọi dữ liệu đều được chia đúng thời gian|Dữ liệu được kiểm tra kiểu
Precision của lớp dương là tỉ lệ nào?|TP / (TP + FP)|TP / (TP + FN)|TN / (TN + FN)
Recall của lớp dương là tỉ lệ nào?|TP / (TP + FN)|TP / (TP + FP)|FP / (FP + TN)
Confusion matrix giúp quan sát điều gì?|Quan hệ giữa nhãn thật và nhãn dự đoán|Thời gian chạy của mọi câu lệnh SQL|Kích thước file ảnh duy nhất
Với dữ liệu lệch lớp mạnh, chỉ xem accuracy có rủi ro gì?|Che khuất hiệu quả kém ở lớp ít mẫu|Luôn làm mô hình overfit|Làm dữ liệu tự cân bằng
Tiền xử lý chuẩn hóa dữ liệu nên fit trên tập nào?|Tập train rồi áp dụng cho validation/test|Toàn bộ test trước khi chia tập|Chỉ từng mẫu test riêng lẻ trong mọi bài toán
Một hệ thống cảnh báo AI nên mô tả đầu ra thế nào?|Tín hiệu cần người có trách nhiệm xem xét|Kết luận chắc chắn về ý định của người học|Điểm thi tự động bị trừ không cần quy tắc
Đề xuất quy trình đánh giá mô hình phát hiện bất thường mà không dùng dữ liệu test để chỉnh ngưỡng.|Chia train/validation/test phù hợp, chọn ngưỡng bằng validation, khóa cấu hình rồi đánh giá test; báo cáo precision/recall và trường hợp lỗi.
Giải thích vì sao confidence cao không tự chứng minh một cảnh báo là đúng.|Confidence phụ thuộc mô hình và hiệu chỉnh; có thể lệch miền dữ liệu; cần bằng chứng, ngữ cảnh và đánh giá của con người.'''),
  ('Học có giám sát và tối ưu', '''Học có giám sát sử dụng loại dữ liệu nào?|Dữ liệu có nhãn mục tiêu|Chỉ dữ liệu không có nhãn trong mọi trường hợp|Chỉ dữ liệu âm thanh
Bài toán dự đoán điểm số liên tục thường thuộc loại nào?|Hồi quy|Phân cụm bắt buộc|Sắp xếp HTML
Overfitting được nhận biết qua dấu hiệu nào?|Tốt trên train nhưng kém trên dữ liệu chưa thấy|Train và test đều hoàn hảo trong mọi tình huống|Mô hình không có tham số
Regularization thường nhằm mục đích gì?|Hạn chế độ phức tạp để cải thiện khả năng tổng quát|Bảo đảm sai số train luôn bằng 0|Tự tạo nhãn chính xác tuyệt đối
Gradient descent cập nhật tham số theo hướng nào?|Ngược hướng gradient để giảm hàm mất mát cục bộ|Luôn cùng hướng gradient để giảm loss|Không phụ thuộc hàm mất mát
Learning rate quá lớn có thể gây vấn đề gì?|Dao động hoặc không hội tụ|Bảo đảm tìm được nghiệm toàn cục|Loại bỏ mọi noise
Cross-validation có ích cho mục đích nào?|Ước lượng hiệu quả qua nhiều cách chia dữ liệu|Tạo thêm nhãn thật từ dự đoán|Thay thế mọi tập kiểm thử cuối cùng
Feature engineering là quá trình nào?|Xây dựng biểu diễn đầu vào phù hợp bài toán|Đổi tên biến CSS|Tăng số tài khoản quản trị
So sánh cây quyết định và hồi quy logistic cho bài toán phân loại đơn giản.|Nêu biểu diễn quyết định, tính phi tuyến, khả năng diễn giải, regularization và đánh giá trên cùng dữ liệu.
Nêu cách xử lý khi phân bố dữ liệu triển khai thay đổi theo thời gian.|Theo dõi drift và chất lượng trên nhãn mới, kiểm tra nguồn dữ liệu, đánh giá lại và huấn luyện/cập nhật có kiểm soát.'''),
 ],
 'python': [
  ('Python căn bản', '''Kiểu dữ liệu nào là một dãy có thể thay đổi trong Python?|list|tuple|str
Từ khóa nào định nghĩa một hàm Python?|def|function|func luôn là từ khóa Python
Kết quả len([2, 4, 6]) là gì?|3|6|12
Toán tử // với hai số nguyên dương thực hiện phép gì?|Chia lấy phần nguyên|Lũy thừa|Nối chuỗi
Biểu thức nào kiểm tra hai giá trị bằng nhau?|a == b|a = b|a := b như phép so sánh
range(3) sinh các số nguyên nào?|0, 1, 2|1, 2, 3|0, 1, 2, 3
Lệnh nào bắt đầu khối xử lý ngoại lệ?|try|catch như từ khóa mở đầu trong Python|error
Với d = {'x': 2}, d.get('y', 0) trả về gì?|0|2|Luôn gây KeyError
Viết hàm đếm số phần tử chẵn trong một danh sách số nguyên và nêu trường hợp danh sách rỗng.|Duyệt hoặc dùng sum với điều kiện x % 2 == 0; danh sách rỗng trả về 0; không thay đổi dữ liệu đầu vào.
Giải thích khác biệt giữa việc gán một list cho biến khác và tạo bản sao list.|Gán giữ cùng đối tượng; bản sao nông tạo list mới nhưng vẫn chia sẻ các phần tử lồng nhau.'''),
  ('Hàm, cấu trúc dữ liệu và tệp', '''set trong Python có đặc điểm nào?|Các phần tử duy nhất và không có thứ tự chỉ số như list|Luôn giữ các phần tử lặp|Chỉ chứa số nguyên
Dictionary ánh xạ giữa những thành phần nào?|Khóa và giá trị|Hai hàng trong bảng HTML|Cổng mạng và mật khẩu
with open(...) thường giúp điều gì?|Quản lý đóng tệp khi rời khối|Bỏ qua mọi lỗi đọc tệp|Tự mã hóa nội dung bằng TLS
List comprehension [x*x for x in [1,2,3]] cho kết quả nào?|[1,4,9]|[1,2,3]|[2,4,6]
Hàm sorted trả về giá trị nào?|Một list mới đã sắp xếp|Luôn thay đổi list đầu vào và trả về None|Một dictionary có thứ tự ngẫu nhiên
Tham số mặc định là list có rủi ro gì?|Có thể bị chia sẻ qua nhiều lần gọi hàm|Luôn được tạo mới cho mọi lần gọi|Không thể thêm phần tử
Generator hỗ trợ đặc điểm nào?|Sinh giá trị từng bước thay vì dựng toàn bộ dãy ngay|Bảo đảm tính toán song song trên mọi CPU|Chỉ sinh chuỗi ký tự
json.loads dùng cho thao tác nào?|Đọc dữ liệu JSON từ một chuỗi|Ghi đối tượng thành tệp ảnh|Tính giá trị băm mật khẩu
Viết quy trình đọc tệp CSV điểm số và xử lý dòng không hợp lệ mà vẫn giữ thông tin lỗi.|Dùng csv với encoding rõ, kiểm tra cột và kiểu điểm, giới hạn miền điểm, ghi vị trí/lý do lỗi; không log thông tin bí mật.
Thiết kế hàm seed có dry-run và giải thích cách bảo đảm không thay đổi dữ liệu khi kiểm tra.|Thực hiện trong transaction rồi rollback cho dry-run; không gọi dịch vụ có tác dụng bên ngoài; xác nhận ràng buộc trước commit.'''),
 ],
}

CLASSES = [
 ('web-1','web','Lập trình Web - Nhóm 1'), ('web-2','web','Lập trình Web - Nhóm 2'),
 ('database','database','Cơ sở dữ liệu - Nhóm 1'), ('network','network','Mạng máy tính - Nhóm 1'),
 ('security','security','An toàn thông tin - Nhóm 1'), ('software','software','Công nghệ phần mềm - Nhóm 1'),
 ('ai','ai','Trí tuệ nhân tạo - Nhóm 1'), ('python','python','Lập trình Python - Nhóm 1'),
]
