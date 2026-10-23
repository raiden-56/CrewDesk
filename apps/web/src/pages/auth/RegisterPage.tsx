import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, TextField } from '@mui/material';
import { RegisterSchema, type UserDto, type WorkspaceDto } from '@collabspace/shared';
import type { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { AuthLayout } from './AuthLayout';

type Form = z.infer<typeof RegisterSchema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(RegisterSchema), defaultValues: { name: '', email: '', password: '', workspaceName: '' } });

  const onSubmit = async (values: Form) => {
    setError(null);
    try {
      const res = await api.post<{ user: UserDto; workspaces: WorkspaceDto[] }>('/auth/register', { ...values, workspaceName: values.workspaceName || undefined });
      setSession(res.user, res.workspaces);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Start a workspace for your human + AI team." footer={<span>Already registered? <Link to="/login" className="text-accent font-medium">Sign in</Link></span>}>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3" noValidate>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Full name" autoFocus {...register('name')} error={Boolean(formState.errors.name)} helperText={formState.errors.name?.message} />
        <TextField label="Email" type="email" autoComplete="email" {...register('email')} error={Boolean(formState.errors.email)} helperText={formState.errors.email?.message} />
        <TextField label="Password" type="password" autoComplete="new-password" {...register('password')} error={Boolean(formState.errors.password)} helperText={formState.errors.password?.message ?? 'At least 10 characters'} />
        <TextField label="Workspace name (optional)" {...register('workspaceName')} error={Boolean(formState.errors.workspaceName)} helperText={formState.errors.workspaceName?.message ?? 'Leave empty to use a personal workspace or accept pending invites'} />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>Create account</Button>
      </form>
    </AuthLayout>
  );
}
