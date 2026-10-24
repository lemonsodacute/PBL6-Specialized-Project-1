from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID
from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, JSON, LargeBinary, Numeric, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class UserRole(str, Enum): admin = 'admin'; teacher = 'teacher'; student = 'student'
class ExamStatus(str, Enum): draft = 'draft'; published = 'published'; ongoing = 'ongoing'; closed = 'closed'
class QuestionType(str, Enum): mcq_single = 'mcq_single'; mcq_multi = 'mcq_multi'; essay = 'essay'; oral = 'oral'
class QuestionDifficulty(str, Enum): easy = 'easy'; medium = 'medium'; hard = 'hard'
class AttemptStatus(str, Enum): not_started = 'not_started'; in_progress = 'in_progress'; submitted = 'submitted'; auto_submitted = 'auto_submitted'; terminated = 'terminated'
class ViolationType(str, Enum): tab_switch = 'tab_switch'; window_blur = 'window_blur'; copy = 'copy'; paste = 'paste'; fullscreen_exit = 'fullscreen_exit'; right_click = 'right_click'; devtools_open = 'devtools_open'; network_offline = 'network_offline'; network_online = 'network_online'; multi_monitor = 'multi_monitor'; other = 'other'
class SeverityLevel(str, Enum): info = 'info'; low = 'low'; medium = 'medium'; high = 'high'; critical = 'critical'
class DetectionEventType(str, Enum): face_not_detected = 'face_not_detected'; multiple_faces = 'multiple_faces'; face_mismatch = 'face_mismatch'; gaze_away = 'gaze_away'; object_phone = 'object_phone'; object_book = 'object_book'; object_paper = 'object_paper'; person_in_background = 'person_in_background'; audio_voice_detected = 'audio_voice_detected'; audio_noise_abnormal = 'audio_noise_abnormal'
class AiCheckMethod(str, Enum): text_detector = 'text_detector'; stylometry = 'stylometry'; keystroke_pattern = 'keystroke_pattern'; oral_crosscheck = 'oral_crosscheck'
class OralMode(str, Enum): live = 'live'; async_ = 'async'
class OralAnswerStatus(str, Enum): recording = 'recording'; uploaded = 'uploaded'; processing = 'processing'; processed = 'processed'; failed = 'failed'
class ConsentType(str, Enum): camera_mic = 'camera_mic'; biometric_data = 'biometric_data'; recording_storage = 'recording_storage'
class LiveClassStatus(str, Enum): scheduled = 'scheduled'; ongoing = 'ongoing'; ended = 'ended'; cancelled = 'cancelled'
class AttendanceStatus(str, Enum): present = 'present'; late = 'late'; absent = 'absent'
class NotificationType(str, Enum):
    support_message = 'support_message'
    violation_alert = 'violation_alert'
    exam_summary = 'exam_summary'
    attempt_terminated = 'attempt_terminated'
    profile_verification_request = 'profile_verification_request'
    profile_verification_result = 'profile_verification_result'
    student_card_update = 'student_card_update'
    student_card_notice = 'student_card_notice'

def enum_type(enum_cls: type[Enum], name: str) -> SAEnum:
    return SAEnum(enum_cls, name=name, values_callable=lambda values: [item.value for item in values], native_enum=True)

