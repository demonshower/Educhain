import type { TxStatus } from '../../contexts/TransactionContext';

const statusConfig: Record<TxStatus, { icon: string; color: string; label: string }> = {
  pending: { icon: '⟳', color: 'text-yellow-400', label: 'Pending' },
  confirmed: { icon: '✓', color: 'text-green-400', label: 'Confirmed' },
  failed: { icon: '✗', color: 'text-red-400', label: 'Failed' },
};

interface TransactionStatusProps {
  status: TxStatus;
  className?: string;
}

export default function TransactionStatus({ status, className = '' }: TransactionStatusProps) {
  const config = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${config.color} ${className}`}>
      <span className={status === 'pending' ? 'animate-spin' : ''}>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}
