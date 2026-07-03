import { useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { UserPlus, Search, Grid, List, Wallet, AlertCircle } from 'lucide-react';
import { useRegistry } from '../hooks/useRegistry';
import { useTransactions } from '../contexts/TransactionContext';
import { useToast } from '../contexts/ToastContext';
import { shortenAddress, formatEther } from '../lib/utils';
import PageTransition from '../components/ui/PageTransition';
import EmptyState from '../components/ui/EmptyState';
import type { useWallet } from '../hooks/useWallet';

function generateIdenticon(address: string): string {
  const hash = address.slice(2, 8);
  return `#${hash}`;
}

export default function AgentsPage() {
  const wallet = useOutletContext<ReturnType<typeof useWallet>>();
  const { agents, loading, register } = useRegistry({
    provider: wallet.provider,
    signer: wallet.signer,
    chainId: wallet.chainId,
  });
  const { trackTx } = useTransactions();
  const { addToast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [did, setDid] = useState('');
  const [model, setModel] = useState('');
  const [stakeAmount, setStakeAmount] = useState('1.0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  const filteredAgents = agents.filter(a =>
    a.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.did.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.isConnected) {
      setError('Please connect your wallet first');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await register(did, stakeAmount, model || undefined);
      if (wallet.provider) trackTx(result.hash, 'Register Participant', wallet.provider);
      await result.wait();
      addToast('Participant registered successfully!', 'success');
      setShowForm(false);
      setDid('');
      setModel('');
      setStakeAmount('1.0');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageTransition>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="section-title">Participants</h2>
            <p className="text-[15px] text-[#6e6e73] mt-1">{agents.length} registered participants</p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
            <UserPlus size={16} />
            {showForm ? 'Cancel' : 'Register Participant'}
          </button>
        </div>

        {/* Search and View Toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by address or DID..."
              className="input pl-9"
            />
          </div>
          <div className="flex bg-[#f5f5f7] rounded-xl overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2.5 transition-colors ${viewMode === 'grid' ? 'bg-white shadow-apple-sm text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}
              aria-label="Grid view"
            >
              <Grid size={16} />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-2.5 transition-colors ${viewMode === 'table' ? 'bg-white shadow-apple-sm text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}
              aria-label="Table view"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Registration Form */}
        {showForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleRegister}
            className="card space-y-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#1d1d1f]">Register New Participant</h3>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                wallet.isConnected
                  ? 'bg-[#34c759]/10 text-[#34c759]'
                  : 'bg-[#ff9f0a]/10 text-[#ff9f0a]'
              }`}>
                <Wallet size={12} />
                {wallet.isConnected ? shortenAddress(wallet.address!) : 'Not connected'}
              </div>
            </div>

            <p className="text-sm text-[#86868b]">
              Register as an AI review participant to join the protocol. You'll need to stake Credits as collateral.
            </p>

            <div>
              <label className="label">DID (Decentralized Identifier)</label>
              <input
                type="text"
                value={did}
                onChange={e => setDid(e.target.value)}
                placeholder="did:example:agent-001"
                className="input"
                required
              />
              <p className="text-xs text-[#86868b] mt-1.5">Max 31 characters. Used for on-chain identity.</p>
            </div>

            <div>
              <label className="label">AI Model</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="input"
              >
                <option value="">Select model...</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="deepseek-v3">DeepSeek V3</option>
                <option value="deepseek-r1">DeepSeek R1</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="llama-4-maverick">Llama 4 Maverick</option>
                <option value="other">Other</option>
              </select>
              <p className="text-xs text-[#86868b] mt-1.5">The LLM model powering this review participant.</p>
            </div>

            <div>
              <label className="label">Stake Amount (学分)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  value={stakeAmount}
                  onChange={e => setStakeAmount(e.target.value)}
                  className="input pr-12"
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#86868b]">学分</span>
              </div>
              <p className="text-xs text-[#86868b] mt-1.5">Minimum: 1.0 学分. Higher stake = higher weight in committee selection.</p>
            </div>

            {wallet.balance !== null && (
              <div className="flex items-center gap-2 p-4 rounded-2xl bg-[#f5f5f7]">
                <Wallet size={14} className="text-[#86868b]" />
                <span className="text-sm text-[#6e6e73]">Balance: {formatEther(wallet.balance)} 学分</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-4 rounded-2xl bg-[#ff3b30]/5">
                <AlertCircle size={14} className="text-[#ff3b30]" />
                <span className="text-sm text-[#ff3b30]">{error}</span>
              </div>
            )}

            <button type="submit" disabled={submitting || !wallet.isConnected} className="btn-primary w-full">
              {submitting ? 'Registering...' : `Register & Stake ${stakeAmount} 学分`}
            </button>
          </motion.form>
        )}

        {/* Agent List */}
        {loading ? (
          <p className="text-[#86868b]">Loading participants...</p>
        ) : filteredAgents.length === 0 ? (
          <EmptyState
            title="No participants found"
            description={searchQuery ? 'Try a different search term.' : 'No participants registered yet. Be the first!'}
          />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredAgents.map((agent, i) => (
              <motion.div
                key={agent.address}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link to={`/agents/${agent.address}`} className="card-hover block group">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: generateIdenticon(agent.address) }}
                    >
                      {agent.address.slice(2, 4).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-[#1d1d1f] group-hover:text-[#0071e3] transition-colors truncate">
                        {shortenAddress(agent.address)}
                      </p>
                      <p className="text-xs text-[#86868b] truncate">{agent.did}</p>
                    </div>
                  </div>
                  {agent.model && (
                    <div className="mb-3">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#0071e3]/10 text-[#0071e3]">
                        {agent.model}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-xl bg-[#f5f5f7]">
                      <p className="text-[10px] text-[#86868b] uppercase tracking-wider">Stake</p>
                      <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5">{formatEther(agent.stake)}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#f5f5f7]">
                      <p className="text-[10px] text-[#86868b] uppercase tracking-wider">Rep</p>
                      <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5">{agent.reputation}</p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#f5f5f7]">
                      <p className="text-[10px] text-[#86868b] uppercase tracking-wider">Weight</p>
                      <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5">{agent.weight}</p>
                    </div>
                  </div>
                  {/* Reputation bar */}
                  <div className="mt-3">
                    <div className="w-full bg-[#f5f5f7] rounded-full h-1.5">
                      <div
                        className="bg-[#0071e3] h-1.5 rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(Number(agent.reputation) / 10, 100)}%` }}
                      />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[0.04] text-left text-[#6e6e73]">
                    <th className="p-4 pr-4 font-medium">Address</th>
                    <th className="p-4 pr-4 font-medium">DID</th>
                    <th className="p-4 pr-4 font-medium">Stake</th>
                    <th className="p-4 pr-4 font-medium">Reputation</th>
                    <th className="p-4 font-medium">Weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {filteredAgents.map(agent => (
                    <tr key={agent.address} className="text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors">
                      <td className="p-4 pr-4">
                        <Link to={`/agents/${agent.address}`} className="font-mono text-[#0071e3] hover:underline">
                          {shortenAddress(agent.address)}
                        </Link>
                      </td>
                      <td className="p-4 pr-4 font-mono text-xs text-[#86868b]">{agent.did}</td>
                      <td className="p-4 pr-4">{formatEther(agent.stake)} 学分</td>
                      <td className="p-4 pr-4">{agent.reputation}</td>
                      <td className="p-4">{agent.weight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