class User(Base):
    __tablename__ = 'users'
    __table_args__ = (
        Index('idx_users_role', 'role'),
        UniqueConstraint('student_code', name='uq_users_student_code'),
        CheckConstraint("student_code IS NULL OR (student_code = upper(trim(student_code)) AND length(student_code) > 0 AND role = 'student')", name='ck_users_student_code'),
        CheckConstraint("identity_profile_status IN ('PENDING', 'VERIFIED')", name='ck_users_identity_profile_status'),
        CheckConstraint('identity_profile_version >= 1', name='ck_users_identity_profile_version'),
        CheckConstraint("identity_profile_status != 'VERIFIED' OR (role = 'student' AND length(trim(full_name)) > 0 AND identity_verified_at IS NOT NULL)", name='ck_users_verified_identity'),
        CheckConstraint("student_card_status IN ('NOT_SUBMITTED', 'PENDING_CONFIRMATION', 'VERIFIED', 'NEEDS_REUPLOAD')", name='ck_users_student_card_status'),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()'))
    full_name: Mapped[str] = mapped_column(String(255), nullable=False); email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True); password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    student_code: Mapped[str | None] = mapped_column(String(64))
    class_name: Mapped[str | None] = mapped_column(String(30))
    identity_profile_status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'PENDING'"))
    identity_profile_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1'))
    identity_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    identity_verified_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    student_card_status: Mapped[str] = mapped_column(String(24), nullable=False, server_default=text("'NOT_SUBMITTED'"))
    card_admin_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    card_update_reason: Mapped[str | None] = mapped_column(String(1000))
    card_last_action: Mapped[str | None] = mapped_column(String(32))
    avatar_source: Mapped[str | None] = mapped_column(String(32))
    avatar_reference_id: Mapped[UUID | None] = mapped_column(ForeignKey('student_card_references.id', name='fk_user_card_avatar_reference', ondelete='SET NULL', use_alter=True))
    avatar_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    role: Mapped[UserRole] = mapped_column(enum_type(UserRole, 'user_role'), nullable=False, server_default=text("'student'")); phone: Mapped[str | None] = mapped_column(String(20)); avatar_url: Mapped[str | None] = mapped_column(Text); is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('TRUE')); last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class StudentCardPreview(Base):
    __tablename__ = 'student_card_previews'
    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'SUPERSEDED', 'INVALIDATED', 'EXPIRED', 'CONFIRMED')", name='ck_student_card_preview_status'),
        CheckConstraint('expires_at > created_at', name='ck_student_card_preview_ttl'),
        CheckConstraint('identity_profile_version >= 1', name='ck_student_card_preview_profile_version'),
        Index('idx_student_card_previews_owner', 'student_id', 'status'),
        Index('idx_student_card_previews_expiry', 'expires_at'),
        Index('uq_student_card_preview_pending', 'student_id', unique=True, postgresql_where=text("status = 'PENDING'"), sqlite_where=text("status = 'PENDING'")),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    student_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    identity_profile_version: Mapped[int] = mapped_column(Integer, nullable=False)
    card_admin_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    original_image_key: Mapped[str] = mapped_column(String(96), nullable=False)
    card_preview_key: Mapped[str] = mapped_column(String(96), nullable=False)
    face_preview_key: Mapped[str] = mapped_column(String(96), nullable=False)
    image_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    extracted_json: Mapped[Any] = mapped_column(JSONB().with_variant(JSON(), 'sqlite'), nullable=False)
    confidence_json: Mapped[Any | None] = mapped_column(JSONB().with_variant(JSON(), 'sqlite'))
    validation_json: Mapped[Any] = mapped_column(JSONB().with_variant(JSON(), 'sqlite'), nullable=False)
    ocr_model_version: Mapped[str] = mapped_column(String(128), nullable=False)
    parser_version: Mapped[str] = mapped_column(String(64), nullable=False)
    matching_version: Mapped[str] = mapped_column(String(64), nullable=False)


class UserConsent(Base):
    __tablename__ = 'user_consents'; id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False); type: Mapped[ConsentType] = mapped_column(enum_type(ConsentType, 'consent_type'), nullable=False); granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); ip_address: Mapped[str | None] = mapped_column(INET)

class StudentIdentity(Base):
    __tablename__ = 'student_identities'; __table_args__ = (UniqueConstraint('student_id'), Index('idx_student_identities_student', 'student_id'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()'))
    student_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    front_image_path: Mapped[str | None] = mapped_column(Text)
    left_image_path: Mapped[str | None] = mapped_column(Text)
    right_image_path: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), nullable=False, server_default=text("'pending_model'"))
    consented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class StudentCardReference(Base):
    __tablename__ = 'student_card_references'
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE', 'SUPERSEDED', 'INVALIDATED')", name='ck_card_reference_status'),
        CheckConstraint('identity_profile_version >= 1', name='ck_card_reference_profile_version'),
        CheckConstraint("verification_source IN ('STUDENT_SELF_CONFIRM', 'ADMIN_CONFIRM', 'SYSTEM_MIGRATION')", name='ck_card_verification_source'),
        Index('uq_card_reference_active', 'student_id', unique=True, postgresql_where=text("status = 'ACTIVE'"), sqlite_where=text("status = 'ACTIVE'")),
        Index('idx_card_reference_student_created', 'student_id', 'created_at'),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    student_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    identity_profile_version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sanitized_face: Mapped[bytes | None] = mapped_column(LargeBinary)
    verified_by_user_id: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    verified_by_role: Mapped[str | None] = mapped_column(String(20))
    verification_source: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'SYSTEM_MIGRATION'"))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    revoke_reason: Mapped[str | None] = mapped_column(String(1000))
    ocr_model_version: Mapped[str | None] = mapped_column(String(128))
    parser_version: Mapped[str | None] = mapped_column(String(64))
    matching_version: Mapped[str | None] = mapped_column(String(64))
    face_model_name: Mapped[str | None] = mapped_column(String(64))
    face_model_version: Mapped[str | None] = mapped_column(String(64))
    face_preprocessing_version: Mapped[str | None] = mapped_column(String(128))


