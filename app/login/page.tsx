import LoginForm from '@/components/auth/LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return <LoginForm initialMode={mode} />;
}
