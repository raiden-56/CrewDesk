import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, TextField } from '@mui/material';
import { api, errorMessage } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<{ ok: boolean; devResetToken?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post('/auth/forgot-password', { email }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Reset your password" subtitle="We will send a reset link if the account exists." footer={<Link to="/login" className="text-accent font-medium">Back to sign in</Link>}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Alert severity="error">{error}</Alert>}
        {result?.ok && (
          <Alert severity="success">
            If an account exists for {email}, a reset link has been sent.
            {result.devResetToken && (
              <div className="mt-2 text-[12px]">
                Mail is not configured on this server, so for local development use this link: <Link to={`/reset-password?token=${result.devResetToken}`} className="underline">reset password</Link>
              </div>
            )}
          </Alert>
        )}
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <Button type="submit" variant="contained" disabled={busy || !email}>Send reset link</Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Choose a new password" footer={<Link to="/login" className="text-accent font-medium">Back to sign in</Link>}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {error && <Alert severity="error">{error}</Alert>}
        {!token && <Alert severity="warning">Missing reset token. Use the link from your email.</Alert>}
        <TextField label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} helperText="At least 10 characters" autoFocus />
        <Button type="submit" variant="contained" disabled={busy || password.length < 10 || !token}>Update password</Button>
      </form>
    </AuthLayout>
  );
}
