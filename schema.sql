-- =====================================================================
-- AI PROCTORING + LIVE CLASS SYSTEM — FULL DATABASE SCHEMA (PostgreSQL)
-- =====================================================================
-- File hợp nhất — gộp toàn bộ: auth/lớp học, ngân hàng câu hỏi, đề thi
-- (chọn tay hoặc rút ngẫu nhiên dùng chung cho cả đề), học online trực
-- tiếp (live class kiểu Zoom + điểm danh), làm bài & chấm điểm, vấn
-- đáp, behavior tracking, AI proctoring, AI usage detection, audit &
-- báo cáo. Chạy 1 file duy nhất này là đủ, không cần file phụ nào khác.
--
-- Giả định thiết kế:
--   - 1 tổ chức duy nhất -> không có bảng organizations/multi-tenant
--   - Câu hỏi thuộc 1 bộ đề (question_banks), dùng lại được cho nhiều
--     đề thi qua bảng trung gian exam_questions
--   - exam_questions là bộ câu hỏi CHÍNH THỨC của 1 đề, GIỐNG NHAU cho
--     mọi thí sinh — dù được điền bằng tay hay rút ngẫu nhiên 1 lần
--     qua exam_question_draw_rules (không rút riêng theo từng người)
--   - Role "giáo viên" và "giám thị" gộp chung 'teacher'; ai coi thi
--     đề nào gán riêng qua exam_proctors
--   - UUID làm khoá chính (pgcrypto.gen_random_uuid())
--   - Không xoá cứng questions đã từng được dùng (answers/exam_questions
--     tham chiếu tới) — FK ON DELETE RESTRICT, "xoá" = set is_active=false
--   - deleted_at (soft-delete) cho các bảng chứa video/dữ liệu nhạy cảm
--     (oral_answers, proctoring_sessions, live_classes) để phục vụ
--     retention policy theo Nghị định 13/2023
-- =====================================================================

-- =====================================================================
-- 0. EXTENSIONS
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================================
-- 1. ENUM TYPES
-- =====================================================================
CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'student');
CREATE TYPE exam_status AS ENUM ('draft', 'published', 'ongoing', 'closed');
CREATE TYPE question_type AS ENUM ('mcq_single', 'mcq_multi', 'essay', 'oral');
CREATE TYPE question_difficulty AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE attempt_status AS ENUM (
    'not_started', 'in_progress', 'submitted', 'auto_submitted', 'terminated'
);
CREATE TYPE violation_type AS ENUM (
    'tab_switch', 'window_blur', 'copy', 'paste', 'fullscreen_exit',
    'right_click', 'devtools_open', 'network_offline', 'network_online',
    'multi_monitor', 'other'
);
CREATE TYPE severity_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE detection_event_type AS ENUM (
    'face_not_detected', 'multiple_faces', 'face_mismatch', 'gaze_away',
    'object_phone', 'object_book', 'object_paper', 'person_in_background',
    'audio_voice_detected', 'audio_noise_abnormal'
);
CREATE TYPE ai_check_method AS ENUM (
    'text_detector', 'stylometry', 'keystroke_pattern', 'oral_crosscheck'
);
CREATE TYPE oral_mode AS ENUM ('live', 'async');
CREATE TYPE oral_answer_status AS ENUM (
    'recording', 'uploaded', 'processing', 'processed', 'failed'
);
CREATE TYPE consent_type AS ENUM (
    'camera_mic', 'biometric_data', 'recording_storage'
);
CREATE TYPE live_class_status AS ENUM ('scheduled', 'ongoing', 'ended', 'cancelled');
CREATE TYPE attendance_status AS ENUM ('present', 'late', 'absent');

-- =====================================================================
-- 2. MODULE 1 — USERS, LỚP HỌC, AUTH
-- =====================================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL DEFAULT 'student',
    phone           VARCHAR(20),
    avatar_url      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_consents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            consent_type NOT NULL,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    ip_address      INET
);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    user_agent      TEXT,
    ip_address      INET,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Student face enrollment and per-exam verification requests.
CREATE TABLE student_identities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id          UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    front_image_path    TEXT,
    left_image_path     TEXT,
    right_image_path    TEXT,
    status              VARCHAR(40) NOT NULL DEFAULT 'pending_model',
    consented_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE classes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(255) NOT NULL,
    description             TEXT,
    homeroom_teacher_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE class_enrollments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (class_id, student_id)
);

