import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  Plus,
  Search,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { reportsApi, mediaApi, incidentsApi } from '@/services/api';
import { LIVE } from '@/lib/liveTiming';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QueryState } from '@/components/ui/QueryState';
import { FreshnessLine, liveSyncToFreshness } from '@/components/ui/FreshnessLine';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAdminLiveSync } from '@/hooks/LiveSyncContext';
import { formatRole } from '@/lib/incidentState';
import { formatManilaDate } from '@/lib/timezone';
import clsx from 'clsx';

type TabId = 'Documents' | 'Reports' | 'Templates' | 'Archived';

type LibraryDoc = {
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
};

const TABS: TabId[] = ['Documents', 'Reports', 'Templates', 'Archived'];

const FOLDERS: { id: string; label: string; tone: string }[] = [
  { id: 'Incident Reports', label: 'Incident Reports', tone: 'text-[#60a5fa] bg-[#3b82f6]/15' },
  { id: 'Daily Dispatch Logs', label: 'Daily Dispatch Logs', tone: 'text-ok-400 bg-ok-500/15' },
  { id: 'Situation Reports', label: 'Situation Reports', tone: 'text-gold-400 bg-gold-500/15' },
  { id: 'Resource Inventory', label: 'Resource Inventory', tone: 'text-[#c084fc] bg-purple-500/15' },
  { id: 'Damage Assessment', label: 'Damage Assessment', tone: 'text-alert-400 bg-alert-500/15' },
  { id: 'Training & Drills', label: 'Training & Drills', tone: 'text-[#f472b6] bg-pink-500/15' },
  { id: 'Memorandums', label: 'Memorandums', tone: 'text-[#fb923c] bg-orange-500/15' },
  { id: 'Operational Checklists', label: 'Operational Checklists', tone: 'text-teal-300 bg-teal-500/15' },
];

const QUICK_REPORTS: {
  id: string;
  title: string;
  description: string;
  reportType: string;
  tone: string;
  Icon: LucideIcon;
}[] = [
  {
    id: 'incident-summary',
    title: 'Incident Summary',
    description: 'All incidents in range with status and priority',
    reportType: 'incident-summary',
    tone: 'bg-[#2563eb] hover:bg-[#3b82f6]',
    Icon: FileText,
  },
  {
    id: 'response-time',
    title: 'Response Time',
    description: 'Dispatch-to-arrival timing analysis',
    reportType: 'response-time',
    tone: 'bg-ok-600 hover:bg-ok-500',
    Icon: Clock3,
  },
  {
    id: 'unit-activity',
    title: 'Responder Activity',
    description: 'Unit utilization and assignment load',
    reportType: 'unit-activity',
    tone: 'bg-gold-600 hover:bg-gold-500',
    Icon: FileSpreadsheet,
  },
  {
    id: 'checklist',
    title: 'Resource Utilization',
    description: 'Vehicles and equipment readiness',
    reportType: 'checklist',
    tone: 'bg-purple-700 hover:bg-purple-600',
    Icon: Folder,
  },
  {
    id: 'monthly-ops',
    title: 'Monthly Overview',
    description: 'Operations summary for the current month',
    reportType: 'monthly-ops',
    tone: 'bg-teal-700 hover:bg-teal-600',
    Icon: Cloud,
  },
];

