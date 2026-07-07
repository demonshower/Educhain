import { useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Circle, AlertTriangle, CheckCircle, XCircle, Clock, Coins } from 'lucide-react';
import { useDisputeResolution } from '../hooks/useDisputeResolution';
import { useTransactions } from '../contexts/TransactionContext';
import { useToast } from '../contexts/ToastContext';
import { getStatusLabel, shortenAddress } from '../lib/utils';
import { TaskStatus } from '../types';
import StatusBadge from '../components/ui/StatusBadge';
import PageTransition from '../components/ui/PageTransition';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import type { useWallet } from '../hooks/useWallet';

const statusConfig = {
  [TaskStatus.Open]: { variant: 'info' as const, icon: <Circle size={12} /> },
  [TaskStatus.Proposed]: { variant: 'warning' as const, icon: <Clock size={12} /> },
  [TaskStatus.InReview]: { variant: 'info' as const, icon: <Clock size={12} /> },
  [TaskStatus.Challenged]: { variant: 'error' as const, icon: <AlertTriangle size={12} /> },
  [TaskStatus.Finalized]: { variant: 'success' as const, icon: <CheckCircle size={12} /> },
  [TaskStatus.Slashed]: { variant: 'error' as const, icon: <XCircle size={12} /> },
};

export default function TasksPage() {
  const wallet = useOutletContext<ReturnType<typeof useWallet>>();
  const dispute = useDisputeResolution({
    provider: wallet.provider,
    signer: wallet.signer,
    chainId: wallet.chainId,
  });
  const { trackTx } = useTransactions();
  const { addToast } = useToast();

  const [showPublish, setShowPublish] = useState(false);
  const [filter, setFilter] = useState<TaskStatus | -1>(-1);
  const [codeHash, setCodeHash] = useState('');
  const [sourceCode, setSourceCode] = useState('');
  const [constraints, setConstraints] = useState('');
  const [challengePeriod, setChallengePeriod] = useState('172800');
  const [minStake, setMinStake] = useState('1.0');
  const [reward, setReward] = useState('2.0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const filteredTasks = dispute.tasks.filter(t => filter === -1 || t.status === filter);
  const paginatedTasks = filteredTasks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filteredTasks.length / PAGE_SIZE);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await dispute.publishTask(codeHash, constraints, parseInt(challengePeriod), minStake, reward);
      if (wallet.provider) trackTx(result.hash, 'Publish Task', wallet.provider);
      result.taskId.then(id => {
        if (id) addToast(`Task published: ${shortenAddress(id)}`, 'success');
      });
      setShowPublish(false);
      setCodeHash('');
      setSourceCode('');
      setConstraints('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to publish task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSourceChange = (code: string) => {
    setSourceCode(code);
    if (code.trim() && !codeHash) {
      const encoder = new TextEncoder();
      const data = encoder.encode(code);
      crypto.subtle.digest('SHA-256', data).then(hash => {
        const hashArray = Array.from(new Uint8Array(hash));
        const hashHex = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        setCodeHash(hashHex);
      });
    }
  };

  const statusCounts = {
    all: dispute.tasks.length,
    [TaskStatus.Open]: dispute.tasks.filter(t => t.status === TaskStatus.Open).length,
    [TaskStatus.Proposed]: dispute.tasks.filter(t => t.status === TaskStatus.Proposed).length,
    [TaskStatus.InReview]: dispute.tasks.filter(t => t.status === TaskStatus.InReview).length,
    [TaskStatus.Challenged]: dispute.tasks.filter(t => t.status === TaskStatus.Challenged).length,
    [TaskStatus.Finalized]: dispute.tasks.filter(t => t.status === TaskStatus.Finalized).length,
    [TaskStatus.Slashed]: dispute.tasks.filter(t => t.status === TaskStatus.Slashed).length,
  };

  return (
    <PageTransition>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="section-title">Tasks</h2>
            <p className="text-[15px] text-[#6e6e73] mt-1">{dispute.taskCount} total tasks on-chain</p>
          </div>
          <button onClick={() => setShowPublish(!showPublish)} className="btn-primary flex items-center gap-2">
            <Plus size={16} />
            {showPublish ? 'Cancel' : 'Publish Task'}
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          {[
            { value: -1 as const, label: 'All', count: statusCounts.all },
            { value: TaskStatus.Open, label: 'Open', count: statusCounts[TaskStatus.Open] },
            { value: TaskStatus.Proposed, label: 'Proposed', count: statusCounts[TaskStatus.Proposed] },
            { value: TaskStatus.InReview, label: 'In Review', count: statusCounts[TaskStatus.InReview] },
            { value: TaskStatus.Challenged, label: 'Disputed', count: statusCounts[TaskStatus.Challenged] },
            { value: TaskStatus.Finalized, label: 'Finalized', count: statusCounts[TaskStatus.Finalized] },
            { value: TaskStatus.Slashed, label: 'Slashed', count: statusCounts[TaskStatus.Slashed] },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => { setFilter(f.value); setPage(0); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                filter === f.value
                  ? 'bg-[#0071e3] text-white'
                  : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'
              }`}
            >
              {f.label}
              <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${
                filter === f.value ? 'bg-white/20' : 'bg-black/[0.04]'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>

        {showPublish && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            onSubmit={handlePublish}
            className="card space-y-5"
          >
            <h3 className="text-lg font-semibold text-[#1d1d1f]">Publish New Assignment</h3>
            <p className="text-sm text-[#86868b]">Submit assignment code for quality review. Participants will compete to provide the best analysis.</p>

            <div>
              <label className="label">Source Code (Solidity)</label>
              <textarea
                value={sourceCode}
                onChange={e => handleSourceChange(e.target.value)}
                placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.0;&#10;&#10;contract MyContract {&#10;    // Paste your contract here...&#10;}"
                className="input h-40 resize-y font-mono text-xs"
              />
              <p className="text-xs text-[#86868b] mt-1.5">Code hash will be auto-generated from source</p>
            </div>

            <div>
              <label className="label">Code Hash (bytes32)</label>
              <input type="text" value={codeHash} onChange={e => setCodeHash(e.target.value)} placeholder="0x..." className="input font-mono text-sm" required />
            </div>

            <div>
              <label className="label">Hard Constraints</label>
              <textarea value={constraints} onChange={e => setConstraints(e.target.value)} placeholder="no-reentrancy, no-oracle-manipulation, no-flash-loan" className="input h-16 resize-none text-sm" />
              <p className="text-xs text-[#86868b] mt-1.5">Comma-separated integrity constraints the review must verify</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Dispute Period</label>
                <div className="relative">
                  <input type="number" value={challengePeriod} onChange={e => setChallengePeriod(e.target.value)} className="input pr-8" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#86868b]">sec</span>
                </div>
                <p className="text-xs text-[#86868b] mt-1">{Math.round(parseInt(challengePeriod || '0') / 3600)}h</p>
              </div>
              <div>
                <label className="label">Min Stake</label>
                <div className="relative">
                  <input type="number" step="0.1" value={minStake} onChange={e => setMinStake(e.target.value)} className="input pr-12" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#86868b]">学分</span>
                </div>
              </div>
              <div>
                <label className="label">Reward</label>
                <div className="relative">
                  <Coins size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#ff9f0a]" />
                  <input type="number" step="0.1" value={reward} onChange={e => setReward(e.target.value)} className="input pl-9 pr-12" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#86868b]">学分</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-4 rounded-2xl bg-[#ff3b30]/5">
                <AlertTriangle size={14} className="text-[#ff3b30]" />
                <span className="text-sm text-[#ff3b30]">{error}</span>
              </div>
            )}

            <div className="flex gap-3">
              <button type="submit" disabled={submitting} className="btn-primary flex-1">
                {submitting ? 'Publishing...' : 'Publish Task'}
              </button>
            </div>
          </motion.form>
        )}

        {/* Task List */}
        {dispute.loading ? (
          <Skeleton variant="card" count={5} />
        ) : filteredTasks.length === 0 ? (
          <div className="space-y-4">
            <EmptyState
              title={filter === -1 ? 'No tasks found' : 'No tasks match this filter'}
              description="Tasks will appear here once published on-chain."
            />
            <TaskIdNavigator />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {paginatedTasks.map((task, i) => {
                const config = statusConfig[task.status];
                return (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Link
                      to={`/tasks/${task.id}`}
                      className="card-hover block group relative overflow-hidden"
                    >
                      {/* Status accent border */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-3xl ${
                        task.status === TaskStatus.Open ? 'bg-[#0071e3]' :
                        task.status === TaskStatus.Proposed ? 'bg-[#ff9f0a]' :
                        task.status === TaskStatus.InReview ? 'bg-[#5856d6]' :
                        task.status === TaskStatus.Challenged ? 'bg-[#ff3b30]' :
                        task.status === TaskStatus.Finalized ? 'bg-[#34c759]' :
                        'bg-[#ff3b30]'
                      }`} />
                      <div className="flex items-center justify-between pl-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm text-[#1d1d1f] group-hover:text-[#0071e3] transition-colors">
                            {shortenAddress(task.id)}
                          </span>
                        </div>
                        <StatusBadge variant={config.variant} icon={config.icon}>
                          {getStatusLabel(task.status)}
                        </StatusBadge>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
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
          </>
        )}
      </div>
    </PageTransition>
  );
}

function TaskIdNavigator() {
  const [taskId, setTaskId] = useState('');

  return (
    <div className="flex gap-2 justify-center">
      <input
        type="text"
        value={taskId}
        onChange={e => setTaskId(e.target.value)}
        placeholder="Enter task ID (0x...)"
        className="input max-w-xs font-mono text-sm"
      />
      <Link
        to={taskId ? `/tasks/${taskId}` : '#'}
        className={`btn-secondary text-sm ${!taskId ? 'pointer-events-none opacity-50' : ''}`}
      >
        View
      </Link>
    </div>
  );
}
