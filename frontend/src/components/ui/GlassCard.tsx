import { motion } from 'framer-motion';
import { cn } from '../../lib/cn';
import type { ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  gradient?: 'cyan' | 'purple' | 'emerald' | 'amber' | 'none';
}

export default function GlassCard({ children, className, hover = true, gradient = 'none' }: GlassCardProps) {
  const gradientBorder = {
    cyan: 'border-cyan-500/30',
    purple: 'border-purple-500/30',
    emerald: 'border-emerald-500/30',
    amber: 'border-amber-500/30',
    none: 'border-gray-700/50',
  };

  return (
    <motion.div
      whileHover={hover ? { y: -2, scale: 1.01 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={cn(
        'bg-gray-800/60 backdrop-blur-xl border rounded-xl p-6 shadow-glass-sm',
        gradientBorder[gradient],
        className
      )}
    >
      {children}
    </motion.div>
  );
}