/** Full PDF template catalog (Templates tab + generate dialog). */
const REPORT_TEMPLATES: {
  id: string;
  title: string;
  description: string;
  reportType: string;
  category: string;
  tone: string;
  Icon: LucideIcon;
}[] = [
  ...QUICK_REPORTS.map((r) => ({
    ...r,
    category:
      r.reportType === 'checklist'
        ? 'Resource Inventory'
        : r.reportType === 'monthly-ops'
          ? 'Situation Reports'
          : 'Incident Reports',
  })),
  {
    id: 'attendance',
    title: 'Attendance Log',
    description: 'Duty attendance records for the selected range',
    reportType: 'attendance',
    category: 'Daily Dispatch Logs',
    tone: 'bg-navy-700 hover:bg-navy-600',
    Icon: FileText,
  },
  {
    id: 'personnel',
    title: 'Personnel Roster',
    description: 'Active users and responder profiles',
    reportType: 'personnel',
    category: 'Memorandums',
    tone: 'bg-navy-700 hover:bg-navy-600',
    Icon: FileSpreadsheet,
  },
  {
    id: 'shift',
    title: 'Shift Schedule',
    description: 'Shift assignments and coverage windows',
    reportType: 'shift',
    category: 'Daily Dispatch Logs',
    tone: 'bg-navy-700 hover:bg-navy-600',
    Icon: Clock3,
  },
  {
    id: 'audit',
    title: 'Audit Trail',
    description: 'Recent system actions for compliance review',
    reportType: 'audit',
    category: 'Memorandums',
    tone: 'bg-navy-700 hover:bg-navy-600',
    Icon: Folder,
  },
];

const PAGE_SIZE = 5;

function formatBytes(n: number) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileIcon(type: string) {
  switch (type) {
    case 'Excel':
      return FileSpreadsheet;
    case 'Image':
      return ImageIcon;
    default:
      return FileText;
  }
}

function fileTone(type: string) {
  switch (type) {
    case 'PDF':
      return 'bg-alert-500/20 text-alert-300';
    case 'Excel':
      return 'bg-ok-500/20 text-ok-300';
    case 'Word':
      return 'bg-[#3b82f6]/20 text-[#93c5fd]';
    case 'Image':
      return 'bg-gold-500/20 text-gold-300';
    default:
      return 'bg-purple-500/20 text-purple-300';
  }
}

