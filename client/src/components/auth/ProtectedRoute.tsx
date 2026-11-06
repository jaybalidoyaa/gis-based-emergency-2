import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore, isAdminRole, getRoleHomePath } from '@/store/authStore';

interface ProtectedRouteProps {
  allowedRoles?: string[];
  requireAdmin?: boolean;
}

export function ProtectedRoute({ allowedRoles, requireAdmin }: ProtectedRouteProps) {
  const { user, accessToken } = useAuthStore();

  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && !isAdminRole(user.role)) {
    return <Navigate to={getRoleHomePath(user.role)} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={getRoleHomePath(user.role)} replace />;
  }

  return <Outlet />;
}
