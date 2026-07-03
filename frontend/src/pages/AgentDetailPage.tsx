import { useState, useEffect, useCallback } from 'react';
import { useParams, useOutletContext, Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useRegistry } from '../hooks/useRegistry';
import DisputeResolutionABI from '../contracts/abis/DisputeResolution.json';
import RegistryABI from '../contracts/abis/Registry.json';
import { getAddresses } from '../contracts/addresses';
import { formatEther, shortenAddress } from '../lib/utils';
import CopyButton from '../components/ui/CopyButton';
import StatCard from '../components/ui/StatCard';
import Skeleton from '../components/ui/Skeleton';
import PageTransition from '../components/ui/PageTransition';
import type { Agent } from '../types';
import type { useWallet } from '../hooks/useWallet';

interface ReputationEvent {
  blockNumber: number;
  newReputation: number;
  transactionHash: string;
}

interface TaskParticipation {
  taskId: string;
  role: 'publisher' | 'proposer' | 'challenger' | 'verifier';
  blockNumber: number;
}

export default function AgentDetailPage() {
  const { address } = useParams<{ address: string }>();
  const wallet = useOutletContext<ReturnType<typeof useWallet>>();
  const { getAgentInfo } = useRegistry({
    provider: wallet.provider,
    signer: wallet.signer,
    chainId: wallet.chainId,
  });

  const [agent, setAgent] = useState<Agent | null>(null);
  const [reputationHistory, setReputationHistory] = useState<ReputationEvent[]>([]);
  const [taskParticipations, setTaskParticipations] = useState<TaskParticipation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgentData = useCallback(async () => {
    if (!address || !wallet.provider || !wallet.chainId) return;
    setLoading(true);
    try {
      const info = await getAgentInfo(address);
      setAgent(info);

      const addrs = getAddresses(wallet.chainId);
      const registry = new ethers.Contract(addrs.registry, RegistryABI, wallet.provider);
      const dispute = new ethers.Contract(addrs.disputeResolution, DisputeResolutionABI, wallet.provider);

      try {
        const repFilter = registry.filters.ReputationUpdated?.(address);
        if (repFilter) {
          const repLogs = await registry.queryFilter(repFilter, 0);
          setReputationHistory(repLogs.map(log => {
            const parsed = registry.interface.parseLog({ topics: [...log.topics], data: log.data });
            return {
              blockNumber: log.blockNumber,
              newReputation: Number(parsed?.args?.newReputation || 0),
              transactionHash: log.transactionHash,
            };
          }));
        }
      } catch { /* ReputationUpdated may not exist */ }

      const participations: TaskParticipation[] = [];
      try {
        const publishFilter = dispute.filters.TaskPublished?.(null, address);
        if (publishFilter) {
          const publishLogs = await dispute.queryFilter(publishFilter, 0);
          publishLogs.forEach(log => {
            const parsed = dispute.interface.parseLog({ topics: [...log.topics], data: log.data });
            if (parsed) participations.push({ taskId: parsed.args.taskId, role: 'publisher', blockNumber: log.blockNumber });
          });
        }
      } catch { /* filter may not match */ }

      try {
        const proposalFilter = dispute.filters.ProposalSubmitted?.(null, address);
        if (proposalFilter) {
          const proposalLogs = await dispute.queryFilter(proposalFilter, 0);
          proposalLogs.forEach(log => {
            const parsed = dispute.interface.parseLog({ topics: [...log.topics], data: log.data });
            if (parsed) participations.push({ taskId: parsed.args.taskId, role: 'proposer', blockNumber: log.blockNumber });
          });
        }
      } catch { /* filter may not match */ }

      participations.sort((a, b) => b.blockNumber - a.blockNumber);
      setTaskParticipations(participations);
    } catch (err) {
      console.error('Failed to fetch agent data:', err);
    } finally {
      setLoading(false);
    }
  }, [address, wallet.provider, wallet.chainId, getAgentInfo]);

  useEffect(() => { fetchAgentData(); }, [fetchAgentData]);

  if (loading) {
    return <Skeleton variant="card" count={3} />;
  }

  if (!agent) {
    return (
      <div className="card text-center text-gray-400">
        <p>Participant not found: {address}</p>
        <Link to="/" className="text-[#0071e3] hover:underline text-sm mt-2 inline-block">
          Back to Monitor
        </Link>
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-2 rounded-xl text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/[0.04] transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h2 className="text-2xl font-bold text-[#1d1d1f]">Participant Detail</h2>
        </div>

        {/* Identity Card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card">
          <div className="flex items-center gap-4 mb-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg"
              style={{ backgroundColor: `#${(address || '000000').slice(2, 8)}` }}
            >
              {(address || '').slice(2, 4).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm break-all">{address}</span>
                <CopyButton text={address || ''} />
              </div>
              <p className="text-sm text-gray-400 mt-1">{agent.did}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${
              agent.registered
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}>
              {agent.registered ? 'Active' : 'Inactive'}
            </span>
          </div>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Stake" value={Number(formatEther(agent.stake))} suffix="Credits" gradient="cyan" />
          <StatCard label="Reputation" value={Number(agent.reputation)} gradient="purple" />
          <StatCard label="Weight" value={Number(agent.weight)} gradient="emerald" />
        </div>

        {/* Task Participations */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card">
          <h3 className="text-lg font-semibold mb-4">Task Participation</h3>
          {taskParticipations.length === 0 ? (
            <p className="text-sm text-gray-400">No task participation found</p>
          ) : (
            <div className="space-y-2">
              {taskParticipations.map((tp, i) => (
                <Link
                  key={i}
                  to={`/tasks/${tp.taskId}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-700/20 hover:bg-gray-700/40 transition-colors border border-gray-700/30"
                >
                  <span className="font-mono text-xs text-cyan-400">{shortenAddress(tp.taskId)}</span>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full border ${
                    tp.role === 'publisher' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                    tp.role === 'proposer' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                    tp.role === 'challenger' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                    'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                  }`}>
                    {tp.role}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </motion.div>

        {/* Reputation History */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card">
          <h3 className="text-lg font-semibold mb-4">Reputation History</h3>
          {reputationHistory.length === 0 ? (
            <p className="text-sm text-gray-400">No reputation changes recorded</p>
          ) : (
            <div className="space-y-2">
              {reputationHistory.map((event, i) => (
                <div key={i} className="flex items-center justify-between text-sm p-3 bg-gray-700/20 rounded-lg border border-gray-700/30">
                  <span className="text-gray-400">Block #{event.blockNumber}</span>
                  <span className="font-mono text-cyan-400">{event.newReputation}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
}