class StudentFaceEmbedding(Base):
    """One replaceable, versioned face template per student; never an API payload."""
    __tablename__ = 'student_face_embeddings'
    __table_args__ = (
        UniqueConstraint('student_id', name='uq_student_face_embeddings_student'),
        CheckConstraint('embedding_dimension > 0', name='ck_student_face_embeddings_dimension'),
        CheckConstraint('length(embedding) = embedding_dimension * 4', name='ck_student_face_embeddings_bytes'),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()'))
    student_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    embedding: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    reference_version: Mapped[UUID | None] = mapped_column(ForeignKey('student_card_references.id'))
    model_name: Mapped[str] = mapped_column(String(64), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    preprocessing_version: Mapped[str] = mapped_column(String(128), nullable=False)
    embedding_dimension: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class IdentityVerification(Base):
    """A face-verification request made before a student enters an exam."""
    __tablename__ = 'identity_verifications'; __table_args__ = (Index('idx_identity_verifications_student_exam', 'student_id', 'exam_id'), Index('idx_identity_verifications_created', 'created_at'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()'))
    student_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    exam_id: Mapped[UUID] = mapped_column(ForeignKey('exams.id', ondelete='CASCADE'), nullable=False)
    image_path: Mapped[str | None] = mapped_column(Text)
    reference_version: Mapped[UUID | None] = mapped_column(ForeignKey('student_card_references.id'))
    liveness_json: Mapped[Any | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(40), nullable=False, server_default=text("'pending_model'"))
    score: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class RefreshToken(Base):
    __tablename__ = 'refresh_tokens'; id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False); token_hash: Mapped[str] = mapped_column(String(255), nullable=False); user_agent: Mapped[str | None] = mapped_column(Text); ip_address: Mapped[str | None] = mapped_column(INET); expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False); revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class PasswordResetToken(Base):
    __tablename__ = 'password_reset_tokens'; id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False); token_hash: Mapped[str] = mapped_column(String(255), nullable=False); expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False); used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class Class(Base):
    __tablename__ = 'classes'; id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); name: Mapped[str] = mapped_column(String(255), nullable=False); description: Mapped[str | None] = mapped_column(Text); homeroom_teacher_id: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL')); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ClassEnrollment(Base):
    __tablename__ = 'class_enrollments'; __table_args__ = (UniqueConstraint('class_id', 'student_id'), Index('idx_class_enrollments_student', 'student_id'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); class_id: Mapped[UUID] = mapped_column(ForeignKey('classes.id', ondelete='CASCADE'), nullable=False); student_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False); enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class QuestionBank(Base):
    __tablename__ = 'question_banks'; __table_args__ = (Index('idx_question_banks_created_by', 'created_by'),)
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); name: Mapped[str] = mapped_column(String(255), nullable=False); description: Mapped[str | None] = mapped_column(Text); subject: Mapped[str | None] = mapped_column(String(255)); created_by: Mapped[UUID] = mapped_column(ForeignKey('users.id'), nullable=False); is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('TRUE')); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class Question(Base):
    images_json: Mapped[Any | None] = mapped_column(JSONB)
    __tablename__ = 'questions'; __table_args__ = (Index('idx_questions_bank', 'question_bank_id'), Index('idx_questions_topic_difficulty', 'topic', 'difficulty'), Index('idx_questions_active', 'is_active'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); question_bank_id: Mapped[UUID] = mapped_column(ForeignKey('question_banks.id', ondelete='RESTRICT'), nullable=False); type: Mapped[QuestionType] = mapped_column(enum_type(QuestionType, 'question_type'), nullable=False); content: Mapped[str] = mapped_column(Text, nullable=False); default_points: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, server_default=text('1')); topic: Mapped[str | None] = mapped_column(String(255)); difficulty: Mapped[QuestionDifficulty | None] = mapped_column(enum_type(QuestionDifficulty, 'question_difficulty')); options_json: Mapped[Any | None] = mapped_column(JSONB); correct_answer_json: Mapped[Any | None] = mapped_column(JSONB); explanation: Mapped[str | None] = mapped_column(Text); oral_prep_seconds: Mapped[int | None] = mapped_column(Integer); oral_answer_seconds: Mapped[int | None] = mapped_column(Integer); is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('TRUE')); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class Exam(Base):
    __tablename__ = 'exams'; __table_args__ = (CheckConstraint('end_time > start_time'), Index('idx_exams_created_by', 'created_by'), Index('idx_exams_status', 'status'))
    require_mic: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('FALSE'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); title: Mapped[str] = mapped_column(String(255), nullable=False); description: Mapped[str | None] = mapped_column(Text); created_by: Mapped[UUID] = mapped_column(ForeignKey('users.id'), nullable=False); start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False); end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False); duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False); shuffle_questions: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('FALSE')); shuffle_options: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('FALSE')); allow_review: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('TRUE')); max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1')); passing_score: Mapped[Decimal | None] = mapped_column(Numeric(6, 2)); require_camera: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('FALSE')); require_fullscreen: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('TRUE')); violation_auto_lock_threshold: Mapped[int | None] = mapped_column(Integer); status: Mapped[ExamStatus] = mapped_column(enum_type(ExamStatus, 'exam_status'), nullable=False, server_default=text("'draft'")); extra_settings_json: Mapped[Any | None] = mapped_column(JSONB); deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ExamAssignment(Base):
    __tablename__ = 'exam_assignments'; __table_args__ = (CheckConstraint('num_nonnulls(class_id, student_id) = 1'), Index('idx_exam_assignments_exam', 'exam_id'), Index('idx_exam_assignments_class', 'class_id'), Index('idx_exam_assignments_student', 'student_id'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); exam_id: Mapped[UUID] = mapped_column(ForeignKey('exams.id', ondelete='CASCADE'), nullable=False); class_id: Mapped[UUID | None] = mapped_column(ForeignKey('classes.id', ondelete='CASCADE')); student_id: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='CASCADE')); assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ExamProctor(Base):
    __tablename__ = 'exam_proctors'; __table_args__ = (UniqueConstraint('exam_id', 'proctor_id'),)
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); exam_id: Mapped[UUID] = mapped_column(ForeignKey('exams.id', ondelete='CASCADE'), nullable=False); proctor_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False); assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ExamQuestionDrawRule(Base):
    __tablename__ = 'exam_question_draw_rules'; __table_args__ = (Index('idx_draw_rules_exam', 'exam_id'),)
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); exam_id: Mapped[UUID] = mapped_column(ForeignKey('exams.id', ondelete='CASCADE'), nullable=False); question_bank_id: Mapped[UUID] = mapped_column(ForeignKey('question_banks.id'), nullable=False); question_type: Mapped[QuestionType | None] = mapped_column(enum_type(QuestionType, 'question_type')); topic: Mapped[str | None] = mapped_column(String(255)); difficulty: Mapped[QuestionDifficulty | None] = mapped_column(enum_type(QuestionDifficulty, 'question_difficulty')); count: Mapped[int] = mapped_column(Integer, nullable=False); points_each: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, server_default=text('1')); order_group: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0')); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ExamQuestion(Base):
    __tablename__ = 'exam_questions'; __table_args__ = (UniqueConstraint('exam_id', 'question_id'), Index('idx_exam_questions_exam_order', 'exam_id', 'order_index'), Index('idx_exam_questions_question', 'question_id'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); exam_id: Mapped[UUID] = mapped_column(ForeignKey('exams.id', ondelete='CASCADE'), nullable=False); question_id: Mapped[UUID] = mapped_column(ForeignKey('questions.id', ondelete='RESTRICT'), nullable=False); draw_rule_id: Mapped[UUID | None] = mapped_column(ForeignKey('exam_question_draw_rules.id', ondelete='SET NULL')); order_index: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0')); points: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, server_default=text('1')); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class LiveClass(Base):
    provider_close_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    __tablename__ = 'live_classes'; __table_args__ = (CheckConstraint('scheduled_end > scheduled_start'), Index('idx_live_classes_class', 'class_id'), Index('idx_live_classes_teacher', 'teacher_id'), Index('idx_live_classes_scheduled_start', 'scheduled_start'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); class_id: Mapped[UUID] = mapped_column(ForeignKey('classes.id', ondelete='CASCADE'), nullable=False); teacher_id: Mapped[UUID] = mapped_column(ForeignKey('users.id'), nullable=False); title: Mapped[str] = mapped_column(String(255), nullable=False); description: Mapped[str | None] = mapped_column(Text); scheduled_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False); scheduled_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False); actual_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); actual_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); meeting_url: Mapped[str | None] = mapped_column(Text); recording_url: Mapped[str | None] = mapped_column(Text); status: Mapped[LiveClassStatus] = mapped_column(enum_type(LiveClassStatus, 'live_class_status'), nullable=False, server_default=text("'scheduled'")); deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ClassAttendance(Base):
    active_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    participant_sid: Mapped[str | None] = mapped_column(String(100))
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __tablename__ = 'class_attendance'; __table_args__ = (UniqueConstraint('live_class_id', 'student_id'), Index('idx_attendance_live_class', 'live_class_id'), Index('idx_attendance_student', 'student_id'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); live_class_id: Mapped[UUID] = mapped_column(ForeignKey('live_classes.id', ondelete='CASCADE'), nullable=False); student_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False); joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); duration_sec: Mapped[int | None] = mapped_column(Integer); status: Mapped[AttendanceStatus] = mapped_column(enum_type(AttendanceStatus, 'attendance_status'), nullable=False, server_default=text("'absent'")); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ExamAttempt(Base):
    __tablename__ = 'exam_attempts'; __table_args__ = (UniqueConstraint('exam_id', 'student_id', 'attempt_number'), Index('idx_attempts_exam_student', 'exam_id', 'student_id'), Index('idx_attempts_status', 'status'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); exam_id: Mapped[UUID] = mapped_column(ForeignKey('exams.id', ondelete='CASCADE'), nullable=False); student_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False); attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1')); started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); server_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); status: Mapped[AttemptStatus] = mapped_column(enum_type(AttemptStatus, 'attempt_status'), nullable=False, server_default=text("'not_started'")); question_order_json: Mapped[Any | None] = mapped_column(JSONB); score: Mapped[Decimal | None] = mapped_column(Numeric(6, 2)); max_score: Mapped[Decimal | None] = mapped_column(Numeric(6, 2)); violation_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0')); risk_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2)); ip_address: Mapped[str | None] = mapped_column(INET); user_agent: Mapped[str | None] = mapped_column(Text); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class Answer(Base):
    __tablename__ = 'answers'; __table_args__ = (UniqueConstraint('attempt_id', 'question_id'), Index('idx_answers_attempt', 'attempt_id'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); attempt_id: Mapped[UUID] = mapped_column(ForeignKey('exam_attempts.id', ondelete='CASCADE'), nullable=False); question_id: Mapped[UUID] = mapped_column(ForeignKey('questions.id', ondelete='RESTRICT'), nullable=False); answer_content: Mapped[Any | None] = mapped_column(JSONB); is_correct: Mapped[bool | None] = mapped_column(Boolean); points_awarded: Mapped[Decimal | None] = mapped_column(Numeric(6, 2)); graded_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id')); graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); answered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class OralAnswer(Base):
    __tablename__ = 'oral_answers'; __table_args__ = (UniqueConstraint('attempt_id', 'question_id'), Index('idx_oral_answers_attempt', 'attempt_id'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); attempt_id: Mapped[UUID] = mapped_column(ForeignKey('exam_attempts.id', ondelete='CASCADE'), nullable=False); question_id: Mapped[UUID] = mapped_column(ForeignKey('questions.id', ondelete='RESTRICT'), nullable=False); mode: Mapped[OralMode] = mapped_column(enum_type(OralMode, 'oral_mode'), nullable=False, server_default=text("'async'")); video_url: Mapped[str | None] = mapped_column(Text); duration_sec: Mapped[int | None] = mapped_column(Integer); prep_time_used_sec: Mapped[int | None] = mapped_column(Integer); status: Mapped[OralAnswerStatus] = mapped_column(enum_type(OralAnswerStatus, 'oral_answer_status'), nullable=False, server_default=text("'recording'")); transcript_text: Mapped[str | None] = mapped_column(Text); transcript_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class OralGrading(Base):
    __tablename__ = 'oral_gradings'; __table_args__ = (UniqueConstraint('oral_answer_id', 'grader_id'),)
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); oral_answer_id: Mapped[UUID] = mapped_column(ForeignKey('oral_answers.id', ondelete='CASCADE'), nullable=False); grader_id: Mapped[UUID] = mapped_column(ForeignKey('users.id'), nullable=False); score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False); rubric_json: Mapped[Any | None] = mapped_column(JSONB); comment: Mapped[str | None] = mapped_column(Text); graded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ViolationLog(Base):
    __tablename__ = 'violation_logs'; __table_args__ = (Index('idx_violation_logs_attempt_time', 'attempt_id', 'occurred_at'),)
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); attempt_id: Mapped[UUID] = mapped_column(ForeignKey('exam_attempts.id', ondelete='CASCADE'), nullable=False); type: Mapped[ViolationType] = mapped_column(enum_type(ViolationType, 'violation_type'), nullable=False); severity: Mapped[SeverityLevel] = mapped_column(enum_type(SeverityLevel, 'severity_level'), nullable=False, server_default=text("'low'")); metadata_json: Mapped[Any | None] = mapped_column(JSONB); occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ProctoringSession(Base):
    __tablename__ = 'proctoring_sessions'
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); attempt_id: Mapped[UUID] = mapped_column(ForeignKey('exam_attempts.id', ondelete='CASCADE'), nullable=False, unique=True); camera_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('FALSE')); mic_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('FALSE')); full_recording_url: Mapped[str | None] = mapped_column(Text); started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); overall_risk_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2)); reviewed_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id')); reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); review_notes: Mapped[str | None] = mapped_column(Text); deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class DetectionEvent(Base):
    """Existing detector history, extended with model-independent triage/review."""
    __tablename__ = 'detection_events'
    __table_args__ = (
        Index('idx_detection_events_attempt_time', 'attempt_id', 'occurred_at'),
        Index('idx_detection_events_session', 'proctoring_session_id'),
        Index('idx_proctor_events_feed', 'exam_id', 'is_simulated', 'occurred_at'),
        Index('idx_proctor_events_review', 'exam_id', 'is_simulated', 'status', 'severity'),
        CheckConstraint('confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)', name='ck_proctor_confidence'),
        CheckConstraint('max_confidence IS NULL OR (max_confidence >= 0 AND max_confidence <= 1)', name='ck_proctor_max_confidence'),
        CheckConstraint("status IN ('NEW','REVIEWED','DISMISSED','CONFIRMED')", name='ck_proctor_status'),
        CheckConstraint('occurrence_count >= 1 AND duration_ms >= 0 AND review_version >= 0', name='ck_proctor_aggregation'),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()'))
    proctoring_session_id: Mapped[UUID] = mapped_column(ForeignKey('proctoring_sessions.id', ondelete='CASCADE'), nullable=False)
    attempt_id: Mapped[UUID] = mapped_column(ForeignKey('exam_attempts.id', ondelete='CASCADE'), nullable=False)
    # Nullable only for compatibility with legacy writers; new ingestion derives/validates all three links.
    exam_id: Mapped[UUID | None] = mapped_column(ForeignKey('exams.id', ondelete='CASCADE'))
    student_id: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False, server_default='LEGACY')
    provider: Mapped[str] = mapped_column(String(64), nullable=False, server_default='legacy')
    confidence_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    severity: Mapped[SeverityLevel] = mapped_column(enum_type(SeverityLevel, 'severity_level'), nullable=False, server_default='low')
    message: Mapped[str] = mapped_column(String(500), nullable=False, server_default='')
    snapshot_url: Mapped[str | None] = mapped_column(Text)  # Read-only legacy evidence. New ingestion is metadata-only.
    metadata_json: Mapped[Any | None] = mapped_column(JSONB().with_variant(JSON(), 'sqlite'))
    evidence_json: Mapped[Any | None] = mapped_column(JSONB().with_variant(JSON(), 'sqlite'))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    first_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default='0')
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default='1')
    max_confidence: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    is_simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default='NEW')
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    review_note: Mapped[str | None] = mapped_column(String(1000))
    review_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default='0')


