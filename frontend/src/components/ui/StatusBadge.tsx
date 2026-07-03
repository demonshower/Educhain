import { cn } from '../../lib/cn';
import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'purple';

interface StatusBadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
  icon?: ReactNode;
  pulse?: boolean;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: 'bg-[#34c759]/10 text-[#34c759]',
  warning: 'bg-[#ff9f0a]/10 text-[#ff9f0a]',
  error: 'bg-[#ff3b30]/10 text-[#ff3b30]',
  info: 'bg-[#0071e3]/10 text-[#0071e3]',
  neutral: 'bg-[#86868b]/10 text-[#86868b]',
  purple: 'bg-purple-500/10 text-purple-600',
};

const dotColors: Record<BadgeVariant, string> = {
  success: 'bg-[#34c759]',
  warning: 'bg-[#ff9f0a]',
  error: 'bg-[#ff3b30]',
  info: 'bg-[#0071e3]',
  neutral: 'bg-[#86868b]',
  purple: 'bg-purple-500',
};

export default function StatusBadge({ variant, children, icon, pulse = false, className }: StatusBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium',
      variantStyles[variant],
      className
    )}>
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', dotColors[variant])} />
          <span className={cn('relative inline-flex rounded-full h-2 w-2', dotColors[variant])} />
        </span>
      )}
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </span>
  );
}
