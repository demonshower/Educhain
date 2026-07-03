import { useEffect, useState } from 'react';
import type { Toast as ToastData } from '../../contexts/ToastContext';

const typeStyles: Record<string, string> = {
  success: 'border-green-500 bg-green-900/80 text-green-100',
  error: 'border-red-500 bg-red-900/80 text-red-100',
  warning: 'border-yellow-500 bg-yellow-900/80 text-yellow-100',
  info: 'border-primary-500 bg-primary-900/80 text-primary-100',
};

const typeIcons: Record<string, string> = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
};

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

export default function Toast({ toast, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm transition-all duration-200 ${
        typeStyles[toast.type]
      } ${visible ? 'toast-enter-active' : 'toast-enter'}`}
    >
      <span className="text-lg leading-none">{typeIcons[toast.type]}</span>
      <p className="text-sm flex-1">{toast.message}</p>
      <button
        onClick={handleDismiss}
        className="text-sm opacity-60 hover:opacity-100 transition-opacity"
      >
        ×
      </button>
    </div>
  );
}
