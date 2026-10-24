export type ThemePreference = 'light' | 'dark' | 'system';
export type ExamDefaults = { exam_duration_minutes: number; exam_require_camera: boolean; exam_require_mic: boolean };
export type PersonalSettings = {
  theme: ThemePreference; notification_preferences: Record<string, boolean>;
  notification_options: { key: string; label: string }[];
  exam_defaults: ExamDefaults | null;
  exam_overrides: { [K in keyof ExamDefaults]: ExamDefaults[K] | null } | null;
  updated_at: string | null;
};
export type PersonalSettingsPatch = Partial<Pick<PersonalSettings, 'theme' | 'notification_preferences'>> & Partial<{ [K in keyof ExamDefaults]: ExamDefaults[K] | null }>;
export type SystemSettings = ExamDefaults & { support_text: string; updated_at: string };
export const settingsRoute = (role: string) => `/${role}/settings`;
export const helpRoute = (role: string) => `/${role}/help`;
export const profileRoute = (role: string) => role === 'student' ? '/student/profile' : role === 'teacher' ? '/teacher/profile' : '/dashboard/users';

export function readPersonalSettings(value: PersonalSettings): PersonalSettings {
  if (!value || !['light', 'dark', 'system'].includes(value.theme) || !Array.isArray(value.notification_options)
      || !value.notification_preferences || typeof value.notification_preferences !== 'object') throw new Error('Invalid settings response');
  return value;
}