class ProctorEventReceipt(Base):
    """Retry keys for meaningful adapter emissions, not per-frame predictions."""
    __tablename__ = 'proctor_event_receipts'
    attempt_id: Mapped[UUID] = mapped_column(ForeignKey('exam_attempts.id', ondelete='CASCADE'), primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), primary_key=True)
    external_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    event_id: Mapped[UUID] = mapped_column(ForeignKey('detection_events.id', ondelete='CASCADE'), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ProctorModelHealth(Base):
    __tablename__ = 'proctor_model_health'
    provider: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Sanitized code only; never a provider response, endpoint, image or credential.
    error_code: Mapped[str | None] = mapped_column(String(32))

class AiCheckLog(Base):
    __tablename__ = 'ai_check_logs'; __table_args__ = (CheckConstraint('num_nonnulls(answer_id, oral_answer_id) = 1'), Index('idx_ai_check_logs_attempt', 'attempt_id'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); attempt_id: Mapped[UUID] = mapped_column(ForeignKey('exam_attempts.id', ondelete='CASCADE'), nullable=False); answer_id: Mapped[UUID | None] = mapped_column(ForeignKey('answers.id', ondelete='CASCADE')); oral_answer_id: Mapped[UUID | None] = mapped_column(ForeignKey('oral_answers.id', ondelete='CASCADE')); method: Mapped[AiCheckMethod] = mapped_column(enum_type(AiCheckMethod, 'ai_check_method'), nullable=False); score: Mapped[Decimal | None] = mapped_column(Numeric(4, 3)); raw_result_json: Mapped[Any | None] = mapped_column(JSONB); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class KeystrokeLog(Base):
    __tablename__ = 'keystroke_logs'; __table_args__ = (UniqueConstraint('attempt_id', 'question_id'), Index('idx_keystroke_logs_attempt', 'attempt_id'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); attempt_id: Mapped[UUID] = mapped_column(ForeignKey('exam_attempts.id', ondelete='CASCADE'), nullable=False); question_id: Mapped[UUID] = mapped_column(ForeignKey('questions.id', ondelete='RESTRICT'), nullable=False); total_keystrokes: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0')); total_pasted_chars: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0')); avg_interval_ms: Mapped[Decimal | None] = mapped_column(Numeric(8, 2)); paste_events_json: Mapped[Any | None] = mapped_column(JSONB); raw_events_url: Mapped[str | None] = mapped_column(Text); typing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); typing_ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True)); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class AuditLog(Base):
    __tablename__ = 'audit_logs'; __table_args__ = (Index('idx_audit_logs_user_time', 'user_id', 'created_at'), Index('idx_card_audit_entity_time', 'entity_type', 'entity_id', 'created_at'))
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); user_id: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL')); action: Mapped[str] = mapped_column(String(100), nullable=False); entity_type: Mapped[str | None] = mapped_column(String(100)); entity_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True)); metadata_json: Mapped[Any | None] = mapped_column(JSONB().with_variant(JSON(), 'sqlite')); ip_address: Mapped[str | None] = mapped_column(INET().with_variant(String(45), 'sqlite')); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ReportExport(Base):
    __tablename__ = 'report_exports'
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()')); exam_id: Mapped[UUID | None] = mapped_column(ForeignKey('exams.id', ondelete='CASCADE')); exported_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id')); format: Mapped[str | None] = mapped_column(String(20)); file_url: Mapped[str | None] = mapped_column(Text); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

