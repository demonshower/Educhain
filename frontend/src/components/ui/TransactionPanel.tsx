import { useState } from 'react';
import { useTransactions } from '../../contexts/TransactionContext';
import TransactionStatus from './TransactionStatus';
import { shortenAddress } from '../../lib/utils';

export default function TransactionPanel() {
  const { transactions, clearAll } = useTransactions();
  const [open, setOpen] = useState(false);

  const pendingCount = transactions.filter(t => t.status === 'pending').length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center gap-1 text-sm text-gray-300 hover:text-gray-100 transition-colors"
      >
        <span>Tx</span>
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-2 w-4 h-4 bg-yellow-500 text-gray-900 text-[20px] font-bold rounded-full flex items-center justify-center">
            {pendingCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <span className="text-sm font-medium">Recent Transactions</span>
            {transactions.length > 0 && (
              <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-200">
                Clear
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {transactions.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No transactions yet</p>
            ) : (
              transactions.slice(0, 20).map(tx => (
                <div key={tx.hash} className="px-4 py-2 border-b border-gray-700/50 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-300 truncate max-w-[180px]">{tx.description}</span>
                    <TransactionStatus status={tx.status} />
                  </div>
                  <span className="text-[20px] text-gray-500 font-mono">{shortenAddress(tx.hash)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