function categoryTone(cat: string) {
  return FOLDERS.find((f) => f.id === cat)?.tone || 'bg-navy-800 text-ink-300';
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

export function ReportsPage() {
  const { accessToken } = useAuthStore();
  const live = useAdminLiveSync();

  const [tab, setTab] = useState<TabId>('Documents');
  const [folder, setFolder] = useState<string>('All');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [docType, setDocType] = useState('All');
  const [uploader, setUploader] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [uploadIncidentId, setUploadIncidentId] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const libraryQuery = useQuery({
    queryKey: ['reports-library'],
    queryFn: () => reportsApi.library(accessToken!),
    enabled: !!accessToken,
    refetchInterval: LIVE.coolMs,
  });

  const incidentsQuery = useQuery({
    queryKey: ['incidents-brief'],
    queryFn: () => incidentsApi.list(accessToken!),
    enabled: !!accessToken && uploadOpen,
  });

  const library = libraryQuery.data?.data;
  const docs = library?.documents ?? [];
  const stats = library?.stats;
  const byFileType = library?.byFileType ?? {};
  const byCategory = library?.byCategory ?? {};

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      if (tab === 'Reports' && d.kind !== 'report') return false;
      if (tab === 'Archived' && !/closed|resolved|cancelled|completed/i.test(d.status)) return false;
      if (tab === 'Templates') return false;
      if (folder !== 'All' && d.category !== folder) return false;
      if (category !== 'All' && d.category !== category) return false;
      if (docType !== 'All' && d.fileType !== docType) return false;
      if (uploader !== 'All' && d.uploadedBy !== uploader) return false;
      if (dateFrom && d.dateUploaded.slice(0, 10) < dateFrom) return false;
      if (dateTo && d.dateUploaded.slice(0, 10) > dateTo) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!`${d.name} ${d.uploadedBy} ${d.incidentDisplayId ?? ''} ${d.category}`.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [docs, tab, folder, category, docType, uploader, dateFrom, dateTo, search]);

  const filteredTemplates = useMemo(() => {
    return REPORT_TEMPLATES.filter((t) => {
      if (folder !== 'All' && t.category !== folder) return false;
      if (category !== 'All' && t.category !== category) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!`${t.title} ${t.description} ${t.reportType} ${t.category}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [folder, category, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [tab, folder, category, docType, uploader, dateFrom, dateTo, search]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);

  const uploaders = useMemo(
    () => [...new Set(docs.map((d) => d.uploadedBy).filter(Boolean))].sort(),
    [docs]
  );

  const storagePct = stats?.storageQuotaBytes
    ? Math.min(100, Math.round(((stats.storageBytes || 0) / stats.storageQuotaBytes) * 1000) / 10)
    : 0;

  const typeBreakdown = useMemo(() => {
    const total = Object.values(byFileType).reduce((a, b) => a + b, 0) || 1;
    const colors: Record<string, string> = {
      PDF: '#ef4444',
      Excel: '#22c55e',
      Word: '#3b82f6',
      Image: '#f59e0b',
      Other: '#a855f7',
    };
    const entries = ['PDF', 'Excel', 'Word', 'Image', 'Other'].map((k) => ({
      key: k,
      count: byFileType[k] || 0,
      pct: Math.round(((byFileType[k] || 0) / total) * 1000) / 10,
      color: colors[k],
    }));
    let cursor = 0;
    const stops = entries
      .filter((e) => e.count > 0)
      .map((e) => {
        const start = cursor;
        cursor += (e.count / total) * 100;
        return `${e.color} ${start}% ${cursor}%`;
      });
    return {
      entries,
      gradient: stops.length ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(#1e293b 0% 100%)',
    };
  }, [byFileType]);

  async function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function generateReport(reportType: string, label: string) {
    if (!accessToken) return;
    setBusyId(reportType);
    try {
      const blob = await reportsApi.exportPdf(accessToken, {
        reportType,
        ...(dateFrom ? { from: dateFrom } : {}),
        ...(dateTo ? { to: dateTo } : {}),
      });
      await downloadBlob(blob, `${reportType}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success(`${label} downloaded`);
      setGenerateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Report generation failed');
    } finally {
      setBusyId(null);
    }
  }

  async function openDocument(doc: LibraryDoc) {
    if (!accessToken) return;
    setBusyId(doc.id);
    try {
      if (doc.kind === 'media' && doc.mediaId) {
        const url = await mediaApi.fetchBlobUrl(accessToken, doc.mediaId);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.name;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Download started');
      } else {
        const blob = await reportsApi.exportPdf(accessToken, {
          reportType: doc.reportType || 'incident',
        });
        await downloadBlob(blob, `${doc.incidentDisplayId || 'report'}.pdf`);
        toast.success('Report downloaded');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusyId(null);
    }
  }

  async function uploadDocument() {
    if (!accessToken || !uploadFile || !uploadIncidentId) {
      toast.error('Choose an incident and a file');
      return;
    }
    setBusyId('upload');
    try {
      await mediaApi.upload(accessToken, uploadIncidentId, uploadFile, uploadFile.name);
      toast.success('Document uploaded');
      setUploadOpen(false);
      setUploadFile(null);
      void libraryQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusyId(null);
    }
  }

  function applyFilters() {
    setSearch(draftSearch);
    setFolder(category === 'All' ? 'All' : category);
  }

  function resetFilters() {
    setDraftSearch('');
    setSearch('');
    setCategory('All');
    setDocType('All');
    setUploader('All');
    setDateFrom('');
    setDateTo('');
    setFolder('All');
  }

  const showingFrom = filtered.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, filtered.length);
  const incidents = incidentsQuery.data?.data?.incidents ?? [];

  return (
    <div className="reports-page -m-3 flex flex-1 flex-col overflow-x-hidden overflow-y-auto sm:-m-4 md:-m-6">
      <header className="shrink-0 border-b border-navy-700 px-3 py-3 sm:px-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-mono text-lg font-bold uppercase tracking-[0.12em] text-ink-50 sm:text-xl">
              Documentation & Reports
            </h1>
            <p className="mt-0.5 text-sm text-ink-400">
              Manage, organize and generate all system documents and reports
            </p>
            <FreshnessLine
              state={liveSyncToFreshness(live.state, live.lastUpdated)}
              lastUpdated={libraryQuery.dataUpdatedAt}
              compact
              className="mt-1.5"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-[40px] gap-2 bg-[#3b82f6] hover:bg-[#60a5fa]"
              onClick={() => setUploadOpen(true)}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Upload Document
            </Button>
            <Button type="button" variant="outline" className="min-h-[40px] gap-2" onClick={() => setGenerateOpen(true)}>
              <FileText className="h-4 w-4" aria-hidden />
              Generate Report
            </Button>
          </div>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label="Documentation tabs">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={clsx(
                'min-h-[40px] shrink-0 border-b-2 px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors',
                tab === t ? 'border-[#3b82f6] text-[#60a5fa]' : 'border-transparent text-ink-400 hover:text-ink-200'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-4 p-3 sm:p-4 md:p-5">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <StatCard
            label="Total Documents"
            value={String(stats?.libraryItems ?? stats?.totalDocuments ?? 0)}
            hint="All time"
            Icon={Folder}
            tone="text-[#60a5fa] bg-[#3b82f6]/15"
          />
          <StatCard
            label="Reports Generated"
            value={String(stats?.reportsGenerated ?? 0)}
            hint="All time"
            Icon={FileText}
            tone="text-ok-400 bg-ok-500/15"
          />
          <StatCard
            label="Pending Approval"
            value={String(stats?.pendingApproval ?? 0)}
            hint="For review"
            Icon={Clock3}
            tone="text-gold-400 bg-gold-500/15"
          />
          <StatCard
            label="Library items"
            value={String(stats?.libraryItems ?? stats?.totalDocuments ?? 0)}
            hint={stats?.totalDownloads == null ? 'Downloads not tracked' : 'Reports + uploads'}
            Icon={Download}
            tone="text-[#c084fc] bg-purple-500/15"
          />
          <div className="card col-span-2 p-3 xl:col-span-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Storage Used</p>
                <p className="mt-1 text-lg font-bold text-ink-50">
                  {formatBytes(stats?.storageBytes || 0)}
                  <span className="text-sm font-normal text-ink-500">
                    {' '}
                    of {formatBytes(stats?.storageQuotaBytes || 20 * 1024 ** 3)}
                  </span>
                </p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#3b82f6]/15 text-[#60a5fa]">
                <Cloud className="h-4 w-4" aria-hidden />
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-navy-800">
              <div className="h-full rounded-full bg-[#3b82f6]" style={{ width: `${storagePct}%` }} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-ink-500">{storagePct}% used</p>
          </div>
        </div>

        <div className="reports-grid gap-4">
          {/* Folders */}
          <aside className="card reports-area-folders flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-navy-700 px-3 py-2.5">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                Document Folders
              </h2>
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 sidebar-scroll">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setFolder('All');
                    setCategory('All');
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
                    folder === 'All' ? 'bg-[#3b82f6]/15 text-ink-50' : 'text-ink-300 hover:bg-navy-800'
                  )}
                >
                  <Folder className="h-4 w-4 text-ink-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">All folders</span>
                  <span className="font-mono text-[10px] text-ink-500">{docs.length}</span>
                </button>
              </li>
              {FOLDERS.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setFolder(f.id);
                      setCategory(f.id);
                    }}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
                      folder === f.id ? 'bg-[#3b82f6]/15 text-ink-50' : 'text-ink-300 hover:bg-navy-800'
                    )}
                  >
                    <span className={clsx('flex h-8 w-8 items-center justify-center rounded-md', f.tone)}>
                      <Folder className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{f.label}</span>
                      <span className="font-mono text-[10px] text-ink-500">
                        {byCategory[f.id] || 0} documents
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-navy-700 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-ink-500">Storage usage</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-navy-800">
                <div className="h-full rounded-full bg-[#3b82f6]" style={{ width: `${storagePct}%` }} />
              </div>
              <p className="mt-1 text-xs text-ink-400">
                {formatBytes(stats?.storageBytes || 0)} / {formatBytes(stats?.storageQuotaBytes || 20 * 1024 ** 3)}
              </p>
            </div>
          </aside>

          {/* Center */}
          <section className="reports-area-main flex min-w-0 flex-col gap-4">
            <div className="card flex min-h-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-navy-700 px-3 py-2.5">
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                  {tab === 'Templates'
                    ? 'PDF Report Templates'
                    : tab === 'Archived'
                      ? 'Archived (terminal incidents)'
                      : 'Recent Documents'}
                </h2>
                <button
                  type="button"
                  className="text-xs text-[#60a5fa] hover:underline"
                  onClick={() => {
                    setFolder('All');
                    setCategory('All');
                    setTab('Documents');
                  }}
                >
                  View all
                </button>
              </div>

              {tab === 'Archived' && (
                <p className="border-b border-navy-800 px-3 py-2 text-[11px] text-ink-500">
                  Archive lists incident-derived reports whose incident status is closed, resolved, cancelled, or completed — not a separate document storage vault.
                </p>
              )}

              {tab === 'Templates' ? (
                <div className="min-h-0 flex-1 overflow-auto sidebar-scroll p-3">
                  {filteredTemplates.length === 0 ? (
                    <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-center">
                      <p className="text-sm font-medium text-ink-200">No templates match filters</p>
                      <p className="max-w-sm text-xs text-ink-500">Clear search or folder filters to see all PDF templates.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {filteredTemplates.map((t) => {
                        const Icon = t.Icon;
                        const busy = busyId === t.reportType;
                        return (
                          <div
                            key={t.id}
                            className="flex flex-col rounded-md border border-navy-700 bg-navy-950/40 p-3"
                          >
                            <div className="flex items-start gap-3">
                              <span className={clsx('flex h-10 w-10 items-center justify-center rounded-md text-ink-50', t.tone)}>
                                <Icon className="h-5 w-5" aria-hidden />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-ink-50">{t.title}</p>
                                <p className="mt-0.5 text-xs text-ink-400">{t.description}</p>
                                <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-ink-500">
                                  {t.category} · branded PDF
                                </p>
                              </div>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="mt-3 min-h-[40px] w-full gap-2 bg-[#3b82f6] hover:bg-[#60a5fa]"
                              disabled={!!busyId}
                              onClick={() => void generateReport(t.reportType, t.title)}
                            >
                              <Download className="h-4 w-4" aria-hidden />
                              {busy ? 'Generating…' : 'Generate PDF'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-3 text-[11px] text-ink-500">
                    All templates export with the system logo header. Date filters above apply when set.
                  </p>
                </div>
              ) : (
              <QueryState
                isLoading={libraryQuery.isLoading}
                isError={libraryQuery.isError}
                error={libraryQuery.error as Error}
                onRetry={() => libraryQuery.refetch()}
                isEmpty={!libraryQuery.isLoading && filtered.length === 0}
                emptyTitle="No documents"
                emptyHint="Upload media or generate reports to populate this library."
                showLastUpdated={false}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="min-h-0 flex-1 overflow-auto sidebar-scroll">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="sticky top-0 z-[1] bg-navy-900/95 text-[10px] uppercase tracking-wide text-ink-500 backdrop-blur">
                      <tr>
                        <th className="px-3 py-2.5 font-medium">Document Name</th>
                        <th className="px-3 py-2.5 font-medium">Category</th>
                        <th className="px-3 py-2.5 font-medium">Uploaded By</th>
                        <th className="px-3 py-2.5 font-medium">Date Uploaded</th>
                        <th className="px-3 py-2.5 font-medium">Size</th>
                        <th className="px-3 py-2.5 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((doc) => {
                        const Icon = fileIcon(doc.fileType);
                        return (
                          <tr key={doc.id} className="border-t border-navy-800 hover:bg-navy-800/40">
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className={clsx('flex h-8 w-8 items-center justify-center rounded-md', fileTone(doc.fileType))}>
                                  <Icon className="h-4 w-4" aria-hidden />
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-ink-50">{doc.name}</p>
                                  <p className="font-mono text-[10px] text-ink-500">{doc.fileType}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={clsx('inline-flex rounded px-2 py-0.5 text-[10px] font-semibold', categoryTone(doc.category))}>
                                {doc.category}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-700 font-mono text-[10px] text-ink-200">
                                  {initials(doc.uploadedBy)}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-ink-100">{doc.uploadedBy}</p>
                                  <p className="truncate text-[10px] text-ink-500">{formatRole(doc.uploaderRole)}</p>
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-ink-300">
                              {doc.dateUploaded ? formatManilaDate(doc.dateUploaded) : '—'}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-ink-400">
                              {doc.sizeBytes > 0 ? formatBytes(doc.sizeBytes) : doc.kind === 'report' ? 'On demand' : '—'}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1">
                                {doc.incidentId ? (
                                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" asChild>
                                    <Link to={`/admin/incidents/${doc.incidentId}`} aria-label="View incident">
                                      <Eye className="h-4 w-4" />
                                    </Link>
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0"
                                  disabled={busyId === doc.id}
                                  aria-label="Download"
                                  onClick={() => void openDocument(doc)}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </QueryState>
              )}

              {tab !== 'Templates' && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-navy-700 px-3 py-2">
                <p className="font-mono text-[10px] text-ink-500">
                  Showing {showingFrom} to {showingTo} of {filtered.length} documents
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded border border-navy-600 p-1.5 text-ink-300 hover:bg-navy-800 disabled:opacity-40"
                    disabled={page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => {
                    const start = Math.max(0, Math.min(page - 2, pageCount - 5));
                    const idx = start + i;
                    if (idx >= pageCount) return null;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPage(idx)}
                        className={clsx(
                          'min-w-8 rounded px-2 py-1 font-mono text-[11px]',
                          page === idx ? 'bg-[#3b82f6] text-ink-50' : 'text-ink-400 hover:bg-navy-800'
                        )}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="rounded border border-navy-600 p-1.5 text-ink-300 hover:bg-navy-800 disabled:opacity-40"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              )}
              {tab === 'Templates' && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-navy-700 px-3 py-2">
                  <p className="font-mono text-[10px] text-ink-500">
                    {filteredTemplates.length} template{filteredTemplates.length === 1 ? '' : 's'} available
                  </p>
                  <img src="/logo.png" alt="" className="h-7 w-7 rounded object-contain opacity-90" />
                </div>
              )}
            </div>

            <div className="card p-3 sm:p-4">
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                Quick Report Generation
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                {QUICK_REPORTS.map((r) => {
                  const Icon = r.Icon;
                  const busy = busyId === r.reportType;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={!!busyId}
                      onClick={() => void generateReport(r.reportType, r.title)}
                      className={clsx(
                        'flex min-h-[120px] flex-col rounded-md p-3 text-left text-ink-50 transition-opacity disabled:opacity-50',
                        r.tone
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                      <p className="mt-2 text-sm font-bold">{busy ? 'Generating…' : r.title}</p>
                      <p className="mt-1 flex-1 text-[11px] leading-snug text-white/80">{r.description}</p>
                      <ArrowRight className="mt-2 h-4 w-4 self-end opacity-90" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Right rail */}
          <aside className="reports-area-rail flex flex-col gap-4">
            <div className="card p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                  Filters
                </h2>
                <button type="button" className="text-xs text-[#60a5fa] hover:underline" onClick={resetFilters}>
                  Clear Filters
                </button>
              </div>
              <div className="space-y-3">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
                  <input
                    type="search"
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                    placeholder="Search by name, incident ID, code, or description…"
                    className="input-field w-full pl-9"
                  />
                </label>
                <div className="space-y-1">
                  <Label>Category</Label>
                  <select className="input-field" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="All">All categories</option>
                    {FOLDERS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Document Type</Label>
                  <select className="input-field" value={docType} onChange={(e) => setDocType(e.target.value)}>
                    <option value="All">All types</option>
                    {['PDF', 'Excel', 'Word', 'Image', 'Other'].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>From</Label>
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>To</Label>
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Uploaded By</Label>
                  <select className="input-field" value={uploader} onChange={(e) => setUploader(e.target.value)}>
                    <option value="All">Anyone</option>
                    {uploaders.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Button type="button" className="min-h-[40px] bg-[#3b82f6] hover:bg-[#60a5fa]" onClick={applyFilters}>
                    Apply Filters
                  </Button>
                  <Button type="button" variant="outline" className="min-h-[40px]" onClick={resetFilters}>
                    Reset
                  </Button>
                </div>
              </div>
            </div>

            <div className="card p-3 sm:p-4">
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
                Document Type Breakdown
              </h2>
              <div className="flex items-center gap-4">
                <div
                  className="h-28 w-28 shrink-0 rounded-full"
                  style={{ background: typeBreakdown.gradient }}
                  aria-hidden
                >
                  <div className="m-[18%] flex h-[64%] w-[64%] items-center justify-center rounded-full bg-navy-900 text-center">
                    <div>
                      <p className="text-lg font-bold text-ink-50">{stats?.libraryItems ?? stats?.totalDocuments ?? 0}</p>
                      <p className="text-[9px] uppercase text-ink-500">Docs</p>
                    </div>
                  </div>
                </div>
                <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
                  {typeBreakdown.entries.map((e) => (
                    <li key={e.key} className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 text-ink-300">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: e.color }} />
                        {e.key}
                      </span>
                      <span className="font-mono text-[11px] text-ink-400">
                        {e.count} · {e.pct}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Attach to incident</Label>
              <select
                className="input-field"
                value={uploadIncidentId}
                onChange={(e) => setUploadIncidentId(e.target.value)}
              >
                <option value="">Select incident…</option>
                {incidents.map((i) => (
                  <option key={i._id} value={i._id}>
                    {i.displayId} — {i.incidentTypeId?.typeName || i.status}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>File</Label>
              <Input
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
            </div>
            <Button
              type="button"
              className="min-h-[44px] w-full gap-2 bg-[#3b82f6] hover:bg-[#60a5fa]"
              disabled={!uploadFile || !uploadIncidentId || busyId === 'upload'}
              onClick={() => void uploadDocument()}
            >
              <Upload className="h-4 w-4" aria-hidden />
              {busyId === 'upload' ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate report</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {REPORT_TEMPLATES.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={!!busyId}
                onClick={() => void generateReport(r.reportType, r.title)}
                className="flex w-full items-center justify-between rounded-md border border-navy-700 bg-navy-900/50 px-3 py-3 text-left hover:border-navy-500"
              >
                <span>
                  <span className="block text-sm font-semibold text-ink-50">{r.title}</span>
                  <span className="text-xs text-ink-500">{r.description}</span>
                </span>
                <Download className="h-4 w-4 text-ink-400" aria-hidden />
              </button>
            ))}
            <p className="pt-1 text-[11px] text-ink-500">PDFs include the system logo.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  Icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  Icon: LucideIcon;
  tone: string;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-ink-50">{value}</p>
          <p className="text-xs text-ink-500">{hint}</p>
        </div>
        <span className={clsx('flex h-9 w-9 items-center justify-center rounded-md', tone)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
    </div>
  );
}
