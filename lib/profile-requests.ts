export type ProfileRequestStatus = {
  identity_profile_status: 'PENDING' | 'VERIFIED';
  verification_request_status: 'NOT_REQUESTED' | 'PENDING' | 'REJECTED';
  verification_requested_at: string | null;
  verification_rejection_reason: string | null;
};
export type ReviewStudent = {
  id: string; full_name: string; email: string; phone?: string | null;
  role: 'student' | 'teacher' | 'admin'; is_active: boolean; student_code: string | null;
  identity_profile_status: 'PENDING' | 'VERIFIED'; identity_profile_version: number;
};
export type ProfileRequest = {
  id: string; status: 'PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  requested_at: string; reviewed_at: string | null; rejection_reason: string | null;
  student: ReviewStudent;
};
