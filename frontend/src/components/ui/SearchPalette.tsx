import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, LayoutDashboard, Users, ListTodo, Scale, ScrollText } from 'lucide-react';

interface SearchResult {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
}

const routes: SearchResult[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Overview and stats', path: '/', icon: <LayoutDashboard size={16} /> },
  { id: 'agents', label: 'Agents', description: 'Registered agents', path: '/agents', icon: <Users size={16} /> },
  { id: 'tasks', label: 'Tasks', description: 'Task management', path: '/tasks', icon: <ListTodo size={16} /> },
  { id: 'arbitration', label: 'Arbitration', description: 'Dispute resolution', path: '/arbitration', icon: <Scale size={16} /> },
  { id: 'events', label: 'Event Log', description: 'On-chain events', path: '/events', icon: <ScrollText size={16} /> },
];

export default function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const filtered = routes.filter(r =>
    r.label.toLowerCase().includes(query.toLowerCase()) ||
    r.description.toLowerCase().includes(query.toLowerCase())
  );

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setOpen(o => !o);
    }
    if (e.key === 'Escape') setOpen(false);
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
    }
  }, [open]);

  const select = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50"
          >
            <div className="bg-white rounded-2xl shadow-apple-xl overflow-hidden border border-black/[0.04]">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-black/[0.04]">
                <Search size={18} className="text-[#86868b]" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search pages..."
                  className="flex-1 bg-transparent text-[#1d1d1f] placeholder-[#86868b] outline-none text-sm"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && filtered.length > 0) {
                      select(filtered[0].path);
                    }
                  }}
                />
                <button onClick={() => setOpen(false)} className="text-[#86868b] hover:text-[#1d1d1f]">
                  <X size={16} />
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto py-2">
                {filtered.length === 0 ? (
                  <p className="text-sm text-[#86868b] text-center py-4">No results</p>
                ) : (
                  filtered.map(item => (
                    <button
                      key={item.id}
                      onClick={() => select(item.path)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f5f5f7] transition-colors"
                    >
                      <span className="text-[#86868b]">{item.icon}</span>
                      <div>
                        <p className="text-sm text-[#1d1d1f]">{item.label}</p>
                        <p className="text-xs text-[#86868b]">{item.description}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="px-4 py-2 border-t border-black/[0.04] text-xs text-[#86868b]">
                <kbd className="px-1.5 py-0.5 bg-[#f5f5f7] rounded text-[#6e6e73]">↵</kbd> to select
                <span className="mx-2">·</span>
                <kbd className="px-1.5 py-0.5 bg-[#f5f5f7] rounded text-[#6e6e73]">esc</kbd> to close
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
