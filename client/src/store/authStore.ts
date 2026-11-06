import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  lastActivity: number;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  touchActivity: () => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      lastActivity: Date.now(),
      setAuth: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken, lastActivity: Date.now() }),
      touchActivity: () => set({ lastActivity: Date.now() }),
      clearAuth: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'sv-dispatch-auth' }
  )
);

export function getRoleHomePath(role: string): string {
  switch (role) {
    case 'CITIZEN':
      return '/citizen';
    case 'EMERGENCY_RESPONDER':
      return '/responder';
    default:
      return '/admin/dashboard';
  }
}

export function isAdminRole(role: string): boolean {
  return ['SYSTEM_ADMINISTRATOR', 'CENTRAL_DISPATCHER', 'DEPARTMENT_DISPATCHER'].includes(role);
}