-- =====================================================================
-- 3. MODULE 2 — NGÂN HÀNG CÂU HỎI
-- =====================================================================
CREATE TABLE question_banks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    subject         VARCHAR(255),
    created_by      UUID NOT NULL REFERENCES users(id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE question_banks IS 'Bộ đề / ngân hàng câu hỏi, dùng lại được cho nhiều đề thi khác nhau';

CREATE TABLE questions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_bank_id    UUID NOT NULL REFERENCES question_banks(id) ON DELETE RESTRICT,
    type                question_type NOT NULL,
    content             TEXT NOT NULL,
    default_points      NUMERIC(6,2) NOT NULL DEFAULT 1,
    topic               VARCHAR(255),
    difficulty          question_difficulty,
    options_json        JSONB,
    correct_answer_json JSONB,
    explanation         TEXT,
    oral_prep_seconds   INT,
    oral_answer_seconds INT,
    images_json JSONB,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE questions IS 'Câu hỏi thuộc 1 bộ đề, dùng lại được cho nhiều đề thi qua exam_questions';
COMMENT ON COLUMN questions.default_points IS 'Điểm gợi ý khi thêm câu vào đề — điểm chấm thật sự nằm ở exam_questions.points';
COMMENT ON COLUMN questions.is_active IS 'Soft-retire: ẩn khỏi danh sách chọn/rút. KHÔNG xoá cứng vì có thể đã có answers tham chiếu';

-- =====================================================================
-- 4. MODULE 3 — ĐỀ THI & GHÉP CÂU HỎI VÀO ĐỀ
-- =====================================================================
CREATE TABLE exams (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                           VARCHAR(255) NOT NULL,
    description                     TEXT,
    created_by                      UUID NOT NULL REFERENCES users(id),
    start_time                      TIMESTAMPTZ NOT NULL,
    end_time                        TIMESTAMPTZ NOT NULL,
    duration_minutes                INT NOT NULL CHECK (duration_minutes > 0),
    shuffle_questions               BOOLEAN NOT NULL DEFAULT FALSE,
    shuffle_options                 BOOLEAN NOT NULL DEFAULT FALSE,
    allow_review                    BOOLEAN NOT NULL DEFAULT TRUE,
    max_attempts                    INT NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
    passing_score                   NUMERIC(6,2),
    require_camera                  BOOLEAN NOT NULL DEFAULT FALSE,
    require_fullscreen              BOOLEAN NOT NULL DEFAULT TRUE,
    violation_auto_lock_threshold   INT,
    status                          exam_status NOT NULL DEFAULT 'draft',
    extra_settings_json             JSONB,
    deleted_at                      TIMESTAMPTZ,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_time > start_time)
);
COMMENT ON COLUMN exams.shuffle_questions IS 'Chỉ xáo THỨ TỰ hiển thị của bộ câu hỏi đã chốt trong exam_questions, không liên quan tới rút câu';

CREATE TABLE identity_verifications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exam_id             UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    image_path          TEXT,
    liveness_json       JSONB,
    status              VARCHAR(40) NOT NULL DEFAULT 'pending_model',
    score               NUMERIC(5,4),
    failure_reason      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exam_assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id     UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    class_id    UUID REFERENCES classes(id) ON DELETE CASCADE,
    student_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(class_id, student_id) = 1)
);

CREATE TABLE exam_proctors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id     UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    proctor_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exam_id, proctor_id)
);

CREATE TABLE exam_question_draw_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id             UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question_bank_id    UUID NOT NULL REFERENCES question_banks(id),
    question_type       question_type,
    topic               VARCHAR(255),
    difficulty          question_difficulty,
    count               INT NOT NULL CHECK (count > 0),
    points_each         NUMERIC(6,2) NOT NULL DEFAULT 1,
    order_group         INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE exam_question_draw_rules IS 'Tiêu chí rút ngẫu nhiên câu hỏi. Sinh ra exam_questions 1 lần, dùng chung cho mọi thí sinh của đề; giữ lại để hỗ trợ rút lại (regenerate) khi cần';

CREATE TABLE exam_questions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id         UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question_id     UUID NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
    draw_rule_id    UUID REFERENCES exam_question_draw_rules(id) ON DELETE SET NULL,
    order_index     INT NOT NULL DEFAULT 0,
    points          NUMERIC(6,2) NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exam_id, question_id)
);
COMMENT ON TABLE exam_questions IS 'Bộ câu hỏi chính thức của 1 đề, GIỐNG NHAU cho mọi thí sinh. draw_rule_id NULL = chọn tay; NOT NULL = sinh từ rule';
COMMENT ON COLUMN exam_questions.points IS 'Điểm chính thức dùng để chấm trong đề này, có thể khác default_points của câu hỏi gốc';

