// Regenerate the server-only KB after reviewing changes to Help content.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../node_modules/typescript');
const root = path.resolve(__dirname, '../..');
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/help-content.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleOutput = { exports: {} };
new Function('exports', 'module', compiled)(moduleOutput.exports, moduleOutput);
const help = moduleOutput.exports.helpContent;
const categories = {
  student: [['exams', 'Bài kiểm tra'], ['identity', 'Xác minh danh tính'], ['student-card', 'Thẻ sinh viên'], ['camera', 'Camera / Microphone'], ['classes', 'Lớp học'], ['live-class', 'Lớp học trực tuyến'], ['results', 'Điểm số / Kết quả'], ['account', 'Tài khoản'], ['other', 'Vấn đề khác']],
  teacher: [['exams', 'Đề thi'], ['question-bank', 'Ngân hàng câu hỏi'], ['classes', 'Lớp học'], ['monitoring', 'Giám sát'], ['grading', 'Chấm điểm / Kết quả'], ['live-class', 'Lớp học trực tuyến'], ['reports', 'Báo cáo'], ['account', 'Tài khoản'], ['other', 'Vấn đề khác']],
};
const mapping = { student: ['account', 'student-card', 'exams', 'camera', 'exams', 'results', 'live-class'], teacher: ['question-bank', 'question-bank', 'exams', 'exams', 'classes', 'reports', 'monitoring', 'live-class'] };
const articles = [];
for (const role of ['student', 'teacher']) {
  help[role].guides.forEach((guide, i) => articles.push({ id: `${role}-${i}`, role, category: mapping[role][i], title: guide.title, steps: guide.body.split(/(?<=\.)\s+/), route: guide.href, keywords: [guide.title], requires_admin: false, is_active: true, source: 'lib/help-content.ts', updated_at: '2026-10-16' }));
}
articles.find(a => a.id === 'student-3').keywords.push('camera', 'microphone', 'CAMERA_PERMISSION_DENIED');
function article(id, role, category, title, steps, route, keywords = [], requires_admin = false) {
  articles.push({ id, role, category, title, steps, route, keywords: [title, ...keywords], requires_admin, is_active: true, source: 'Reviewed application Help and feature UI', updated_at: '2026-10-16' });
}
article('card-class', 'student', 'student-card', 'Sai Lớp hoặc không đọc được thông tin trên thẻ', [
  'Chọn ảnh rõ nét, đủ toàn bộ thẻ, không bị lóa; đảm bảo dòng Lớp không bị che hoặc cắt mất.',
  'Trong Hồ sơ → Xác minh danh tính, tải lại ảnh JPG/PNG khi hệ thống cho phép tải thẻ.',
  'Kiểm tra thông tin trong bản xem trước. Không xác nhận nếu thông tin sai; nếu vẫn không đọc đúng, yêu cầu quản trị viên kiểm tra.',
], '/student/profile#identity-heading', ['sai lớp', 'không đọc được', 'ảnh thẻ', 'ocr', 'class']);
article('card-face', 'student', 'student-card', 'Không nhận diện khuôn mặt trên thẻ', ['Dùng ảnh rõ, đủ toàn bộ thẻ và không cắt mất vùng khuôn mặt.', 'Kiểm tra khuôn mặt trong bản xem trước trước khi xác nhận thẻ. Nếu không nhận diện được, chọn ảnh khác rõ hơn.'], '/student/profile#identity-heading', ['khuôn mặt', 'FACE_TOO_SMALL']);
article('card-profile', 'student', 'student-card', 'MSSV hoặc hồ sơ đã khóa không khớp thẻ', ['Thông tin định danh đã khóa do quản trị viên quản lý. Trợ lý không thể sửa MSSV hoặc xác minh hồ sơ thay bạn. Vấn đề này cần quản trị viên hệ thống kiểm tra.'], '/student/profile', ['sai mssv', 'STUDENT_CODE_MISMATCH', 'hồ sơ không khớp'], true);
article('card-revoked', 'student', 'student-card', 'Thẻ bị thu hồi', ['Kiểm tra thông báo về việc thu hồi hoặc yêu cầu cập nhật thẻ. Trợ lý không thể khôi phục xác thực; quản trị viên cần kiểm tra trường hợp của bạn.'], '/student/profile#identity-heading', ['thu hồi', 'revoke'], true);
article('identity', 'student', 'identity', 'Kiểm tra điều kiện xác minh trước thi', [help.student.faq[0].answer, help.student.guides[1].body], '/student/profile#identity-heading', ['xác minh', 'không vào thi']);
article('student-classes', 'student', 'classes', 'Xem lớp học phần', ['Mở Lớp học phần để xem các lớp của bạn và mở lớp cần kiểm tra.', 'Nếu bạn không thấy lớp được giao, quản trị viên cần kiểm tra danh sách thành viên.'], '/student/classes', ['lớp học', 'không thấy lớp']);
article('teacher-grading', 'teacher', 'grading', 'Xem điểm và kết quả đã lưu', [help.teacher.guides[5].body, help.teacher.faq[1].answer], '/dashboard/exams', ['điểm', 'kết quả', 'chấm điểm']);
article('teacher-account', 'teacher', 'account', 'Hồ sơ và cài đặt giảng viên', ['Mở Hồ sơ giảng viên để kiểm tra thông tin tài khoản. Mở Cài đặt để xem các tùy chọn của tài khoản.', 'Thông tin hoặc quyền không đúng cần được quản trị viên kiểm tra; trợ lý không thể thay đổi vai trò hay quyền.'], '/teacher/profile', ['hồ sơ', 'cài đặt']);
for (const role of ['student', 'teacher']) {
  article(`${role}-locked`, role, 'account', 'Tài khoản bị khóa hoặc sai quyền', ['Vấn đề này cần quản trị viên hệ thống kiểm tra. Trợ lý không có quyền mở khóa tài khoản, thay đổi vai trò hoặc quyền truy cập.'], `/${role}/help`, ['bị khóa', 'sai quyền', 'sai role', 'unlock', 'permission'], true);
  article(`${role}-score`, role, role === 'student' ? 'results' : 'grading', 'Điểm số cần kiểm tra lại', ['Trợ lý không thể sửa hoặc suy đoán điểm. Quản trị viên cần kiểm tra yêu cầu về dữ liệu điểm; hãy mô tả kỳ thi và vấn đề bạn thấy.'], role === 'student' ? '/student/grades' : '/dashboard/reports', ['sai điểm', 'điểm sai', 'sửa điểm'], true);
}
const topics = {
  'student:student-card': [['Không đọc được thông tin', 'card-class'], ['Sai MSSV', 'card-profile'], ['Sai Lớp', 'card-class'], ['Không nhận diện khuôn mặt', 'card-face'], ['Không xác nhận được thẻ', 'student-1'], ['Thẻ bị thu hồi', 'card-revoked']],
  'teacher:monitoring': [['Không thấy sinh viên', 'teacher-6'], ['Không thấy cảnh báo', 'teacher-6'], ['Sai trạng thái đề thi', 'teacher-2'], ['Không mở được giám sát', 'teacher-6']],
};
for (const [role, list] of Object.entries(categories)) {
  categories[role] = list.map(([id, label]) => ({ id, label, topics: (topics[`${role}:${id}`] || articles.filter(a => a.role === role && a.category === id).map(a => [a.title, a.id])).map(([label, article_id], i) => ({ id: `${id}-${i}`, label, article_id })) }));
}
const target = path.join(root, 'backend/app/support/knowledge.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify({ version: 1, categories, articles }, null, 2) + '\n');
console.log(`Wrote ${articles.length} reviewed support articles`);
