import { cn } from '../../lib/cn';

interface SkeletonProps {
  variant?: 'line' | 'card' | 'table-row';
  count?: number;
  className?: string;
}

export default function Skeleton({ variant = 'line', count = 1, className = '' }: SkeletonProps) {
  const items = Array.from({ length: count });

  if (variant === 'card') {
    return (
      <div className={cn('space-y-4', className)}>
        {items.map((_, i) => (
          <div key={i} className="card relative overflow-hidden">
            <div className="h-4 bg-[#f5f5f7] rounded w-1/3 mb-3" />
            <div className="h-3 bg-[#f5f5f7] rounded w-full mb-2" />
            <div className="h-3 bg-[#f5f5f7] rounded w-2/3" />
            <div className="absolute inset-0 shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'table-row') {
    return (
      <>
        {items.map((_, i) => (
          <tr key={i}>
            <td className="py-3 pr-4"><div className="h-3 bg-[#f5f5f7] rounded w-24 shimmer" /></td>
            <td className="py-3 pr-4"><div className="h-3 bg-[#f5f5f7] rounded w-32 shimmer" /></td>
            <td className="py-3 pr-4"><div className="h-3 bg-[#f5f5f7] rounded w-16 shimmer" /></td>
            <td className="py-3 pr-4"><div className="h-3 bg-[#f5f5f7] rounded w-12 shimmer" /></td>
            <td className="py-3"><div className="h-3 bg-[#f5f5f7] rounded w-12 shimmer" /></td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {items.map((_, i) => (
        <div key={i} className="h-3 bg-[#f5f5f7] rounded shimmer" style={{ width: `${70 + Math.random() * 30}%` }} />
      ))}
    </div>
  );
}
