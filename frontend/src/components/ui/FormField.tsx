import { type ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  error?: string | null;
  children: ReactNode;
  hint?: string;
}

export default function FormField({ label, error, children, hint }: FormFieldProps) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}
