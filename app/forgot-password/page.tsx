import AuthLayout from '@/app/components/auth-layout';
import ForgotPasswordForm from './forgot-password-form';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return <AuthLayout><ForgotPasswordForm /></AuthLayout>;
}