-- =====================================================================
-- 5. MODULE 4 — HỌC ONLINE TRỰC TIẾP (LIVE CLASS, kiểu Zoom)
-- =====================================================================
CREATE TABLE live_classes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id        UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    teacher_id      UUID NOT NULL REFERENCES users(id),
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end   TIMESTAMPTZ NOT NULL,
    actual_start    TIMESTAMPTZ,
    actual_end      TIMESTAMPTZ,
    provider_close_pending BOOLEAN NOT NULL DEFAULT false,
    meeting_url     TEXT,
    recording_url   TEXT,
    status          live_class_status NOT NULL DEFAULT 'scheduled',
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (scheduled_end > scheduled_start)
);
COMMENT ON TABLE live_classes IS 'Buổi học trực tuyến trực tiếp (kiểu Zoom) của 1 lớp, do 1 giáo viên phụ trách';

CREATE TABLE class_attendance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_class_id   UUID NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ,
    left_at         TIMESTAMPTZ,
    duration_sec    INT,
    active_since    TIMESTAMPTZ,
    participant_sid VARCHAR(100),
    last_event_at   TIMESTAMPTZ,
    status          attendance_status NOT NULL DEFAULT 'absent',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (live_class_id, student_id)
);
COMMENT ON TABLE class_attendance IS 'Điểm danh theo join/leave time thực tế; status tính từ duration_sec (app-level logic)';

-- =====================================================================
-- 6. MODULE 5 — LÀM BÀI & CHẤM ĐIỂM
-- =====================================================================
CREATE TABLE exam_attempts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id             UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempt_number      INT NOT NULL DEFAULT 1,
    started_at          TIMESTAMPTZ,
    server_deadline_at  TIMESTAMPTZ,
    submitted_at        TIMESTAMPTZ,
    status              attempt_status NOT NULL DEFAULT 'not_started',
    question_order_json JSONB,
    score               NUMERIC(6,2),
    max_score           NUMERIC(6,2),
    violation_count     INT NOT NULL DEFAULT 0,
    risk_score          NUMERIC(5,2),
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exam_id, student_id, attempt_number)
);

CREATE TABLE answers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id      UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    question_id     UUID NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
    answer_content  JSONB,
    is_correct      BOOLEAN,
    points_awarded  NUMERIC(6,2),
    graded_by       UUID REFERENCES users(id),
    graded_at       TIMESTAMPTZ,
    answered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, question_id)
);

-- =====================================================================
-- 7. MODULE 6 — VẤN ĐÁP
-- =====================================================================
CREATE TABLE oral_answers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id              UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    question_id             UUID NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
    mode                    oral_mode NOT NULL DEFAULT 'async',
    video_url               TEXT,
    duration_sec            INT,
    prep_time_used_sec      INT,
    status                  oral_answer_status NOT NULL DEFAULT 'recording',
    transcript_text         TEXT,
    transcript_generated_at TIMESTAMPTZ,
    recorded_at             TIMESTAMPTZ,
    deleted_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, question_id)
);

CREATE TABLE oral_gradings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oral_answer_id  UUID NOT NULL REFERENCES oral_answers(id) ON DELETE CASCADE,
    grader_id       UUID NOT NULL REFERENCES users(id),
    score           NUMERIC(6,2) NOT NULL,
    rubric_json     JSONB,
    comment         TEXT,
    graded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (oral_answer_id, grader_id)
);

-- =====================================================================
-- 8. MODULE 7 — BEHAVIOR TRACKING (không AI)
-- =====================================================================
CREATE TABLE violation_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id      UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    type            violation_type NOT NULL,
    severity        severity_level NOT NULL DEFAULT 'low',
    metadata_json   JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 9. MODULE 8 — AI PROCTORING
-- =====================================================================
CREATE TABLE proctoring_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id          UUID NOT NULL UNIQUE REFERENCES exam_attempts(id) ON DELETE CASCADE,
    camera_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    mic_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    full_recording_url  TEXT,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    overall_risk_score  NUMERIC(5,2),
    reviewed_by         UUID REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE detection_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proctoring_session_id   UUID NOT NULL REFERENCES proctoring_sessions(id) ON DELETE CASCADE,
    attempt_id              UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    event_type              detection_event_type NOT NULL,
    confidence_score        NUMERIC(4,3),
    severity                severity_level NOT NULL DEFAULT 'low',
    snapshot_url            TEXT,
    metadata_json           JSONB,
    occurred_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 10. MODULE 9 — AI USAGE DETECTION
-- =====================================================================
CREATE TABLE ai_check_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id      UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    answer_id       UUID REFERENCES answers(id) ON DELETE CASCADE,
    oral_answer_id  UUID REFERENCES oral_answers(id) ON DELETE CASCADE,
    method          ai_check_method NOT NULL,
    score           NUMERIC(4,3),
    raw_result_json JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(answer_id, oral_answer_id) = 1)
);

