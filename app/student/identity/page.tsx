import { redirect } from 'next/navigation';

/** Compatibility URL: identity setup now lives in the authoritative profile. */
export default function LegacyStudentIdentityPage() {
  redirect('/student/profile');
}
