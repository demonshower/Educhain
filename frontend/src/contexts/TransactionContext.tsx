import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { ethers } from 'ethers';
import { useToast } from './ToastContext';

export type TxStatus = 'pending' | 'confirmed' | 'failed';

export interface TxState {
  hash: string;
  description: string;
  status: TxStatus;
  timestamp: number;
  confirmations?: number;
  error?: string;
}

interface TransactionContextValue {
  transactions: TxState[];
  trackTx: (hash: string, description: string, provider: ethers.BrowserProvider) => void;
  clearAll: () => void;
}

const TX_STORAGE_KEY = 'educhain-transactions';

const TransactionContext = createContext<TransactionContextValue | null>(null);

export function useTransactions() {
  const ctx = useContext(TransactionContext);
  if (!ctx) throw new Error('useTransactions must be used within TransactionProvider');
  return ctx;
}

export function TransactionProvider({ children }: { children: ReactNode }) {
  const { addToast } = useToast();
  const [transactions, setTransactions] = useState<TxState[]>(() => {
    try {
      const stored = localStorage.getItem(TX_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem(TX_STORAGE_KEY, JSON.stringify(transactions.slice(0, 50)));
  }, [transactions]);

  const trackTx = useCallback((hash: string, description: string, provider: ethers.BrowserProvider) => {
    const tx: TxState = { hash, description, status: 'pending', timestamp: Date.now() };
    setTransactions(prev => [tx, ...prev]);
    addToast(`Tx submitted: ${description}`, 'info', 3000);

    provider.waitForTransaction(hash).then(receipt => {
      if (receipt && receipt.status === 1) {
        setTransactions(prev =>
          prev.map(t => t.hash === hash ? { ...t, status: 'confirmed', confirmations: 1 } : t)
        );
        addToast(`Confirmed: ${description}`, 'success');
      } else {
        setTransactions(prev =>
          prev.map(t => t.hash === hash ? { ...t, status: 'failed', error: 'Transaction reverted' } : t)
        );
        addToast(`Failed: ${description}`, 'error');
      }
    }).catch(err => {
      setTransactions(prev =>
        prev.map(t => t.hash === hash ? { ...t, status: 'failed', error: err.message } : t)
      );
      addToast(`Failed: ${description}`, 'error');
    });
  }, [addToast]);

  const clearAll = useCallback(() => {
    setTransactions([]);
  }, []);

  return (
    <TransactionContext.Provider value={{ transactions, trackTx, clearAll }}>
      {children}
    </TransactionContext.Provider>
  );
}
