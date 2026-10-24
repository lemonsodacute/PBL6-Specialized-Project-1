export type UserRole = 'admin' | 'teacher' | 'student';
export type ExamStatus = 'draft' | 'published' | 'ongoing' | 'closed';
export type QuestionType = 'mcq_single' | 'mcq_multi' | 'essay' | 'oral';
/** Authoring/selection excludes the retired format; QuestionType reads legacy history. */
export type SupportedQuestionType = Exclude<QuestionType, 'oral'>;
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type AttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'auto_submitted' | 'terminated';
export type ViolationType = 'tab_switch' | 'window_blur' | 'copy' | 'paste' | 'fullscreen_exit' | 'right_click' | 'devtools_open' | 'network_offline' | 'network_online' | 'multi_monitor' | 'other';
export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';
export type DetectionEventType = 'face_not_detected' | 'multiple_faces' | 'face_mismatch' | 'gaze_away' | 'object_phone' | 'object_book' | 'object_paper' | 'person_in_background' | 'audio_voice_detected' | 'audio_noise_abnormal';
export type AiCheckMethod = 'text_detector' | 'stylometry' | 'keystroke_pattern' | 'oral_crosscheck';
export type OralMode = 'live' | 'async';
export type OralAnswerStatus = 'recording' | 'uploaded' | 'processing' | 'processed' | 'failed';
export type LiveClassStatus = 'scheduled' | 'ongoing' | 'ended' | 'cancelled';
export type AttendanceStatus = 'present' | 'late' | 'absent';
export type NotificationType = 'support_message' | 'violation_alert' | 'exam_summary' | 'attempt_terminated' | 'profile_verification_request' | 'profile_verification_result' | 'student_card_update' | 'student_card_notice';
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type QuestionImage = { id: string; page?: number | null; position?: Record<string, unknown> | null; mime_type?: string; preview_url: string };

export interface User { id: string; full_name: string; email: string; password_hash: string; role: UserRole; phone: string | null; avatar_url: string | null; is_active: boolean; last_login_at: string | null; created_at: string; updated_at: string; student_code?: string | null; class_name?: string | null; identity_profile_status?: 'PENDING' | 'VERIFIED'; identity_profile_version?: number; identity_verified_at?: string | null; student_card_status?: 'NOT_SUBMITTED' | 'PENDING_CONFIRMATION' | 'VERIFIED' | 'NEEDS_REUPLOAD'; }
export interface AvatarFields { avatar_url?: string | null; avatar_source?: 'STUDENT_CARD' | 'TEACHER_UPLOAD' | null; avatar_reference_id?: string | null; avatar_updated_at?: string | null; }
export interface User extends AvatarFields {}
export interface Class { id: string; name: string; description: string | null; homeroom_teacher_id: string | null; created_at: string; updated_at: string; }
export interface ClassEnrollment { id: string; class_id: string; student_id: string; enrolled_at: string; }
export interface ExamAssignment { id: string; exam_id: string; class_id: string | null; student_id: string | null; assigned_at: string; }
export interface QuestionBank { id: string; name: string; description: string | null; subject: string | null; created_by: string; is_active: boolean; created_at: string; updated_at: string; }
export interface Question { images?: QuestionImage[] | null; id: string; question_bank_id: string; type: QuestionType; content: string; default_points: number; topic: string | null; difficulty: QuestionDifficulty | null; options_json: JsonValue | null; correct_answer_json: JsonValue | null; explanation: string | null; oral_prep_seconds: number | null; oral_answer_seconds: number | null; is_active: boolean; created_at: string; updated_at: string; }
export interface Exam { id: string; title: string; description: string | null; created_by: string; start_time: string; end_time: string; duration_minutes: number; shuffle_questions: boolean; shuffle_options: boolean; allow_review: boolean; max_attempts: number; passing_score: number | null; require_camera: boolean; require_mic?: boolean; require_fullscreen: boolean; violation_auto_lock_threshold: number | null; status: ExamStatus; extra_settings_json: JsonValue | null; deleted_at: string | null; created_at: string; updated_at: string; }
export interface ExamQuestion { id: string; exam_id: string; question_id: string; draw_rule_id: string | null; order_index: number; points: number; created_at: string; }
export interface ExamAttempt { id: string; exam_id: string; student_id: string; attempt_number: number; started_at: string | null; server_deadline_at: string | null; submitted_at: string | null; status: AttemptStatus; score: number | null; max_score: number | null; violation_count: number; risk_score: number | null; ip_address: string | null; user_agent: string | null; created_at: string; updated_at: string; }
export interface Answer { id: string; attempt_id: string; question_id: string; answer_content: JsonValue | null; is_correct: boolean | null; points_awarded: number | null; graded_by: string | null; graded_at: string | null; answered_at: string; updated_at: string; }
export interface OralAnswer { id: string; attempt_id: string; question_id: string; mode: OralMode; video_url: string | null; duration_sec: number | null; prep_time_used_sec: number | null; status: OralAnswerStatus; transcript_text: string | null; transcript_generated_at: string | null; recorded_at: string | null; deleted_at: string | null; created_at: string; updated_at: string; }
export interface OralGrading { id: string; oral_answer_id: string; grader_id: string; score: number; rubric_json: JsonValue | null; comment: string | null; graded_at: string; }
export interface ViolationLog { id: string; attempt_id: string; type: ViolationType; severity: SeverityLevel; metadata_json: JsonValue | null; occurred_at: string; created_at: string; }
export interface ProctoringSession { id: string; attempt_id: string; camera_enabled: boolean; mic_enabled: boolean; full_recording_url: string | null; started_at: string | null; ended_at: string | null; overall_risk_score: number | null; reviewed_by: string | null; reviewed_at: string | null; review_notes: string | null; deleted_at: string | null; created_at: string; updated_at: string; }
export interface DetectionEvent { id: string; proctoring_session_id: string; attempt_id: string; event_type: DetectionEventType; confidence_score: number | null; severity: SeverityLevel; snapshot_url: string | null; metadata_json: JsonValue | null; occurred_at: string; }
export interface AiCheckLog { id: string; attempt_id: string; answer_id: string | null; oral_answer_id: string | null; method: AiCheckMethod; score: number | null; raw_result_json: JsonValue | null; created_at: string; }
export interface LiveClass { class_name?:string|null;id: string; class_id: string; teacher_id: string; title: string; description: string | null; scheduled_start: string; scheduled_end: string; actual_start: string | null; actual_end: string | null; meeting_url: string | null; recording_url: string | null; status: LiveClassStatus; deleted_at: string | null; created_at: string; updated_at: string; }
export interface ClassAttendance { id: string; live_class_id: string; student_id: string; joined_at: string | null; left_at: string | null; duration_sec: number | null; status: AttendanceStatus; created_at: string; }
export interface Notification { related_proctor_event_id?: string | null; proctor_event_simulated?: boolean; id: string; recipient_user_id: string; related_student_id?: string | null; related_conversation_id?: string | null; type: NotificationType; title: string; message: string; related_exam_id: string | null; related_attempt_id: string | null; severity: 'low' | 'medium' | 'high' | 'critical' | null; is_read: boolean; created_at: string; email_sent_at: string | null; }