class ProfileVerificationRequest(Base):
    __tablename__ = 'profile_verification_requests'
    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED')", name='ck_profile_request_status'),
        CheckConstraint("(status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL AND rejection_reason IS NULL) OR (status <> 'PENDING' AND reviewed_at IS NOT NULL)", name='ck_profile_request_review'),
        CheckConstraint("(status = 'REJECTED' AND rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0) OR (status <> 'REJECTED' AND rejection_reason IS NULL)", name='ck_profile_request_reason'),
        Index('uq_profile_request_pending', 'student_id', unique=True, postgresql_where=text("status = 'PENDING'"), sqlite_where=text("status = 'PENDING'")),
        Index('idx_profile_request_queue', 'status', 'requested_at'),
        Index('idx_profile_request_student', 'student_id', 'requested_at'),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    student_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    rejection_reason: Mapped[str | None] = mapped_column(String(500))


class Notification(Base):
    __tablename__ = 'notifications'; __table_args__ = (Index('idx_notifications_recipient_read_created', 'recipient_user_id', 'is_read', 'created_at'),)
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=text('gen_random_uuid()'))
    recipient_user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    related_student_id: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    type: Mapped[NotificationType] = mapped_column(enum_type(NotificationType, 'notification_type'), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    related_exam_id: Mapped[UUID | None] = mapped_column(ForeignKey('exams.id', ondelete='CASCADE'))
    related_attempt_id: Mapped[UUID | None] = mapped_column(ForeignKey('exam_attempts.id', ondelete='SET NULL'))
    related_proctor_event_id: Mapped[UUID | None] = mapped_column(ForeignKey('detection_events.id', ondelete='SET NULL'))
    proctor_event_simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    severity: Mapped[str | None] = mapped_column(String(20))
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('FALSE'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    related_conversation_id: Mapped[UUID | None] = mapped_column(ForeignKey('support_conversations.id', ondelete='CASCADE'))


class SupportConversation(Base):
    __tablename__ = 'support_conversations'
    __table_args__ = (Index('idx_support_conversations_activity', 'last_message_at', 'id'),)
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SupportMessage(Base):
    __tablename__ = 'support_messages'
    __table_args__ = (
        UniqueConstraint('conversation_id', 'sender_id', 'client_id', name='uq_support_message_retry'),
        CheckConstraint('length(trim(body)) BETWEEN 1 AND 4000', name='ck_support_message_body'),
        Index('idx_support_messages_history', 'conversation_id', 'created_at', 'id'),
        Index('idx_support_messages_unread', 'conversation_id', 'read_at', 'sender_id'),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    conversation_id: Mapped[UUID] = mapped_column(ForeignKey('support_conversations.id', ondelete='CASCADE'), nullable=False)
    sender_id: Mapped[UUID] = mapped_column(ForeignKey('users.id'), nullable=False)
    client_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default='message', server_default='message')


class SupportSession(Base):
    __tablename__ = 'support_sessions'
    __table_args__ = (
        CheckConstraint("status IN ('AI_ACTIVE','RESOLVED_BY_AI','ESCALATED','ADMIN_ACTIVE','CLOSED')", name='ck_support_session_status'),
        UniqueConstraint('user_id', 'start_key', name='uq_support_session_start_retry'),
        Index('idx_support_sessions_owner', 'user_id', 'created_at'),
        Index('uq_support_session_active', 'user_id', unique=True,
              postgresql_where=text("status IN ('AI_ACTIVE','ESCALATED','ADMIN_ACTIVE')"),
              sqlite_where=text("status IN ('AI_ACTIVE','ESCALATED','ADMIN_ACTIVE')")),
    )
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    category: Mapped[str | None] = mapped_column(String(40))
    topic: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='AI_ACTIVE')
    phase: Mapped[str] = mapped_column(String(20), nullable=False, default='CATEGORY')
    conversation_id: Mapped[UUID | None] = mapped_column(ForeignKey('support_conversations.id', ondelete='SET NULL'))
    summary: Mapped[Any] = mapped_column(JSONB().with_variant(JSON(), 'sqlite'), nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    start_key: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))


