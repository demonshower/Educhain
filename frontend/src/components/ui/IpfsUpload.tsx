import { useState, useRef } from 'react';
import { uploadToIpfs } from '../../lib/ipfs';

interface IpfsUploadProps {
  onUploaded: (cid: string) => void;
  accept?: string;
  label?: string;
}

export default function IpfsUpload({ onUploaded, accept, label = 'Upload to IPFS' }: IpfsUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cid, setCid] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const result = await uploadToIpfs(file);
      setCid(result.cid);
      onUploaded(result.cid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-primary-500 bg-primary-900/20' : 'border-gray-600 hover:border-gray-500'
        }`}
      >
        <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
        {uploading ? (
          <p className="text-sm text-gray-400">Uploading...</p>
        ) : cid ? (
          <p className="text-sm text-green-400 font-mono break-all">✓ {cid}</p>
        ) : (
          <p className="text-sm text-gray-400">{label} — drag & drop or click</p>
        )}
      </div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}
