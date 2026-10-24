export type HelpGuide = { title: string; body: string; href: string; linkLabel: string };
export type HelpContent = { quick: { label: string; href: string }[]; guides: HelpGuide[]; faq: { question: string; answer: string }[] };
export const helpContent: Record<'student' | 'teacher' | 'admin', HelpContent> = {
  student: {
    quick: [{ label: 'Xác minh danh tính', href: '/student/profile#identity-heading' }, { label: 'Xem kỳ thi', href: '/student/exams' }, { label: 'Xem kết quả', href: '/student/grades' }],
    guides: [
      { title: 'Cập nhật hồ sơ', body: 'Mở Hồ sơ sinh viên để kiểm tra họ tên, MSSV và số điện thoại. Số điện thoại có thể cập nhật tại đây. Thông tin định danh đã khóa do quản trị viên quản lý.', href: '/student/profile', linkLabel: 'Mở hồ sơ sinh viên' },
      { title: 'Xác thực thẻ sinh viên', body: 'Trong Hồ sơ, mở Xác minh danh tính và chọn Tải thẻ sinh viên. Đợi hệ thống đọc ảnh, kiểm tra họ tên, MSSV và khuôn mặt trong bản xem trước, rồi bấm Xác nhận thẻ sinh viên khi thông tin hợp lệ. Thẻ đã xác thực không có nút thay ảnh; chỉ tải lại khi được yêu cầu cập nhật hoặc xác thực không còn hiệu lực.', href: '/student/profile#identity-heading', linkLabel: 'Mở xác minh danh tính' },
      { title: 'Vào kỳ thi', body: 'Mở Làm kiểm tra để xem đề được giao. Kiểm tra thời gian mở đề và số lượt thi còn lại. Với đề yêu cầu camera, hoàn tất kiểm tra thiết bị và xác minh khuôn mặt, sau đó chọn Bắt đầu làm bài.', href: '/student/exams', linkLabel: 'Xem kỳ thi' },
      { title: 'Camera hoặc microphone không hoạt động', body: 'Cho phép trình duyệt truy cập camera và microphone khi được hỏi. Kiểm tra quyền của trang trong thanh địa chỉ và thiết bị đầu vào của máy. Đóng ứng dụng đang chiếm camera rồi mở lại camera tại bước kiểm tra thiết bị. Cài đặt ứng dụng không thể cấp quyền thay trình duyệt.', href: '/student/exams', linkLabel: 'Về danh sách kỳ thi' },
      { title: 'Làm bài và nộp bài', body: 'Trong bài thi, chọn đáp án hoặc nhập câu trả lời. Theo dõi trạng thái lưu và thời gian còn lại. Dùng Nộp bài và xác nhận khi đã kiểm tra bài làm. Thời hạn bài thi do server quản lý; không đóng trang khi chưa nhận được kết quả nộp.', href: '/student/exams', linkLabel: 'Mở kỳ thi' },
      { title: 'Xem kết quả', body: 'Mở Điểm số / Kết quả hoặc Lịch sử làm bài để xem điểm đã lưu và chi tiết bài đã nộp. Câu tự luận có thể cần giảng viên chấm thêm. Đáp án đúng chỉ xuất hiện khi đề cho phép công bố hoặc đã đóng theo chính sách hiện tại.', href: '/student/grades', linkLabel: 'Mở điểm số / kết quả' },
      { title: 'Tham gia lớp học trực tuyến', body: 'Mở Lớp học trực tuyến để tìm buổi học của lớp bạn. Khi giảng viên đã bắt đầu buổi học, mở phòng và tham gia. Cho phép thiết bị khi được hỏi; bật hoặc tắt camera và microphone bằng các điều khiển trong phòng.', href: '/student/live-classes', linkLabel: 'Mở lớp học trực tuyến' },
    ],
    faq: [
      { question: 'Tại sao tôi chưa được vào thi?', answer: 'Đề phải được giao cho bạn hoặc lớp của bạn, đang trong thời gian làm bài và còn lượt thi. Nếu đề yêu cầu camera, hồ sơ, thẻ sinh viên và xác minh khuôn mặt trước thi phải hợp lệ. Xem thông báo trên trang kỳ thi để biết bước còn thiếu.' },
      { question: 'Tại sao thẻ sinh viên không đọc được?', answer: 'Chọn ảnh rõ, đủ toàn bộ thẻ và không bị lóa. Kiểm tra thông tin hệ thống thực sự đọc được trong bản xem trước. Nếu thông tin không khớp hoặc chưa đọc đủ, chọn ảnh khác; không xác nhận thông tin sai. Liên hệ quản trị viên nếu họ tên hoặc MSSV trong hồ sơ cần sửa.' },
      { question: 'Tại sao tôi không thể thay avatar?', answer: 'Ảnh hồ sơ sinh viên được lấy tự động từ khuôn mặt đã xử lý của thẻ sinh viên đang được xác thực. Sinh viên không tải lên, thay hoặc xóa avatar thủ công.' },
      { question: 'Tôi đã nộp bài nhưng chưa thấy kết quả?', answer: 'Mở lại Điểm số / Kết quả hoặc Lịch sử làm bài để tải dữ liệu mới. Nếu bài vẫn đang làm hoặc thao tác nộp báo lỗi, kiểm tra kết nối và trạng thái bài. Điểm tự luận có thể đang chờ chấm; không suy ra điểm từ số đáp án đã chọn.' },
    ],
  },
  teacher: {
    quick: [{ label: 'Ngân hàng câu hỏi', href: '/dashboard/question-banks' }, { label: 'Tạo đề thi', href: '/dashboard/exams?create=1' }, { label: 'Xem kết quả', href: '/dashboard/reports' }, { label: 'Giám sát', href: '/dashboard/monitor' }],
    guides: [
      { title: 'Ngân hàng câu hỏi và tạo câu thủ công', body: 'Mở Ngân hàng câu hỏi, tạo hoặc chọn ngân hàng của bạn. Trong ngân hàng, thêm câu hỏi, nhập nội dung, loại câu, các phương án và đáp án đúng phù hợp, rồi lưu. Kiểm tra lại câu hỏi trước khi đưa vào đề.', href: '/dashboard/question-banks', linkLabel: 'Mở ngân hàng câu hỏi' },
      { title: 'Tạo câu hỏi từ Word/PDF', body: 'Mở một ngân hàng và chọn tạo câu hỏi từ tài liệu. Tải file .docx hoặc PDF, bấm Đọc tài liệu và xem trước văn bản, hình ảnh được trích xuất. Chọn nhập câu có sẵn hoặc tạo bằng AI khi chức năng này đã được cấu hình; kiểm tra bản nháp và đáp án trước khi xác nhận nhập. Phiên tài liệu có hiệu lực 2 giờ.', href: '/dashboard/question-banks', linkLabel: 'Chọn ngân hàng để nhập tài liệu' },
      { title: 'Tạo đề thi', body: 'Mở Đề thi và chọn Tạo đề thi. Điền tên, thời gian, thời lượng và yêu cầu thiết bị; chọn câu hỏi và giao đề cho lớp. Lưu nháp để kiểm tra hoặc xuất bản khi đã sẵn sàng. Mặc định đã lưu trong Cài đặt chỉ điền sẵn cho đề mới.', href: '/dashboard/exams?create=1', linkLabel: 'Tạo đề thi mới' },
      { title: 'Chọn câu hỏi ngẫu nhiên', body: 'Trong form đề thi, chọn ngân hàng rồi mở lựa chọn ngẫu nhiên để cấu hình số lượng, loại câu, chủ đề hoặc độ khó. Kiểm tra danh sách câu đã chọn và tổng điểm trước khi lưu. Hệ thống báo thiếu câu nếu ngân hàng không đáp ứng cấu hình.', href: '/dashboard/exams', linkLabel: 'Mở quản lý đề thi' },
      { title: 'Quản lý lớp', body: 'Mở Lớp học để xem lớp và sinh viên được phép quản lý. Mở chi tiết lớp để kiểm tra danh sách sinh viên và các đề được giao; chỉ thực hiện những thao tác có sẵn theo quyền của tài khoản.', href: '/dashboard/classes', linkLabel: 'Mở lớp học' },
      { title: 'Xem điểm sinh viên và báo cáo', body: 'Trong Đề thi, chọn Kết quả để xem danh sách sinh viên và lịch sử làm bài. Trong Báo cáo, lọc theo Đề thi để xem từng bài làm, điểm đã lưu và sự kiện giám sát. Chọn Xem để mở chi tiết báo cáo, rồi Xem bài làm và đáp án để đọc câu trả lời. Tải lại báo cáo lấy dữ liệu mới; Xuất CSV tải đúng phạm vi đang lọc. Khi chọn tất cả đề, điểm trung bình được chuẩn hóa theo phần trăm.', href: '/dashboard/reports', linkLabel: 'Mở kết quả bài thi' },
      { title: 'Giám sát kỳ thi', body: 'Mở Giám sát, chọn kỳ thi được phép phụ trách rồi xem trạng thái sinh viên và cảnh báo. Mở sinh viên để xem thông tin chi tiết, diễn biến và các thao tác giám sát đang được hỗ trợ.', href: '/dashboard/monitor', linkLabel: 'Mở giám sát' },
      { title: 'Bắt đầu lớp học trực tuyến', body: 'Mở Lớp học trực tuyến, chọn Tạo buổi học và điền lớp, tiêu đề, thời gian. Với buổi học đã lên lịch, bấm Bắt đầu rồi vào phòng. Kết thúc buổi học khi đã hoàn thành; phòng và quyền tham gia được backend kiểm tra.', href: '/dashboard/live-classes', linkLabel: 'Mở lớp học trực tuyến' },
    ],
    faq: [
      { question: 'Làm sao nhập câu hỏi từ Word/PDF?', answer: 'Chọn ngân hàng trước, mở chức năng tài liệu, tải file và bấm Đọc tài liệu. Với tài liệu có câu và đáp án, chọn Nhập câu hỏi có sẵn. Review bản nháp trước khi nhập; nếu câu phụ thuộc hình mà model chưa hỗ trợ phân tích hình, cần kiểm tra thủ công.' },
      { question: 'Làm sao xem điểm thật của sinh viên?', answer: 'Mở Đề thi → Kết quả hoặc Báo cáo → Xem kết quả. Điểm đọc từ bài làm đã lưu trên server. Sinh viên chưa làm hoặc đang làm hiển thị dấu —. Bấm Tải lại kết quả để lấy dữ liệu mới.' },
      { question: 'Làm sao xem cảnh báo giám sát?', answer: 'Mở Giám sát và chọn đề thi. Thông báo cảnh báo giám sát cũng có trong biểu tượng chuông nếu bạn bật loại thông báo này. Cảnh báo mức độ cao luôn được giữ.' },
      { question: 'Mặc định đề thi có thay đổi đề cũ không?', answer: 'Không. Cài đặt chỉ điền sẵn khi tạo đề mới. Giảng viên có thể dùng mặc định hệ thống hoặc lưu mặc định riêng và chỉnh lại ngay trong form đề thi.' },
    ],
  },
  admin: {
    quick: [{ label: 'Quản lý người dùng', href: '/dashboard/users' }, { label: 'Xác thực thẻ sinh viên', href: '/admin/student-cards' }, { label: 'Nhật ký hệ thống', href: '/dashboard/action-logs' }],
    guides: [
      { title: 'Quản lý người dùng và xác minh hồ sơ', body: 'Mở Quản lý người dùng để tìm tài khoản và xem thông tin hồ sơ. Kiểm tra họ tên, MSSV trước khi xác minh hồ sơ sinh viên. Khi hồ sơ cần sửa, cập nhật thông tin thật và xử lý yêu cầu xác minh phù hợp; xác minh hồ sơ không tự thay thế bước xác thực thẻ.', href: '/dashboard/users', linkLabel: 'Mở quản lý người dùng' },
      { title: 'Quản lý lớp', body: 'Mở Quản lý lớp học để tạo hoặc xem lớp, giảng viên phụ trách và danh sách sinh viên. Mở chi tiết lớp để quản lý thành viên theo các thao tác hiện có.', href: '/admin/classes', linkLabel: 'Mở quản lý lớp học' },
      { title: 'Kiểm tra xác thực thẻ sinh viên', body: 'Mở Xác thực thẻ sinh viên và tìm theo thông tin hoặc trạng thái. Chọn Xem để kiểm tra hồ sơ, thẻ, người xác nhận, thời điểm và lịch sử xác thực. Ảnh khuôn mặt được xem qua quyền truy cập riêng; không dùng màn hình quản trị để giả lập kết quả OCR hoặc xác thực.', href: '/admin/student-cards', linkLabel: 'Mở xác thực thẻ sinh viên' },
      { title: 'Thu hồi hoặc yêu cầu cập nhật thẻ', body: 'Trong danh sách hoặc chi tiết thẻ, chọn Thu hồi hoặc Yêu cầu cập nhật. Nhập lý do và xác nhận hành động. Sinh viên sẽ nhận thông báo và cần tải thẻ mới theo trạng thái được hệ thống trả về. Thao tác này làm thay đổi hiệu lực xác thực nên cần kiểm tra đúng sinh viên.', href: '/admin/student-cards', linkLabel: 'Quản lý hiệu lực xác thực thẻ' },
      { title: 'Quản lý đề thi và báo cáo', body: 'Mở Quản lý đề thi để xem các đề theo quyền Admin. Chọn Kết quả hoặc mở Báo cáo & thống kê để xem roster, điểm và chi tiết bài đã nộp từ dữ liệu thật.', href: '/dashboard/exams', linkLabel: 'Mở quản lý đề thi' },
      { title: 'Nhật ký hệ thống', body: 'Mở Nhật ký hệ thống để xem người thực hiện, hành động, thời điểm và chi tiết. Lọc theo hành động để kiểm tra các thay đổi; cập nhật cài đặt hệ thống được ghi với giá trị trước và sau.', href: '/dashboard/action-logs', linkLabel: 'Mở nhật ký hệ thống' },
      { title: 'Cài đặt hệ thống', body: 'Mở Cài đặt để lưu mặc định đề thi cho người chưa có mặc định riêng và nội dung liên hệ hỗ trợ dùng chung. Mỗi phần có nút Lưu thay đổi; chỉ khi backend lưu thành công mới có thông báo xác nhận. Thay đổi được ghi vào nhật ký hệ thống.', href: '/admin/settings', linkLabel: 'Mở cài đặt hệ thống' },
    ],
    faq: [
      { question: 'Làm sao xác minh sinh viên?', answer: 'Kiểm tra họ tên và MSSV trong Quản lý người dùng, rồi xử lý xác minh hồ sơ. Sinh viên tiếp tục tải thẻ, xem bản xem trước và xác nhận thẻ theo flow hiện tại. Không gán trạng thái xác thực chỉ vì đã có ảnh.' },
      { question: 'Làm sao thu hồi thẻ đã xác thực?', answer: 'Mở Xác thực thẻ sinh viên, chọn đúng sinh viên, dùng Thu hồi, nhập lý do và xác nhận. Lịch sử và thông báo ghi nhận hành động này; sinh viên cần cập nhật thẻ để có xác thực còn hiệu lực.' },
      { question: 'Làm sao xem ai đã xác thực thẻ?', answer: 'Xem cột Người xác nhận và mở chi tiết thẻ để xem lịch sử. Dữ liệu cũ chưa ghi nhận người thực hiện không được suy đoán hoặc gán tên giả.' },
      { question: 'Làm sao kiểm tra ai sửa cài đặt hệ thống?', answer: 'Mở Nhật ký hệ thống và lọc Cập nhật cài đặt hệ thống. Bản ghi thể hiện người thực hiện, thời gian, trường thay đổi cùng giá trị cũ và mới.' },
    ],
  },
};
