import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';

interface UseContractEventsOptions {
  contract: ethers.Contract | null;
  eventName: string;
  fromBlock?: number;
  enabled?: boolean;
}

interface EventLog {
  args: ethers.Result;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

const BLOCK_CACHE_PREFIX = 'educhain-events-block-';

export function useContractEvents({ contract, eventName, fromBlock, enabled = true }: UseContractEventsOptions) {
  const [events, setEvents] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(false);
  const listenerRef = useRef<ethers.Listener | null>(null);

  const cacheKey = contract ? `${BLOCK_CACHE_PREFIX}${eventName}-${contract.target}` : '';

  const getStartBlock = useCallback(() => {
    if (fromBlock !== undefined) return fromBlock;
    try {
      const cached = localStorage.getItem(cacheKey);
      return cached ? parseInt(cached) : 0;
    } catch { return 0; }
  }, [fromBlock, cacheKey]);

  const fetchHistorical = useCallback(async () => {
    if (!contract || !enabled) return;
    setLoading(true);
    try {
      const startBlock = getStartBlock();
      const filter = contract.filters[eventName]();
      const logs = await contract.queryFilter(filter, startBlock);
      const parsed: EventLog[] = logs.map(log => ({
        args: (log as ethers.EventLog).args,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index,
      }));
      setEvents(parsed);
      if (logs.length > 0) {
        const lastBlock = logs[logs.length - 1].blockNumber;
        localStorage.setItem(cacheKey, String(lastBlock + 1));
      }
    } catch (err) {
      console.error(`Failed to fetch ${eventName} events:`, err);
    } finally {
      setLoading(false);
    }
  }, [contract, eventName, enabled, getStartBlock, cacheKey]);

  // Subscribe to new events
  useEffect(() => {
    if (!contract || !enabled) return;

    const listener: ethers.Listener = (...args) => {
      const event = args[args.length - 1] as ethers.EventLog;
      const newEvent: EventLog = {
        args: event.args,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        logIndex: event.index,
      };
      setEvents(prev => [...prev, newEvent]);
      localStorage.setItem(cacheKey, String(event.blockNumber + 1));
    };

    listenerRef.current = listener;
    contract.on(eventName, listener);

    return () => {
      if (listenerRef.current) {
        contract.off(eventName, listenerRef.current);
      }
    };
  }, [contract, eventName, enabled, cacheKey]);

  useEffect(() => {
    fetchHistorical();
  }, [fetchHistorical]);

  return { events, loading, refetch: fetchHistorical };
}
