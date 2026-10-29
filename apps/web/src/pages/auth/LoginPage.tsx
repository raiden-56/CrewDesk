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
import { Compass } from "lucide-react";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { GUEST_MODE_AVAILABLE, startGuestSession } from "@/guest/session";
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
      // Static demo hosting has no API: point people at guest mode instead of a raw HTTP error.
      const unreachable =
        !(err instanceof ApiClientError) || err.code === "HTTP_ERROR";
      setError(
        GUEST_MODE_AVAILABLE && unreachable
          ? "The server is not reachable from this demo. Continue as guest to explore with sample data."
          : errorMessage(err),
      );
    }
  };

  const continueAsGuest = () => {
    const { user, workspaces } = startGuestSession();
    setSession(user, workspaces);
    navigate("/", { replace: true });
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
        {GUEST_MODE_AVAILABLE && (
          <>
            <div className="flex items-center gap-2 text-[11.5px] text-text-3">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outlined"
              size="large"
              startIcon={<Compass size={17} />}
              onClick={continueAsGuest}
              data-testid="login-guest"
            >
              Continue as guest
            </Button>
            <p className="text-[12px] text-text-3 text-center -mt-1">
              Explore a sample workspace. No account or server needed.
            </p>
          </>
        )}
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
