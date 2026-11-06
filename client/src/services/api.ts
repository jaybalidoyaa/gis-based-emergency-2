import type { User, DashboardStats, Incident, MapData, SOSReport, Assignment, NotificationItem, NotificationTracking, PersonnelMember } from '@/types';
import { useAuthStore } from '@/store/authStore';

const API_URL = import.meta.env.VITE_API_URL || '/api';

interface ApiOptions extends RequestInit {
  token?: string | null;
  skipRefresh?: boolean;
  idempotencyKey?: string;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, user, setAuth, clearAuth } = useAuthStore.getState();
  if (!refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.data?.accessToken) {
        clearAuth();
        return null;
      }
      if (user) setAuth(user, data.data.accessToken, data.data.refreshToken);
      else useAuthStore.setState({ accessToken: data.data.accessToken, refreshToken: data.data.refreshToken });
      return data.data.accessToken as string;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function api<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { token, headers, skipRefresh, idempotencyKey, ...rest } = options;
  const authToken = token ?? useAuthStore.getState().accessToken;

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...headers,
    },
  });

  if (res.status === 401 && !skipRefresh && !endpoint.startsWith('/auth/login') && !endpoint.startsWith('/auth/refresh')) {
    const next = await refreshAccessToken();
    if (next) {
      return api<T>(endpoint, { ...options, token: next, skipRefresh: true });
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message ?? `Request failed (${res.status})`);
  }
  return data;
}

export const healthApi = {
  check: () => api<{ success: boolean; status: string; checks?: Record<string, string>; version?: string }>('/health', { skipRefresh: true }),
  dashboard: (token: string) =>
    api<{ success: boolean; data: { status: string; database?: string; map?: string; realtime?: string } }>('/dashboard/health', { token }),
};

export const authApi = {
  login: (email: string, password: string) =>
    api<{ success: boolean; data: { user: User; accessToken: string; refreshToken: string } }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }), skipRefresh: true }
    ),
  register: (payload: Record<string, unknown>) =>
    api<{ success: boolean; data: { user: User; accessToken: string; refreshToken: string } }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify(payload), skipRefresh: true }
    ),
  forgotPassword: (email: string) =>
    api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }), skipRefresh: true }),
  resetPassword: (email: string, token: string, password: string) =>
    api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, token, password }), skipRefresh: true }),
  me: (token: string) => api<{ success: boolean; data: User }>('/auth/me', { token }),
  logout: (token: string) => api('/auth/logout', { method: 'POST', token }),
};

export const profileApi = {
  get: (token: string) => api<{ success: boolean; data: Record<string, unknown> }>('/profile', { token }),
  update: (token: string, body: Record<string, unknown>) =>
    api('/profile', { method: 'PATCH', token, body: JSON.stringify(body) }),
  requestDelete: (token: string) => api('/profile/delete-request', { method: 'POST', token }),
};

export const dashboardApi = {
  stats: (token: string) =>
    api<{ success: boolean; data: DashboardStats }>('/dashboard/stats', { token }),
};

export const eventsApi = {
  poll: (token: string, since: string) =>
    api<{ success: boolean; data: { serverTime: string; incidents: unknown[]; notifications: unknown[] } }>(
      `/events?since=${encodeURIComponent(since)}`,
      { token }
    ),
};

