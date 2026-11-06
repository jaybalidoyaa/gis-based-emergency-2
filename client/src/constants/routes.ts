/**
 * Centralized route path constants for the application.
 * Use these instead of inline string literals to prevent typos and ease refactoring.
 */
export const ROUTES = {
  // Auth
  LOGIN: '/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',

  // Admin / Dispatcher
  ADMIN_DASHBOARD: '/admin/dashboard',
  ADMIN_DISPATCH: '/admin/dispatch',
  ADMIN_MAP: '/admin/map',
  ADMIN_INCIDENTS: '/admin/incidents',
  ADMIN_CONDUCTION: '/admin/conduction',
  ADMIN_SOS: '/admin/sos',
  ADMIN_NOTIFICATIONS: '/admin/notifications',
  ADMIN_REPORTS: '/admin/reports',
  ADMIN_ANALYTICS: '/admin/analytics',
  ADMIN_PERSONNEL: '/admin/personnel',
  ADMIN_ATTENDANCE: '/admin/attendance',
  ADMIN_SHIFTS: '/admin/shifts',
  ADMIN_RESOURCES: '/admin/resources',
  ADMIN_SETTINGS: '/admin/settings',

  // Citizen
  CITIZEN_HOME: '/citizen',
  CITIZEN_SOS: '/citizen/sos',
  CITIZEN_NOTIFICATIONS: '/citizen/notifications',
  CITIZEN_PROFILE: '/citizen/profile',

  // Responder
  RESPONDER_HOME: '/responder',
  RESPONDER_MAP: '/responder/map',
  RESPONDER_STATUS: '/responder/status',
  RESPONDER_NOTIFICATIONS: '/responder/notifications',
  RESPONDER_PROFILE: '/responder/profile',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
