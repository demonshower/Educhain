import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu } from 'lucide-react';
import Header from './Header';
import Sidebar from './Sidebar';
import SearchPalette from './ui/SearchPalette';
import { useWallet } from '../hooks/useWallet';
import { useTransactions } from '../contexts/TransactionContext';

export default function Layout() {
  const wallet = useWallet();
  const { transactions } = useTransactions();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pendingTxCount = transactions.filter(t => t.status === 'pending').length;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#fbfbfd]">
      <Header wallet={wallet} pendingTxCount={pendingTxCount} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        {/* Mobile sidebar overlay */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
                onClick={() => setMobileMenuOpen(false)}
              />
              <motion.div
                initial={{ x: -256 }}
                animate={{ x: 0 }}
                exit={{ x: -256 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed left-0 top-0 bottom-0 z-50 md:hidden"
              >
                <Sidebar mobile onClose={() => setMobileMenuOpen(false)} />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <main className="flex-1 overflow-y-auto p-6 md:p-12">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden mb-4 p-2 rounded-xl bg-white shadow-apple-sm text-[#6e6e73] hover:text-[#1d1d1f]"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>

          <div className="max-w-screen-2xl mx-auto">
            <Outlet context={wallet} />
          </div>
        </main>
      </div>
      <SearchPalette />
    </div>
  );
}
