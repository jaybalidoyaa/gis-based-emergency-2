import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { mediaApi, type MediaAttachment } from '@/services/api';
import clsx from 'clsx';

export function IncidentMediaGallery({
  token,
  incidentId,
  className,
  refreshKey,
}: {
  token: string;
  incidentId: string;
  className?: string;
  /** bump to refetch (e.g. after edit upload) */
  refreshKey?: number | string;
}) {
  const [items, setItems] = useState<MediaAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void mediaApi
      .list(token, incidentId)
      .then((res) => {
        if (!cancelled) setItems(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, incidentId, refreshKey]);

  if (loading && items.length === 0) {
    return (
      <div className={clsx('grid min-h-0 flex-1 grid-cols-3 gap-1.5', className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="min-h-0 animate-pulse rounded-md bg-navy-800/80" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={clsx(
          'flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-navy-600 bg-navy-950/50 text-ink-600',
          className
        )}
      >
        <span className="flex flex-col items-center gap-1 text-[10px]">
          <ImageIcon className="h-4 w-4 opacity-40" />
          No photos yet
        </span>
      </div>
    );
  }

  return (
    <div className={clsx('grid min-h-0 flex-1 grid-cols-3 gap-1.5 overflow-y-auto sidebar-scroll', className)}>
      {items.slice(0, 9).map((m) => (
        <AuthMediaCell key={m.id} token={token} item={m} />
      ))}
    </div>
  );
}

function AuthMediaCell({ token, item }: { token: string; item: MediaAttachment }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void mediaApi
      .fetchBlobUrl(token, item.id)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        url = u;
        setSrc(u);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, item.id]);

  return (
    <div className="relative min-h-0 overflow-hidden rounded-md border border-navy-600 bg-navy-950">
      {item.contentType?.startsWith('video/') ? (
        src ? (
          <video src={src} className="h-full min-h-[48px] w-full object-cover" muted playsInline />
        ) : (
          <div className="flex h-full min-h-[48px] items-center justify-center text-[9px] text-ink-500">Video</div>
        )
      ) : src ? (
        <img src={src} alt={item.fileName} className="h-full min-h-[48px] w-full object-cover" />
      ) : (
        <div className="flex h-full min-h-[48px] items-center justify-center">
          <ImageIcon className="h-4 w-4 text-ink-600 opacity-40" />
        </div>
      )}
    </div>
  );
}
