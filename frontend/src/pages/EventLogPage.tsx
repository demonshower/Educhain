import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ethers } from 'ethers';
import { motion } from 'framer-motion';
import { Radio, Filter } from 'lucide-react';
import DisputeResolutionABI from '../contracts/abis/DisputeResolution.json';
import ArbitrationCommitteeABI from '../contracts/abis/ArbitrationCommittee.json';
import RegistryABI from '../contracts/abis/Registry.json';
import { getAddresses } from '../contracts/addresses';
import EventLogItem from '../components/EventLogItem';
import Skeleton from '../components/ui/Skeleton';
import PageTransition from '../components/ui/PageTransition';
import type { useWallet } from '../hooks/useWallet';

interface ParsedEvent {
  name: string;
  blockNumber: number;
  transactionHash: string;
  args: Record<string, string>;
}

export default function EventLogPage() {
  const wallet = useOutletContext<ReturnType<typeof useWallet>>();
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const PAGE_SIZE = 30;

  const fetchEvents = useCallback(async () => {
    if (!wallet.provider || !wallet.chainId) return;
    setLoading(true);

    try {
      const addrs = getAddresses(wallet.chainId);
      const dispute = new ethers.Contract(addrs.disputeResolution, DisputeResolutionABI, wallet.provider);
      const arb = new ethers.Contract(addrs.arbitrationCommittee, ArbitrationCommitteeABI, wallet.provider);
      const registry = new ethers.Contract(addrs.registry, RegistryABI, wallet.provider);

      const [disputeLogs, arbLogs, regLogs] = await Promise.all([
        dispute.queryFilter('*', 0),
        arb.queryFilter('*', 0),
        registry.queryFilter('*', 0),
      ]);

      const parseLog = (log: ethers.EventLog | ethers.Log, contract: ethers.Contract): ParsedEvent | null => {
        try {
          const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
          if (!parsed) return null;
          const args: Record<string, string> = {};
          parsed.fragment.inputs.forEach((input, i) => {
            args[input.name] = String(parsed.args[i]);
          });
          return { name: parsed.name, blockNumber: log.blockNumber, transactionHash: log.transactionHash, args };
        } catch { return null; }
      };

      const allEvents: ParsedEvent[] = [
        ...disputeLogs.map(l => parseLog(l, dispute)).filter(Boolean) as ParsedEvent[],
        ...arbLogs.map(l => parseLog(l, arb)).filter(Boolean) as ParsedEvent[],
        ...regLogs.map(l => parseLog(l, registry)).filter(Boolean) as ParsedEvent[],
      ];

      allEvents.sort((a, b) => b.blockNumber - a.blockNumber);
      setEvents(allEvents);
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      setLoading(false);
    }
  }, [wallet.provider, wallet.chainId]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const eventTypes = [...new Set(events.map(e => e.name))];
  const filteredEvents = typeFilter ? events.filter(e => e.name === typeFilter) : events;
  const paginatedEvents = filteredEvents.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filteredEvents.length / PAGE_SIZE);

  return (
    <PageTransition>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="section-title flex items-center gap-3">
            Event Log
            <span className="flex items-center gap-1.5 text-xs bg-[#34c759]/10 text-[#34c759] px-2.5 py-1 rounded-full">
              <Radio size={10} className="animate-pulse" />
              Live
            </span>
          </h2>
          <span className="text-sm text-[#6e6e73]">{events.length} events</span>
        </div>

        {/* Type filter chips */}
        {eventTypes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-[#86868b]" />
            <button
              onClick={() => { setTypeFilter(null); setPage(0); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                !typeFilter ? 'bg-[#0071e3] text-white' : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'
              }`}
            >
              All
            </button>
            {eventTypes.map(type => (
              <button
                key={type}
                onClick={() => { setTypeFilter(type); setPage(0); }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  typeFilter === type ? 'bg-[#0071e3] text-white' : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        )}

        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="p-4">
              <Skeleton variant="card" count={5} />
            </div>
          ) : paginatedEvents.length === 0 ? (
            <p className="text-[#86868b] text-center py-8">No events found</p>
          ) : (
            paginatedEvents.map((event, i) => (
              <motion.div
                key={`${event.transactionHash}-${i}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
              >
                <EventLogItem
                  name={event.name}
                  blockNumber={event.blockNumber}
                  transactionHash={event.transactionHash}
                  args={event.args}
                />
              </motion.div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary text-sm">
              Previous
            </button>
            <span className="text-sm text-[#6e6e73]">Page {page + 1} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-secondary text-sm">
              Next
            </button>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
