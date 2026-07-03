import { cn } from '../../lib/cn';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      {icon && (
        <div className="mb-4 p-4 rounded-full bg-[#f5f5f7] text-[#86868b]">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-[#1d1d1f] mb-1">{title}</h3>
      {description && <p className="text-sm text-[#6e6e73] max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}
