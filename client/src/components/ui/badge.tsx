import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-alert-500 text-ink-50',
        gold: 'border-transparent bg-gold-500 text-navy-950',
        secondary: 'border-navy-600 bg-navy-800 text-ink-100',
        outline: 'border-navy-600 text-ink-200',
        success: 'border-ok-500/30 bg-ok-500/15 text-ok-400',
        warning: 'border-gold-600/40 bg-gold-500/15 text-gold-400',
        danger: 'border-alert-500/40 bg-alert-500/15 text-alert-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