class SupportArticle(Base):
    __tablename__ = 'support_articles'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(10))
    category: Mapped[str] = mapped_column(String(40))
    content: Mapped[str] = mapped_column(Text)
    keywords: Mapped[Any] = mapped_column(JSON, default=list)
    route: Mapped[str] = mapped_column(String(160))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    requires_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))


class AIActivity(Base):
    __tablename__ = 'ai_activities'
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    feature: Mapped[str] = mapped_column(String(12), index=True)
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    document_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    session_id: Mapped[UUID | None] = mapped_column(ForeignKey('support_sessions.id', ondelete='CASCADE'))
    role: Mapped[str] = mapped_column(String(10))
    category: Mapped[str | None] = mapped_column(String(40))
    metrics: Mapped[Any] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class AIDraftReview(Base):
    __tablename__ = 'ai_draft_reviews'
    __table_args__ = (CheckConstraint('quality_rating BETWEEN 1 AND 5', name='ck_ai_draft_review_quality_rating'),)
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    activity_id: Mapped[UUID] = mapped_column(ForeignKey('ai_activities.id', ondelete='CASCADE'), index=True)
    document_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), index=True)
    draft_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), index=True)
    reviewer_id: Mapped[UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    decision: Mapped[str | None] = mapped_column(String(10))
    reason: Mapped[str | None] = mapped_column(String(32))
    quality_rating: Mapped[int | None] = mapped_column(Integer)
    reason_note: Mapped[str | None] = mapped_column(String(2000))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SupportTurn(Base):
    __tablename__ = 'support_turns'
    __table_args__ = (UniqueConstraint('session_id', 'client_id', name='uq_support_turn_retry'),
                     Index('idx_support_turn_history', 'session_id', 'created_at'),)
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    session_id: Mapped[UUID] = mapped_column(ForeignKey('support_sessions.id', ondelete='CASCADE'), nullable=False)
    client_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    user_text: Mapped[str] = mapped_column(Text, nullable=False)
    assistant_text: Mapped[str] = mapped_column(Text, nullable=False)
    sources: Mapped[Any] = mapped_column(JSONB().with_variant(JSON(), 'sqlite'), nullable=False, default=list)
    used_provider: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class UserSettings(Base):
    __tablename__ = 'user_settings'
    __table_args__ = (
        CheckConstraint("theme IN ('light', 'dark', 'system')", name='ck_user_settings_theme'),
        CheckConstraint('exam_duration_minutes IS NULL OR exam_duration_minutes BETWEEN 1 AND 1440', name='ck_user_settings_duration'),
    )
    user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    theme: Mapped[str] = mapped_column(String(10), nullable=False, server_default='system')
    notification_preferences: Mapped[Any] = mapped_column(JSONB().with_variant(JSON(), 'sqlite'), nullable=False, default=dict, server_default=text("'{}'"))
    exam_duration_minutes: Mapped[int | None] = mapped_column(Integer)
    exam_require_camera: Mapped[bool | None] = mapped_column(Boolean)
    exam_require_mic: Mapped[bool | None] = mapped_column(Boolean)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class SystemSettings(Base):
    __tablename__ = 'system_settings'
    __table_args__ = (
        CheckConstraint('id = 1', name='ck_system_settings_singleton'),
        CheckConstraint('exam_duration_minutes BETWEEN 1 AND 1440', name='ck_system_settings_duration'),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    exam_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('60'))
    exam_require_camera: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('TRUE'))
    exam_require_mic: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('TRUE'))
    support_text: Mapped[str] = mapped_column(String(2000), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


# Keep PostgreSQL baseline documentation in ORM metadata as well.
# This prevents comment-only drift without creating a data migration.
for _table_name, _comment in {
    'question_banks': 'Bộ đề / ngân hàng câu hỏi, dùng lại được cho nhiều đề thi khác nhau',
    'questions': 'Câu hỏi thuộc 1 bộ đề, dùng lại được cho nhiều đề thi qua exam_questions',
    'exam_question_draw_rules': 'Tiêu chí rút ngẫu nhiên câu hỏi. Sinh ra exam_questions 1 lần, dùng chung cho mọi thí sinh của đề; giữ lại để hỗ trợ rút lại (regenerate) khi cần',
    'exam_questions': 'Bộ câu hỏi chính thức của 1 đề, GIỐNG NHAU cho mọi thí sinh. draw_rule_id NULL = chọn tay; NOT NULL = sinh từ rule',
    'live_classes': 'Buổi học trực tuyến trực tiếp (kiểu Zoom) của 1 lớp, do 1 giáo viên phụ trách',
    'class_attendance': 'Điểm danh theo join/leave time thực tế; status tính từ duration_sec (app-level logic)',
}.items():
    Base.metadata.tables[_table_name].comment = _comment
for (_table_name, _column_name), _comment in {
    ('questions', 'default_points'): 'Điểm gợi ý khi thêm câu vào đề — điểm chấm thật sự nằm ở exam_questions.points',
    ('questions', 'is_active'): 'Soft-retire: ẩn khỏi danh sách chọn/rút. KHÔNG xoá cứng vì có thể đã có answers tham chiếu',
    ('exams', 'shuffle_questions'): 'Chỉ xáo THỨ TỰ hiển thị của bộ câu hỏi đã chốt trong exam_questions, không liên quan tới rút câu',
    ('exam_questions', 'points'): 'Điểm chính thức dùng để chấm trong đề này, có thể khác default_points của câu hỏi gốc',
}.items():
    Base.metadata.tables[_table_name].c[_column_name].comment = _comment
