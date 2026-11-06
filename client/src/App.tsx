import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useAuthStore, getRoleHomePath } from '@/store/authStore';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { AdminLayout } from '@/layouts/AdminLayout';
import { CitizenLayout } from '@/layouts/CitizenLayout';
import { ResponderLayout } from '@/layouts/ResponderLayout';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { DashboardPage } from '@/pages/admin/DashboardPage';
import { DispatchPage } from '@/pages/admin/DispatchPage';
import { IncidentsPage } from '@/pages/admin/IncidentsPage';
import { MapMonitoringPage } from '@/pages/admin/MapMonitoringPage';
import { AnalyticsPage } from '@/pages/admin/AnalyticsPage';
import { SOSReportsPage } from '@/pages/admin/SOSReportsPage';
import { NotificationsPage } from '@/pages/admin/NotificationsPage';
import { ConductionPage } from '@/pages/admin/ConductionPage';
import { ReportsPage } from '@/pages/admin/ReportsPage';
import { PersonnelPage } from '@/pages/admin/PersonnelPage';
import { AttendancePage } from '@/pages/admin/AttendancePage';
import { ShiftsPage } from '@/pages/admin/ShiftsPage';
import {
  ResourcesPage,
  SettingsPage,
} from '@/pages/admin/AdminModules';
import { CitizenHomePage, CitizenNotificationsPage, CitizenProfilePage } from '@/pages/citizen/CitizenPages';
import { CitizenSOSPage } from '@/pages/citizen/CitizenSOSPage';
import {
  ResponderHomePage,
  ResponderStatusPage,
  ResponderNotificationsPage,
  ResponderProfilePage,
  ResponderChatPage,
  ResponderMapPage,
} from '@/pages/responder/ResponderPages';
import { LIVE } from '@/lib/liveTiming';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: LIVE.staleMs,
    },
  },
});

const INACTIVITY_MS = 8 * 60 * 60 * 1000;

function InactivityGuard() {
  const { accessToken, lastActivity, touchActivity, clearAuth } = useAuthStore();
  useEffect(() => {
    if (!accessToken) return;
    const bump = () => touchActivity();
    window.addEventListener('click', bump);
    window.addEventListener('keydown', bump);
    const id = window.setInterval(() => {
      const last = useAuthStore.getState().lastActivity;
      if (Date.now() - last > INACTIVITY_MS) {
        clearAuth();
        window.location.href = '/login';
      }
    }, 60000);
    return () => {
      window.removeEventListener('click', bump);
      window.removeEventListener('keydown', bump);
      window.clearInterval(id);
    };
  }, [accessToken, touchActivity, clearAuth, lastActivity]);
  return null;
}

function RootRedirect() {
  const { user, accessToken } = useAuthStore();
  if (!accessToken || !user) return <Navigate to="/login" replace />;
  return <Navigate to={getRoleHomePath(user.role)} replace />;
}

function LoginGuard({ children }: { children: React.ReactNode }) {
  const { user, accessToken } = useAuthStore();
  if (accessToken && user) return <Navigate to={getRoleHomePath(user.role)} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster theme="dark" position="top-right" richColors />
      <OfflineBanner />
      <InactivityGuard />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginGuard><LoginPage /></LoginGuard>} />
          <Route path="/register" element={<LoginGuard><RegisterPage /></LoginGuard>} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route element={<ProtectedRoute requireAdmin />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="dispatch" element={<DispatchPage />} />
              <Route path="map" element={<MapMonitoringPage />} />
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="incidents/:incidentId" element={<IncidentsPage />} />
              <Route path="conduction" element={<ConductionPage />} />
              <Route path="sos" element={<SOSReportsPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="personnel" element={<PersonnelPage />} />
              <Route path="attendance" element={<AttendancePage />} />
              <Route path="shifts" element={<ShiftsPage />} />
              <Route path="resources" element={<ResourcesPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['CITIZEN']} />}>
            <Route path="/citizen" element={<CitizenLayout />}>
              <Route index element={<CitizenHomePage />} />
              <Route path="sos" element={<CitizenSOSPage />} />
              <Route path="notifications" element={<CitizenNotificationsPage />} />
              <Route path="profile" element={<CitizenProfilePage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['EMERGENCY_RESPONDER']} />}>
            <Route path="/responder" element={<ResponderLayout />}>
              <Route index element={<ResponderHomePage />} />
              <Route path="map" element={<ResponderMapPage />} />
              <Route path="chat" element={<ResponderChatPage />} />
              <Route path="status" element={<ResponderStatusPage />} />
              <Route path="notifications" element={<ResponderNotificationsPage />} />
              <Route path="profile" element={<ResponderProfilePage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
