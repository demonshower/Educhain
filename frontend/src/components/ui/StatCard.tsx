import { cn } from '../../lib/cn';
import AnimatedCounter from './AnimatedCounter';
import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  icon?: ReactNode;
  gradient?: 'cyan' | 'purple' | 'emerald' | 'amber';
  trend?: { value: number; positive: boolean };
}

const iconBg = {
  cyan: 'bg-[#0071e3]/10 text-[#0071e3]',
  purple: 'bg-purple-500/10 text-purple-500',
  emerald: 'bg-[#34c759]/10 text-[#34c759]',
  amber: 'bg-[#ff9f0a]/10 text-[#ff9f0a]',
};

const accentBar = {
  cyan: 'bg-[#0071e3]',
  purple: 'bg-purple-500',
  emerald: 'bg-[#34c759]',
  amber: 'bg-[#ff9f0a]',
};

export default function StatCard({ label, value, suffix = '', prefix = '', icon, gradient = 'cyan', trend }: StatCardProps) {
  return (
    <div className="bg-white rounded-3xl p-6 shadow-apple-sm hover:shadow-apple-md transition-all duration-300 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${accentBar[gradient]}`} />
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[26px] text-[#86868b] mb-3 font-medium">{label}</p>
          <div className="flex items-baseline gap-1.5">
            {prefix && <span className="text-xl text-[#6e6e73]">{prefix}</span>}
            <AnimatedCounter value={value} className="text-4xl font-bold text-[#1d1d1f] tracking-tight" />
            {suffix && <span className="text-sm text-[#86868b] ml-1">{suffix}</span>}
          </div>
          {trend && (
            <p className={cn('text-xs mt-2.5 font-semibold flex items-center gap-1', trend.positive ? 'text-[#34c759]' : 'text-[#ff3b30]')}>
              {trend.positive ? '↑' : '↓'} {trend.value}% vs last week
            </p>
          )}
        </div>
        {icon && (
          <div className={cn('p-3 rounded-2xl flex-shrink-0', iconBg[gradient])}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