CREATE TABLE keystroke_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id          UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    question_id         UUID NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
    total_keystrokes    INT NOT NULL DEFAULT 0,
    total_pasted_chars  INT NOT NULL DEFAULT 0,
    avg_interval_ms     NUMERIC(8,2),
    paste_events_json   JSONB,
    raw_events_url      TEXT,
    typing_started_at   TIMESTAMPTZ,
    typing_ended_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, question_id)
);

-- =====================================================================
-- 11. MODULE 10 — AUDIT & BÁO CÁO
-- =====================================================================
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(100),
    entity_id       UUID,
    metadata_json   JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE report_exports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id     UUID REFERENCES exams(id) ON DELETE CASCADE,
    exported_by UUID REFERENCES users(id),
    format      VARCHAR(20),
    file_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 12. INDEXES
-- =====================================================================
CREATE INDEX idx_users_role                     ON users(role);
CREATE INDEX idx_student_identities_student      ON student_identities(student_id);
CREATE INDEX idx_identity_verifications_student_exam ON identity_verifications(student_id, exam_id);
CREATE INDEX idx_identity_verifications_created  ON identity_verifications(created_at);
CREATE INDEX idx_class_enrollments_student       ON class_enrollments(student_id);

CREATE INDEX idx_question_banks_created_by       ON question_banks(created_by);
CREATE INDEX idx_questions_bank                  ON questions(question_bank_id);
CREATE INDEX idx_questions_topic_difficulty      ON questions(topic, difficulty);
CREATE INDEX idx_questions_active                ON questions(is_active);

CREATE INDEX idx_exams_created_by                ON exams(created_by);
CREATE INDEX idx_exams_status                    ON exams(status);
CREATE INDEX idx_exam_assignments_exam           ON exam_assignments(exam_id);
CREATE INDEX idx_exam_assignments_class          ON exam_assignments(class_id);
CREATE INDEX idx_exam_assignments_student        ON exam_assignments(student_id);
CREATE INDEX idx_draw_rules_exam                 ON exam_question_draw_rules(exam_id);
CREATE INDEX idx_exam_questions_exam_order       ON exam_questions(exam_id, order_index);
CREATE INDEX idx_exam_questions_question         ON exam_questions(question_id);

CREATE INDEX idx_live_classes_class              ON live_classes(class_id);
CREATE INDEX idx_live_classes_teacher            ON live_classes(teacher_id);
CREATE INDEX idx_live_classes_scheduled_start    ON live_classes(scheduled_start);
CREATE INDEX idx_attendance_live_class           ON class_attendance(live_class_id);
CREATE INDEX idx_attendance_student              ON class_attendance(student_id);

CREATE INDEX idx_attempts_exam_student           ON exam_attempts(exam_id, student_id);
CREATE INDEX idx_attempts_status                 ON exam_attempts(status);
CREATE INDEX idx_answers_attempt                 ON answers(attempt_id);
CREATE INDEX idx_oral_answers_attempt            ON oral_answers(attempt_id);
CREATE INDEX idx_violation_logs_attempt_time     ON violation_logs(attempt_id, occurred_at);
CREATE INDEX idx_detection_events_attempt_time   ON detection_events(attempt_id, occurred_at);
CREATE INDEX idx_detection_events_session        ON detection_events(proctoring_session_id);
CREATE INDEX idx_ai_check_logs_attempt           ON ai_check_logs(attempt_id);
CREATE INDEX idx_keystroke_logs_attempt          ON keystroke_logs(attempt_id);
CREATE INDEX idx_audit_logs_user_time            ON audit_logs(user_id, created_at);

-- =====================================================================
-- 13. TRIGGERS
-- =====================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at            BEFORE UPDATE ON users              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_classes_updated_at          BEFORE UPDATE ON classes            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_question_banks_updated_at   BEFORE UPDATE ON question_banks     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_questions_updated_at        BEFORE UPDATE ON questions          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_exams_updated_at            BEFORE UPDATE ON exams              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_live_classes_updated_at     BEFORE UPDATE ON live_classes       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_attempts_updated_at         BEFORE UPDATE ON exam_attempts      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_answers_updated_at          BEFORE UPDATE ON answers            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_oral_answers_updated_at     BEFORE UPDATE ON oral_answers       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_proctoring_updated_at       BEFORE UPDATE ON proctoring_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_keystroke_updated_at        BEFORE UPDATE ON keystroke_logs     FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION increment_violation_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE exam_attempts
    SET violation_count = violation_count + 1
    WHERE id = NEW.attempt_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_violation_count
AFTER INSERT ON violation_logs
FOR EACH ROW EXECUTE FUNCTION increment_violation_count();

-- =====================================================================
-- HẾT FILE
-- =====================================================================
