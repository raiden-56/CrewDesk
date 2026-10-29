import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuthStore } from '@/store/auth';
import { fetchMe } from '@/lib/queries';
import { ApiClientError } from '@/lib/api';
import { GUEST_MODE_AVAILABLE } from '@/guest/session';
import { ErrorState } from '@/components/common/States';
import { AppShell } from '@/layout/AppShell';
import { ShimmerPage } from '@/components/shimmer';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth/PasswordPages';

const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const AgentsPage = lazy(() => import('@/pages/agents/AgentsPage').then((m) => ({ default: m.AgentsPage })));
const AgentDetailPage = lazy(() => import('@/pages/agents/AgentDetailPage').then((m) => ({ default: m.AgentDetailPage })));
const TasksPage = lazy(() => import('@/pages/tasks/TasksPage').then((m) => ({ default: m.TasksPage })));
const WorkflowsPage = lazy(() => import('@/pages/workflows/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })));
const WorkflowEditorPage = lazy(() => import('@/pages/workflows/WorkflowEditorPage').then((m) => ({ default: m.WorkflowEditorPage })));
const WorkflowExecutionPage = lazy(() => import('@/pages/workflows/WorkflowExecutionPage').then((m) => ({ default: m.WorkflowExecutionPage })));
const ToolsPage = lazy(() => import('@/pages/tools/ToolsPage').then((m) => ({ default: m.ToolsPage })));
const KnowledgePage = lazy(() => import('@/pages/knowledge/KnowledgePage').then((m) => ({ default: m.KnowledgePage })));
const FilesPage = lazy(() => import('@/pages/files/FilesPage').then((m) => ({ default: m.FilesPage })));
const ApprovalsPage = lazy(() => import('@/pages/approvals/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })));
const ActivityPage = lazy(() => import('@/pages/activity/ActivityPage').then((m) => ({ default: m.ActivityPage })));
const AnalyticsPage = lazy(() => import('@/pages/analytics/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const IntegrationsPage = lazy(() => import('@/pages/integrations/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'unknown') return <div className="p-6"><ShimmerPage /></div>;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const setSession = useAuthStore((s) => s.setSession);
  const setAnonymous = useAuthStore((s) => s.setAnonymous);
  const [bootError, setBootError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Only a 401 means "signed out"; a server or network failure must not drop a valid session.
    fetchMe()
      .then((me) => {
        setBootError(null);
        setSession(me.user, me.workspaces);
      })
      .catch((err) => {
        if (err instanceof ApiClientError && err.status === 401) setAnonymous();
        // Guest-capable builds (static hosting without an API): fall back to the login page, which offers guest mode.
        else if (GUEST_MODE_AVAILABLE) setAnonymous();
        else setBootError(err);
      });
  }, [setSession, setAnonymous, attempt]);

  if (bootError) {
    return (
      <div className="min-h-full flex items-center justify-center bg-bg p-6">
        <div className="cs-card w-full max-w-md">
          <ErrorState title="Cannot reach the server" error={bootError} onRetry={() => { setBootError(null); setAttempt((a) => a + 1); }} />
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Suspense fallback={<ShimmerPage />}>
                <Routes>
                  <Route index element={<DashboardPage />} />
                  <Route path="team" element={<AgentsPage />} />
                  <Route path="team/:id" element={<AgentDetailPage />} />
                  <Route path="tasks" element={<TasksPage />} />
                  <Route path="tasks/:id" element={<TasksPage />} />
                  <Route path="workflows" element={<WorkflowsPage />} />
                  <Route path="workflows/executions/:executionId" element={<WorkflowExecutionPage />} />
                  <Route path="workflows/:id" element={<WorkflowEditorPage />} />
                  <Route path="tools" element={<ToolsPage />} />
                  <Route path="knowledge" element={<KnowledgePage />} />
                  <Route path="files" element={<FilesPage />} />
                  <Route path="approvals" element={<ApprovalsPage />} />
                  <Route path="approvals/:id" element={<ApprovalsPage />} />
                  <Route path="activity" element={<ActivityPage />} />
                  <Route path="analytics" element={<AnalyticsPage />} />
                  <Route path="integrations" element={<IntegrationsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="settings/:tab" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
