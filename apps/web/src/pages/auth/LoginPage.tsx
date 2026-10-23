import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, TextField } from "@mui/material";
import {
  LoginSchema,
  type UserDto,
  type WorkspaceDto,
} from "@collabspace/shared";
import type { z } from "zod";
import { api, errorMessage } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { AuthLayout } from "./AuthLayout";

type Form = z.infer<typeof LoginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: Form) => {
    setError(null);
    try {
      const res = await api.post<{ user: UserDto; workspaces: WorkspaceDto[] }>(
        "/auth/login",
        values,
      );
      setSession(res.user, res.workspaces);
      navigate((location.state as { from?: string } | null)?.from ?? "/", {
        replace: true,
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to manage your AI team."
      footer={
        <span>
          No account?{" "}
          <Link to="/register" className="text-accent font-medium">
            Create one
          </Link>
        </span>
      }
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-3"
        noValidate
      >
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          {...register("email")}
          error={Boolean(formState.errors.email)}
          helperText={formState.errors.email?.message}
          inputProps={{ "data-testid": "login-email" }}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
          error={Boolean(formState.errors.password)}
          helperText={formState.errors.password?.message}
          inputProps={{ "data-testid": "login-password" }}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={formState.isSubmitting}
          data-testid="login-submit"
        >
          Sign in
        </Button>
        <Link
          to="/forgot-password"
          className="text-[12.5px] text-text-3 text-center hover:text-text"
        >
          Forgot your password?
        </Link>
      </form>
    </AuthLayout>
  );
}
