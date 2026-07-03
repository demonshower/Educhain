import { useState } from 'react';

interface CopyButtonProps {
  text: string;
  className?: string;
}

export default function CopyButton({ text, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={`text-xs text-gray-400 hover:text-gray-200 transition-colors ${className}`}
      title="Copy to clipboard"
    >
      {copied ? '✓ Copied' : '⎘ Copy'}
    </button>
  );
}
