import { useEffect, useId, useState } from 'react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ConfirmActionRequest {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive' | 'gold';
  /** When set, requires a non-empty reason before confirm. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  defaultReason?: string;
}

interface ConfirmActionDialogProps {
  open: boolean;
  request: ConfirmActionRequest | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason?: string) => void | Promise<void>;
}

export function ConfirmActionDialog({
  open,
  request,
  busy,
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason(request?.defaultReason ?? '');
      setError('');
    }
  }, [open, request?.defaultReason]);

  if (!request) return null;

  const needsReason = !!request.requireReason;
  const canConfirm = !needsReason || reason.trim().length >= 3;

  async function handleConfirm() {
    if (needsReason && reason.trim().length < 3) {
      setError('Enter at least 3 characters explaining why.');
      return;
    }
    setError('');
    await onConfirm(needsReason ? reason.trim() : undefined);
  }

  const confirmVariant =
    request.tone === 'destructive' ? 'destructive' : request.tone === 'gold' ? 'gold' : 'default';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent className="max-w-md p-0">
        <div className="border-b border-navy-700 px-5 py-4 pr-12 sm:px-6">
          <DialogHeader className="mb-0">
            <DialogTitle>{request.title}</DialogTitle>
            <DialogDescription>{request.description}</DialogDescription>
          </DialogHeader>
        </div>
        {needsReason ? (
          <DialogBody className="space-y-2 px-5 py-4 sm:px-6">
            <Label htmlFor={reasonId}>{request.reasonLabel ?? 'Reason'}</Label>
            <Input
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={request.reasonPlaceholder ?? 'Required'}
              disabled={busy}
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? `${reasonId}-error` : undefined}
            />
            {error ? (
              <p id={`${reasonId}-error`} className="text-sm text-alert-400" role="alert">
                {error}
              </p>
            ) : null}
          </DialogBody>
        ) : null}
        <DialogFooter className="mt-0 px-5 py-4 sm:px-6">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {request.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            onClick={() => void handleConfirm()}
            disabled={busy || !canConfirm}
          >
            {busy ? 'Working…' : request.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
