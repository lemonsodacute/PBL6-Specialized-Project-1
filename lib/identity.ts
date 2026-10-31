export type IdentityStatus = {
  enrolled: boolean;
  status: 'not_enrolled' | 'pending_model' | 'verified';
  updated_at: string | null;
};

export type IdentityResult = {
  verified: boolean;
  status: 'verified' | 'rejected';
  score: number;
  threshold: number;
  liveness_checked: boolean;
  message: string;
};

export type EntryIdentityResult = IdentityResult & { id: string; reference_version: string };
export const entryMismatchMessage = 'Không thể xác minh người đang ngồi trước camera là sinh viên đã xác thực.';

export const identityPoses = [
  { label: 'Nhìn thẳng', hint: 'Nhìn thẳng vào camera, giữ khuôn mặt ở giữa khung.' },
  { label: 'Quay trái', hint: 'Quay nhẹ sang trái khoảng 20°, vẫn để camera thấy hai mắt.' },
  { label: 'Quay phải', hint: 'Quay nhẹ sang phải khoảng 20°, vẫn để camera thấy hai mắt.' },
] as const;

export const identityError = (cause: unknown) => cause instanceof Error ? cause.message : 'Có lỗi xảy ra. Vui lòng thử lại.';