export const incidentsApi = {
  list: (token: string, params?: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    return api<{ success: boolean; data: { incidents: Incident[]; total: number } }>(`/incidents?${q}`, { token });
  },
  get: (token: string, id: string) =>
    api<{ success: boolean; data: Incident }>(`/incidents/${id}`, { token }),
  create: (token: string, body: Record<string, unknown>, idempotencyKey?: string) =>
    api<{ success: boolean; data: { _id: string; displayId: string; duplicates: unknown[] } }>('/incidents', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
      idempotencyKey,
    }),
  verify: (token: string, id: string, body: Record<string, string>) =>
    api(`/incidents/${id}/verify`, { method: 'POST', token, body: JSON.stringify(body) }),
  falseAlarm: (token: string, id: string, reason?: string) =>
    api(`/incidents/${id}/false-alarm`, { method: 'POST', token, body: JSON.stringify({ reason }) }),
  reopen: (token: string, id: string, reason: string) =>
    api(`/incidents/${id}/reopen`, { method: 'POST', token, body: JSON.stringify({ reason }) }),
  cancel: (token: string, id: string, reason: string) =>
    api(`/incidents/${id}/cancel`, { method: 'POST', token, body: JSON.stringify({ reason }) }),
  merge: (token: string, id: string, sourceIncidentId: string, reason?: string) =>
    api(`/incidents/${id}/merge`, { method: 'POST', token, body: JSON.stringify({ sourceIncidentId, reason }) }),
  assign: (token: string, id: string, responderId: string, vehicleId?: string) =>
    api(`/incidents/${id}/assign`, {
      method: 'POST',
      token,
      body: JSON.stringify({ responderId, vehicleId }),
    }),
  assignMany: (token: string, id: string, body: Record<string, unknown>, idempotencyKey?: string) =>
    api(`/incidents/${id}/assign-many`, { method: 'POST', token, body: JSON.stringify(body), idempotencyKey }),
  status: (token: string, id: string, status: string) =>
    api(`/incidents/${id}/status`, { method: 'POST', token, body: JSON.stringify({ status }) }),
  update: (token: string, id: string, body: Record<string, unknown>) =>
    api<{ success: boolean; data: { updated: boolean; changes?: string[] } }>(`/incidents/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(body),
    }),
  nearbyUnits: (token: string, id: string) =>
    api<{ success: boolean; data: unknown[] }>(`/incidents/${id}/nearby-units`, { token }),
  timeline: (token: string, id: string) =>
    api<{ success: boolean; data: unknown[] }>(`/incidents/${id}/timeline`, { token }),
  types: (token: string) =>
    api<{ success: boolean; data: { _id: string; typeName: string }[] }>('/incidents/types', { token }),
};

export type MediaAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes?: number;
  caption?: string | null;
  createdAt?: string;
  url?: string;
};

export const mediaApi = {
  list: (token: string, incidentId: string) =>
    api<{ success: boolean; data: MediaAttachment[] }>(`/incidents/${incidentId}/media`, { token }),
  upload: async (token: string, incidentId: string, file: File, caption?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('incidentId', incidentId);
    if (caption) fd.append('caption', caption);
    const res = await fetch(`${API_URL}/media/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { message?: string }).message || 'Upload failed');
    return data as { success: boolean; data: MediaAttachment & { id: string } };
  },
  remove: (token: string, id: string) => api(`/media/${id}`, { method: 'DELETE', token }),
  fetchBlobUrl: async (token: string, id: string) => {
    const res = await fetch(`${API_URL}/media/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Could not load media');
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};

export const sosApi = {
  types: () => api<{ success: boolean; data: { _id: string; typeName: string }[] }>('/sos/types'),
  create: (token: string, body: Record<string, unknown>, opts?: { idempotencyKey?: string }) =>
    api<{ success: boolean; data: { sos: { _id?: string; displayId: string }; incident: { _id: string; displayId: string } } }>(
      '/sos',
      {
        method: 'POST',
        token,
        body: JSON.stringify(body),
        idempotencyKey: opts?.idempotencyKey ?? crypto.randomUUID(),
      }
    ),
  list: (token: string, status?: string) =>
    api<{ success: boolean; data: SOSReport[] }>(`/sos${status ? `?status=${status}` : ''}`, { token }),
  myStatus: (token: string) =>
    api<{ success: boolean; data: SOSReport | null }>('/sos/my-status', { token }),
  cancel: (token: string, id: string, reason: string) =>
    api(`/sos/${id}/cancel`, { method: 'POST', token, body: JSON.stringify({ reason }) }),
  reopen: (token: string, id: string, reason: string) =>
    api(`/sos/${id}/reopen`, { method: 'POST', token, body: JSON.stringify({ reason }) }),
  update: (token: string, id: string, description: string) =>
    api(`/sos/${id}/update`, { method: 'POST', token, body: JSON.stringify({ description }) }),
};

export const respondersApi = {
  dispatchQueue: (token: string) =>
    api<{ success: boolean; data: { incidents: Incident[]; pendingSos: number; unitsReady: number } }>(
      '/responders/dispatch-queue',
      { token }
    ),
  list: (token: string) => api<{ success: boolean; data: unknown[] }>('/responders', { token }),
  me: (token: string) => api<{ success: boolean; data: Record<string, unknown> }>('/responders/me', { token }),
  available: (token: string) => api<{ success: boolean; data: unknown[] }>('/responders/available', { token }),
  myAssignments: (token: string) =>
    api<{ success: boolean; data: Assignment[] }>('/responders/assignments/mine', { token }),
  accept: (token: string, id: string) =>
    api(`/responders/assignments/${id}/accept`, { method: 'POST', token }),
  decline: (token: string, id: string, reason: string) =>
    api(`/responders/assignments/${id}/decline`, { method: 'POST', token, body: JSON.stringify({ reason }) }),
  backup: (token: string, id: string, note?: string) =>
    api(`/responders/assignments/${id}/backup`, { method: 'POST', token, body: JSON.stringify({ note }) }),
  assignmentStatus: (token: string, id: string, status: string) =>
    api(`/responders/assignments/${id}/status`, { method: 'POST', token, body: JSON.stringify({ status }) }),
  updateStatus: (token: string, status: string, reason?: string) =>
    api('/responders/me/status', { method: 'PATCH', token, body: JSON.stringify({ status, reason }) }),
  updateLocation: (token: string, lat: number, lng: number, accuracy?: number) =>
    api('/responders/me/location', {
      method: 'POST',
      token,
      body: JSON.stringify({ latitude: lat, longitude: lng, accuracy }),
    }),
  requestTeamChange: (token: string, teamName: string, reason: string) =>
    api('/responders/me/team-change', {
      method: 'POST',
      token,
      body: JSON.stringify({ teamName, reason }),
    }),
  requestUnitChange: (token: string, vehicleId: string, reason: string) =>
    api('/responders/me/unit-change', {
      method: 'POST',
      token,
      body: JSON.stringify({ vehicleId, reason }),
    }),
  listUnits: (token: string) =>
    api<{
      success: boolean;
      data: Array<{ id: string; unitNo: string; vehicleType?: string; status?: string }>;
    }>('/responders/me/units', { token }),
  patientReport: (token: string, assignmentId: string, body: Record<string, unknown>) =>
    api(`/responders/assignments/${assignmentId}/patient-report`, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),
};

export const unitChangeApi = {
  list: (token: string, status = 'Pending') =>
    api<{ success: boolean; data: UnitChangeRequest[] }>(
      `/unit-change-requests?status=${encodeURIComponent(status)}`,
      { token }
    ),
  decide: (token: string, id: string, decision: 'approve' | 'deny', note?: string) =>
    api(`/unit-change-requests/${id}/decide`, {
      method: 'POST',
      token,
      body: JSON.stringify({ decision, note }),
    }),
};

export type UnitChangeRequest = {
  id: string;
  requestType?: 'team' | 'unit' | string;
  fromTeam?: string;
  toTeam?: string;
  fromVehicleId?: string;
  toVehicleId?: string;
  fromUnitLabel?: string;
  toUnitLabel?: string;
  reason?: string;
  status: string;
  createdAt?: string;
  callsign?: string;
  fullName?: string;
  responderId?: string;
};

export const mapApi = {
  data: (token: string) => api<{ success: boolean; data: MapData }>('/map/data', { token }),
  fleet: (token: string) =>
    api<{
      success: boolean;
      data: {
        units: Array<{
          _id: string;
          gpsStale?: boolean;
          currentLocation?: { latitude: number; longitude: number; updatedAt?: string };
        }>;
        responders: Array<{
          _id: string;
          gpsStale?: boolean;
          currentLocation?: { latitude: number; longitude: number; updatedAt?: string };
        }>;
        serverTime: string;
      };
    }>('/map/fleet', { token }),
};

export const transportsApi = {
  list: (token: string) => api<{ success: boolean; data: unknown[] }>('/transports', { token }),
  create: (token: string, body: Record<string, unknown>) =>
    api('/transports', { method: 'POST', token, body: JSON.stringify(body) }),
  update: (token: string, id: string, body: Record<string, unknown>) =>
    api(`/transports/${id}`, { method: 'PATCH', token, body: JSON.stringify(body) }),
};

export const notificationsApi = {
  list: (token: string) =>
    api<{ success: boolean; data: NotificationItem[] }>('/notifications', { token }),
  markRead: (token: string, id: string) =>
    api(`/notifications/${id}/read`, { method: 'PATCH', token }),
  markAllRead: (token: string) => api('/notifications/read-all', { method: 'POST', token }),
  remove: (token: string, id: string) =>
    api(`/notifications/${id}`, { method: 'DELETE', token }),
  notifyTeam: (token: string, body: { incidentId: string; message: string; title?: string }) =>
    api<{ success: boolean; data: { sent: number; recipients: string[] } }>('/notifications/dispatch-team', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),
  broadcast: (
    token: string,
    body: {
      title: string;
      message: string;
      audience: 'ALL' | 'RESPONDERS' | 'CITIZENS' | 'DISPATCHERS';
      kind: 'Immediate' | 'Alert' | 'Announcement' | 'System' | 'Scheduled';
      priority?: 'Critical' | 'Urgent' | 'Important' | 'Normal' | 'Info';
      incidentId?: string;
    }
  ) =>
    api<{
      success: boolean;
      data: {
        sent: number;
        pushed: number;
        batchId: string;
        audience: string;
        kind: string;
        type: string;
        priority: string;
      };
    }>('/notifications/broadcast', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),
  tracking: (token: string, id: string) =>
    api<{ success: boolean; data: NotificationTracking }>(`/notifications/${id}/tracking`, { token }),
  reply: (token: string, id: string, message: string) =>
    api(`/notifications/${id}/reply`, { method: 'POST', token, body: JSON.stringify({ message }) }),
  pushPublicKey: (token: string) =>
    api<{ success: boolean; publicKey: string | null }>('/push/vapid-public-key', { token }),
  pushSubscribe: (
    token: string,
    body: { endpoint: string; keys: { p256dh: string; auth: string } }
  ) => api('/push/subscribe', { method: 'POST', token, body: JSON.stringify(body) }),
  pushUnsubscribe: (token: string, endpoint: string) =>
    api('/push/unsubscribe', { method: 'POST', token, body: JSON.stringify({ endpoint }) }),
};

export const reportsApi = {
  list: (token: string, params?: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    return api<{ success: boolean; data: Incident[] }>(`/reports?${q}`, { token });
  },
  library: (token: string) =>
    api<{
      success: boolean;
      data: {
        documents: Array<{
          id: string;
          kind: 'report' | 'media';
          name: string;
          category: string;
          fileType: string;
          uploadedBy: string;
          uploaderRole: string;
          dateUploaded: string;
          sizeBytes: number;
          status: string;
          incidentId?: string;
          incidentDisplayId?: string;
          mediaId?: string;
          downloadable?: boolean;
          reportType?: string;
        }>;
        stats: {
          libraryItems: number;
          totalDocuments?: number;
          reportsGenerated: number;
          uploadedMedia?: number;
          pendingApproval: number;
          totalDownloads: number | null;
          storageBytes: number;
          storageQuotaBytes: number;
        };
        byCategory: Record<string, number>;
        byFileType: Record<string, number>;
      };
    }>('/reports/library', { token }),
  exportCsv: async (token: string) => {
    const res = await fetch(`${API_URL}/reports/export?format=csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(err.message || 'No records available to export');
    }
    return res.blob();
  },
  exportPdf: async (token: string, params?: { reportType?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams({ format: 'pdf' });
    if (params?.reportType) q.set('reportType', params.reportType);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const res = await fetch(`${API_URL}/reports/export?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(err.message || 'No records available to export');
    }
    return res.blob();
  },
  exportXlsx: async (token: string) => {
    const res = await fetch(`${API_URL}/reports/export?format=xlsx`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(err.message || 'No records available to export');
    }
    return res.blob();
  },
};

export const analyticsApi = {
  get: (token: string, params?: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    return api<{ success: boolean; data: Record<string, unknown> }>(`/analytics?${q}`, { token });
  },
};

export const personnelApi = {
  list: (token: string) => api<{ success: boolean; data: { users: PersonnelMember[]; responders: PersonnelMember[] } }>('/personnel', { token }),
  create: (token: string, body: Record<string, unknown>) =>
    api('/personnel', { method: 'POST', token, body: JSON.stringify(body) }),
  update: (token: string, id: string, body: Record<string, unknown>) =>
    api(`/personnel/${id}`, { method: 'PATCH', token, body: JSON.stringify(body) }),
};

export const trainingApi = {
  list: (token: string) =>
    api<{
      success: boolean;
      data: Array<{
        id: string;
        responderId?: string;
        trainingName: string;
        completedAt?: string;
        expiresAt?: string;
        certificationStatus?: string;
        callsign?: string;
        fullName?: string;
      }>;
    }>('/training', { token }),
  create: (token: string, body: Record<string, unknown>) =>
    api('/training', { method: 'POST', token, body: JSON.stringify(body) }),
};

export type AttendanceRecord = {
  _id?: string;
  responderId?: string;
  userId?: string;
  date: string;
  checkInTime?: string;
  checkOutTime?: string;
  status: string;
  remarks?: string;
  leaveType?: string;
  callsign?: string;
  teamName?: string;
  fullName?: string;
  departmentName?: string;
  departmentCode?: string;
};

export type LeaveRequest = {
  id: string;
  responderId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
  reason?: string;
  createdAt?: string;
  callsign?: string;
  fullName?: string;
  departmentName?: string;
};

export const attendanceApi = {
  list: (token: string, date?: string) => {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    return api<{ success: boolean; data: AttendanceRecord[] }>(`/attendance${q}`, { token });
  },
  create: (token: string, body: Record<string, unknown>) =>
    api('/attendance', { method: 'POST', token, body: JSON.stringify(body) }),
  update: (token: string, id: string, body: Record<string, unknown>) =>
    api(`/attendance/${id}`, { method: 'PATCH', token, body: JSON.stringify(body) }),
  checkIn: (token: string) => api('/attendance/check-in', { method: 'POST', token }),
  checkOut: (token: string) => api('/attendance/check-out', { method: 'POST', token }),
};

export const leaveApi = {
  list: (token: string) => api<{ success: boolean; data: LeaveRequest[] }>('/leave-requests', { token }),
  create: (token: string, body: Record<string, unknown>) =>
    api('/leave-requests', { method: 'POST', token, body: JSON.stringify(body) }),
  update: (token: string, id: string, body: Record<string, unknown>) =>
    api(`/leave-requests/${id}`, { method: 'PATCH', token, body: JSON.stringify(body) }),
};

export type ShiftAssignedPerson = {
  responderId: string;
  fullName: string;
  callsign?: string;
  role?: string;
  status?: string;
  lat?: number;
  lng?: number;
};

export type ShiftRow = {
  id: string;
  teamName: string;
  startTime: string;
  endTime: string;
  shiftStatus: string;
  storedStatus?: string;
  scheduledDate?: string;
  personnelCount?: number;
  departmentName?: string;
  shiftLead?: string;
  location?: string;
  assignedPersonnel?: ShiftAssignedPerson[];
};

export const shiftsApi = {
  list: (token: string) => api<{ success: boolean; data: ShiftRow[] }>('/shifts', { token }),
  create: (token: string, body: Record<string, unknown>) =>
    api('/shifts', { method: 'POST', token, body: JSON.stringify(body) }),
  update: (token: string, id: string, body: Record<string, unknown>) =>
    api(`/shifts/${id}`, { method: 'PATCH', token, body: JSON.stringify(body) }),
  remove: (token: string, id: string) => api(`/shifts/${id}`, { method: 'DELETE', token }),
};

export const resourcesApi = {
  vehicles: (token: string) => api<{ success: boolean; data: unknown[]; meta?: { unitsReady: number } }>('/resources/vehicles', { token }),
  equipment: (token: string) => api<{ success: boolean; data: unknown[] }>('/resources/equipment', { token }),
  createVehicle: (token: string, body: Record<string, unknown>) =>
    api('/resources/vehicles', { method: 'POST', token, body: JSON.stringify(body) }),
  updateVehicle: (token: string, id: string, body: Record<string, unknown>) =>
    api(`/resources/vehicles/${id}`, { method: 'PATCH', token, body: JSON.stringify(body) }),
  createEquipment: (token: string, body: Record<string, unknown>) =>
    api('/resources/equipment', { method: 'POST', token, body: JSON.stringify(body) }),
  updateEquipment: (token: string, id: string, body: Record<string, unknown>) =>
    api(`/resources/equipment/${id}`, { method: 'PATCH', token, body: JSON.stringify(body) }),
  checklist: (token: string, body: Record<string, unknown>) =>
    api('/resources/checklists', { method: 'POST', token, body: JSON.stringify(body) }),
};

export const settingsApi = {
  get: (token: string) =>
    api<{
      success: boolean;
      data: {
        settings: Record<string, string>;
        departments: { id?: string; name: string; code: string }[];
        roles: { name: string }[];
      };
    }>('/settings', { token }),
  update: (token: string, settings: Record<string, string | boolean | number>) =>
    api<{ success: boolean; data: { settings: Record<string, string> } }>('/settings', {
      method: 'PATCH',
      token,
      body: JSON.stringify({ settings }),
    }),
  auditLogs: (token: string) => api<{ success: boolean; data: unknown[] }>('/settings/audit-logs', { token }),
  createDepartment: (token: string, body: Record<string, unknown>) =>
    api('/departments', { method: 'POST', token, body: JSON.stringify(body) }),
  resetStatus: (token: string) =>
    api<{ success: boolean; data: unknown }>('/settings/reset-status', {
      method: 'POST',
      token,
      body: JSON.stringify({ confirm: 'RESET STATUS' }),
    }),
  resetData: (token: string) =>
    api<{ success: boolean; data: unknown }>('/settings/reset-data', {
      method: 'POST',
      token,
      body: JSON.stringify({ confirm: 'RESET ALL DATA' }),
    }),
  ensureOpsAccounts: (token: string) =>
    api<{
      success: boolean;
      data: {
        created: string[];
        updated: string[];
        accounts: { email: string; role: string; fullName: string }[];
        defaultPasswordHint: string | null;
      };
    }>('/settings/ensure-ops-accounts', { method: 'POST', token, body: '{}' }),
};

export const chatApi = {
  messages: (token: string, incidentId: string) =>
    api<{ success: boolean; data: unknown[] }>(`/chat/incident/${incidentId}`, { token }),
  send: (token: string, incidentId: string, message: string) =>
    api(`/chat/incident/${incidentId}`, { method: 'POST', token, body: JSON.stringify({ message }) }),
  respondersMessages: (token: string) =>
    api<{ success: boolean; data: unknown[] }>('/chat/responders', { token }),
  sendResponders: (token: string, message: string) =>
    api('/chat/responders', { method: 'POST', token, body: JSON.stringify({ message }) }),
};
