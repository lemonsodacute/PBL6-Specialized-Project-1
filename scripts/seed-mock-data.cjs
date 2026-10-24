const { Client } = require('pg');

const id = (group, number) => `00000000-0000-0000-${String(group).padStart(4, '0')}-${String(number).padStart(12, '0')}`;
const users = {
  admin: id(1, 1), teacher1: id(1, 2), teacher2: id(1, 3),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`student${i + 1}`, id(1, i + 4)])),
};
const classId = id(2, 1), bankId = id(3, 1), examPublished = id(4, 1), examOngoing = id(4, 2);
const questionIds = Array.from({ length: 15 }, (_, i) => id(5, i + 1));
const attemptIds = Array.from({ length: 6 }, (_, i) => id(6, i + 1));
const sessionIds = [id(7, 1), id(7, 2)];
const now = '2026-09-09T08:00:00Z';

async function insert(client, table, columns, rows) {
  for (const row of rows) {
    const values = row.map((value) => value && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
  }
}

async function seed() {
  const client = new Client({ host: 'localhost', port: 5432, database: 'pbl6', user: 'postgres', password: process.env.PGPASSWORD });
  await client.connect();
  try {
    await client.query('BEGIN');
    await insert(client, 'users', ['id', 'full_name', 'email', 'password_hash', 'role', 'phone', 'is_active', 'last_login_at', 'created_at', 'updated_at'], [
      [users.admin, 'Lê Hoàng Admin', 'admin@quizlet.local', 'mock-hash', 'admin', '0900000001', true, now, now, now],
      [users.teacher1, 'Nguyễn Thị Lan', 'lan.nguyen@quizlet.local', 'mock-hash', 'teacher', '0900000011', true, now, now, now],
      [users.teacher2, 'Trần Minh Quân', 'quan.tran@quizlet.local', 'mock-hash', 'teacher', '0900000012', true, now, now, now],
      ...['Phạm Minh Anh', 'Đỗ Gia Bảo', 'Vũ Khánh Linh', 'Hoàng Đức Minh', 'Bùi Ngọc Mai', 'Lý Quang Huy', 'Đặng Thu Hà', 'Phan Nhật Nam'].map((name, i) => [users[`student${i + 1}`], name, `student${i + 1}@quizlet.local`, 'mock-hash', 'student', `09100000${String(i + 1).padStart(2, '0')}`, true, now, now, now]),
    ]);
    await insert(client, 'classes', ['id', 'name', 'description', 'homeroom_teacher_id', 'created_at', 'updated_at'], [[classId, 'Lập trình Web K16', 'Lớp nền tảng phát triển ứng dụng web.', users.teacher1, now, now]]);
    await insert(client, 'class_enrollments', ['id', 'class_id', 'student_id', 'enrolled_at'], Array.from({ length: 8 }, (_, i) => [id(8, i + 1), classId, users[`student${i + 1}`], now]));
    await insert(client, 'question_banks', ['id', 'name', 'description', 'subject', 'created_by', 'is_active', 'created_at', 'updated_at'], [[bankId, 'Lập trình Web', 'Ngân hàng câu hỏi nền tảng HTML, CSS, JavaScript và Web API.', 'Công nghệ thông tin', users.teacher1, true, now, now]]);

    const mcq = (i, type, content, options, correct, topic, difficulty, points = 1) => [questionIds[i], bankId, type, content, points, topic, difficulty, options, correct, 'Đáp án được chọn theo kiến thức nền tảng của chủ đề.', null, null, true, now, now];
    const questions = [
      mcq(0, 'mcq_single', 'Thẻ HTML nào dùng để tạo liên kết?', ['<a>', '<link>', '<href>', '<nav>'], ['<a>'], 'HTML', 'easy'),
      mcq(1, 'mcq_single', 'HTTP status code nào biểu thị yêu cầu thành công?', ['200', '301', '404', '500'], ['200'], 'Web protocol', 'easy'),
      mcq(2, 'mcq_multi', 'Đâu là các kiểu dữ liệu nguyên thủy trong JavaScript?', ['string', 'number', 'object', 'boolean'], ['string', 'number', 'boolean'], 'JavaScript', 'easy', 1.5),
      mcq(3, 'mcq_single', 'CSS property nào thay đổi màu chữ?', ['font-color', 'text-color', 'color', 'foreground'], ['color'], 'CSS', 'easy'),
      mcq(4, 'mcq_multi', 'Đâu là các phương thức HTTP thường dùng?', ['GET', 'POST', 'FETCH', 'DELETE'], ['GET', 'POST', 'DELETE'], 'Web protocol', 'medium', 1.5),
      mcq(5, 'mcq_single', 'Cơ chế nào giúp trình duyệt lưu dữ liệu nhỏ phía client?', ['Cookie', 'Router', 'DNS', 'Proxy'], ['Cookie'], 'Web browser', 'easy'),
      mcq(6, 'mcq_single', 'Flexbox căn giữa theo trục chính bằng thuộc tính nào?', ['align-items', 'justify-content', 'place-items', 'text-align'], ['justify-content'], 'CSS', 'medium'),
      mcq(7, 'mcq_multi', 'Đâu là các framework JavaScript phổ biến?', ['React', 'Vue', 'Django', 'Angular'], ['React', 'Vue', 'Angular'], 'JavaScript', 'easy', 1.5),
      mcq(8, 'mcq_single', 'JSON.stringify dùng để làm gì?', ['Parse JSON thành object', 'Đổi object thành chuỗi JSON', 'Gửi request', 'Mã hóa mật khẩu'], ['Đổi object thành chuỗi JSON'], 'JavaScript', 'medium'),
      mcq(9, 'mcq_single', 'Thuộc tính CSS nào tạo khoảng cách bên trong phần tử?', ['margin', 'padding', 'gap', 'inset'], ['padding'], 'CSS', 'easy'),
      [questionIds[10], bankId, 'essay', 'Giải thích sự khác nhau giữa localStorage và sessionStorage.', 3, 'Web browser', 'medium', null, null, 'Đánh giá phạm vi sống và cách sử dụng dữ liệu phía client.', null, null, true, now, now],
      [questionIds[11], bankId, 'essay', 'Mô tả quy trình trình duyệt tải và hiển thị một trang web.', 4, 'Web rendering', 'hard', null, null, 'Cần đề cập DNS, request, response, parse và render.', null, null, true, now, now],
      [questionIds[12], bankId, 'oral', 'Trình bày ngắn gọn vai trò của semantic HTML trong accessibility.', 3, 'HTML', 'medium', null, null, 'Đánh giá khả năng diễn đạt và hiểu accessibility.', 20, 90, true, now, now],
      [questionIds[13], bankId, 'oral', 'Hãy giải thích event bubbling bằng một ví dụ thực tế.', 3, 'JavaScript', 'hard', null, null, 'Cần nêu luồng lan truyền từ phần tử con lên phần tử cha.', 20, 90, true, now, now],
      [questionIds[14], bankId, 'oral', 'So sánh responsive design và adaptive design.', 3, 'CSS', 'medium', null, null, 'Đánh giá khả năng phân biệt hai chiến lược thiết kế.', 15, 75, true, now, now],
    ];
    await insert(client, 'questions', ['id', 'question_bank_id', 'type', 'content', 'default_points', 'topic', 'difficulty', 'options_json', 'correct_answer_json', 'explanation', 'oral_prep_seconds', 'oral_answer_seconds', 'is_active', 'created_at', 'updated_at'], questions);

    const exams = [
      [examPublished, 'Kiểm tra giữa kỳ — Lập trình Web', 'Bài kiểm tra gồm trắc nghiệm, tự luận và vấn đáp.', users.teacher1, '2026-09-14T08:00:00Z', '2026-09-14T09:30:00Z', 90, true, true, true, 1, 5, true, true, 5, 'published', { allow_oral_recording: true }, null, '2026-09-01T08:00:00Z', '2026-09-01T08:00:00Z'],
      [examOngoing, 'Bài thực hành Web — Session 01', 'Bài thực hành đang diễn ra cho lớp Lập trình Web K16.', users.teacher1, '2026-09-09T07:30:00Z', '2026-09-09T09:00:00Z', 90, false, false, true, 2, 6, true, true, 8, 'ongoing', { live_monitoring: true }, null, '2026-09-03T08:00:00Z', '2026-09-09T07:30:00Z'],
    ];
    await insert(client, 'exams', ['id', 'title', 'description', 'created_by', 'start_time', 'end_time', 'duration_minutes', 'shuffle_questions', 'shuffle_options', 'allow_review', 'max_attempts', 'passing_score', 'require_camera', 'require_fullscreen', 'violation_auto_lock_threshold', 'status', 'extra_settings_json', 'deleted_at', 'created_at', 'updated_at'], exams);
    await insert(client, 'exam_questions', ['id', 'exam_id', 'question_id', 'draw_rule_id', 'order_index', 'points', 'created_at'], [...Array.from({ length: 10 }, (_, i) => [id(9, i + 1), examPublished, questionIds[i], null, i + 1, questions[i][4], now]), ...Array.from({ length: 10 }, (_, i) => [id(10, i + 1), examOngoing, questionIds[i + 5], null, i + 1, questions[i + 5][4], now])]);
    await insert(client, 'exam_assignments', ['id', 'exam_id', 'class_id', 'student_id', 'assigned_at'], [[id(11, 1), examPublished, classId, null, now], [id(11, 2), examOngoing, classId, null, now]]);

    const attemptRows = [
      [attemptIds[0], examOngoing, users.student1, 1, '2026-09-09T07:34:00Z', '2026-09-09T09:04:00Z', null, 'in_progress', null, 15, 1, 18, '192.168.1.21', 'Chrome / Windows', now, '2026-09-09T08:12:00Z'],
      [attemptIds[1], examOngoing, users.student2, 1, '2026-09-09T07:35:00Z', '2026-09-09T09:05:00Z', null, 'in_progress', null, 15, 4, 62, '192.168.1.22', 'Chrome / Windows', now, '2026-09-09T08:14:00Z'],
      [attemptIds[2], examOngoing, users.student3, 1, '2026-09-09T07:32:00Z', '2026-09-09T09:02:00Z', '2026-09-09T08:45:00Z', 'submitted', 12.5, 15, 0, 4, '192.168.1.23', 'Edge / Windows', now, '2026-09-09T08:45:00Z'],
      [attemptIds[3], examOngoing, users.student4, 1, '2026-09-09T07:36:00Z', '2026-09-09T09:06:00Z', '2026-09-09T08:50:00Z', 'auto_submitted', 8, 15, 6, 78, '192.168.1.24', 'Chrome / macOS', now, '2026-09-09T08:50:00Z'],
      [attemptIds[4], examPublished, users.student5, 1, null, null, null, 'not_started', null, 17, 0, null, null, null, '2026-09-05T08:00:00Z', '2026-09-05T08:00:00Z'],
      [attemptIds[5], examPublished, users.student6, 1, '2026-09-14T08:02:00Z', '2026-09-14T09:32:00Z', '2026-09-14T09:18:00Z', 'submitted', 14, 17, 2, 31, '192.168.1.26', 'Chrome / Windows', '2026-09-14T08:02:00Z', '2026-09-14T09:18:00Z'],
    ];
    await insert(client, 'exam_attempts', ['id', 'exam_id', 'student_id', 'attempt_number', 'started_at', 'server_deadline_at', 'submitted_at', 'status', 'score', 'max_score', 'violation_count', 'risk_score', 'ip_address', 'user_agent', 'created_at', 'updated_at'], attemptRows);
    const violations = [['tab_switch', 'low', 0, '2026-09-09T07:55:00Z', { duration_sec: 3 }], ['window_blur', 'medium', 1, '2026-09-09T07:48:00Z', { duration_sec: 11 }], ['copy', 'high', 1, '2026-09-09T07:52:00Z', { source: 'question-content' }], ['paste', 'high', 1, '2026-09-09T08:05:00Z', { character_count: 184 }], ['fullscreen_exit', 'medium', 3, '2026-09-09T07:44:00Z', { duration_sec: 18 }], ['right_click', 'low', 3, '2026-09-09T07:59:00Z', { target: 'exam-page' }], ['devtools_open', 'critical', 3, '2026-09-09T08:06:00Z', { detection: 'keyboard-shortcut' }], ['network_offline', 'medium', 5, '2026-09-14T08:21:00Z', { duration_sec: 8 }], ['network_online', 'low', 5, '2026-09-14T08:21:08Z', { recovered: true }]];
    await insert(client, 'violation_logs', ['id', 'attempt_id', 'type', 'severity', 'metadata_json', 'occurred_at', 'created_at'], violations.map((row, i) => [id(12, i + 1), attemptIds[row[2]], row[0], row[1], row[4], row[3], row[3]]));
    await client.query('UPDATE exam_attempts SET violation_count = CASE id WHEN $1 THEN 1 WHEN $2 THEN 4 WHEN $3 THEN 0 WHEN $4 THEN 6 WHEN $5 THEN 0 WHEN $6 THEN 2 ELSE violation_count END WHERE id IN ($1, $2, $3, $4, $5, $6)', attemptIds);
    await insert(client, 'proctoring_sessions', ['id', 'attempt_id', 'camera_enabled', 'mic_enabled', 'full_recording_url', 'started_at', 'ended_at', 'overall_risk_score', 'reviewed_by', 'reviewed_at', 'review_notes', 'deleted_at', 'created_at', 'updated_at'], [[sessionIds[0], attemptIds[0], true, true, null, '2026-09-09T07:34:00Z', null, 18, null, null, null, null, now, '2026-09-09T08:12:00Z'], [sessionIds[1], attemptIds[1], true, true, null, '2026-09-09T07:35:00Z', null, 62, null, null, null, null, now, '2026-09-09T08:14:00Z']]);
    await insert(client, 'detection_events', ['id', 'proctoring_session_id', 'attempt_id', 'event_type', 'confidence_score', 'severity', 'snapshot_url', 'metadata_json', 'occurred_at'], [[id(13, 1), sessionIds[0], attemptIds[0], 'gaze_away', .82, 'low', null, { duration_sec: 4 }, '2026-09-09T07:51:00Z'], [id(13, 2), sessionIds[0], attemptIds[0], 'face_not_detected', .91, 'medium', '/mock/snapshot-001.jpg', { duration_sec: 7 }, '2026-09-09T08:01:00Z'], [id(13, 3), sessionIds[1], attemptIds[1], 'multiple_faces', .96, 'critical', '/mock/snapshot-002.jpg', { face_count: 2 }, '2026-09-09T07:50:00Z'], [id(13, 4), sessionIds[1], attemptIds[1], 'object_phone', .88, 'high', '/mock/snapshot-003.jpg', { object: 'mobile_phone' }, '2026-09-09T08:03:00Z'], [id(13, 5), sessionIds[1], attemptIds[1], 'gaze_away', .79, 'medium', null, { duration_sec: 12 }, '2026-09-09T08:11:00Z']]);
    const liveId = id(14, 1);
    await insert(client, 'live_classes', ['id', 'class_id', 'teacher_id', 'title', 'description', 'scheduled_start', 'scheduled_end', 'actual_start', 'actual_end', 'meeting_url', 'recording_url', 'status', 'deleted_at', 'created_at', 'updated_at'], [[liveId, classId, users.teacher1, 'Workshop: Xây dựng form đăng nhập', 'Thực hành form và validation với HTML/CSS.', '2026-09-11T08:00:00Z', '2026-09-11T09:30:00Z', null, null, 'https://meet.example.test/web-001', null, 'scheduled', null, now, now]]);
    await insert(client, 'class_attendance', ['id', 'live_class_id', 'student_id', 'joined_at', 'left_at', 'duration_sec', 'status', 'created_at'], [[id(15, 1), liveId, users.student1, null, null, null, 'absent', now]]);
    await client.query('COMMIT');
    const counts = await client.query(`SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::int AS row_count FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users','classes','question_banks','questions','exams','exam_questions','exam_attempts','violation_logs','proctoring_sessions','detection_events','live_classes','class_attendance') ORDER BY table_name`);
    console.log('Mock data inserted successfully.');
    console.table(counts.rows);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
}

seed().catch((error) => { console.error(error.message); process.exit(1); });
