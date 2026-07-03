import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Users, Vote, CheckCircle2, AlertTriangle, Shield, Play } from 'lucide-react';
import { useArbitration } from '../hooks/useArbitration';
import { useAgentApi, type SandboxReplayResult } from '../hooks/useAgentApi';
import { useTransactions } from '../contexts/TransactionContext';
import { useToast } from '../contexts/ToastContext';
import { shortenAddress } from '../lib/utils';
import ProgressRing from '../components/ui/ProgressRing';
import PageTransition from '../components/ui/PageTransition';
import type { useWallet } from '../hooks/useWallet';

const steps = [
  { icon: <AlertTriangle size={16} />, label: 'Dispute Raised' },
  { icon: <Users size={16} />, label: 'Committee Selected' },
  { icon: <Vote size={16} />, label: 'Votes Cast' },
  { icon: <CheckCircle2 size={16} />, label: 'Result Submitted' },
];

export default function ArbitrationPage() {
  const wallet = useOutletContext<ReturnType<typeof useWallet>>();
  const arbitration = useArbitration({
    provider: wallet.provider,
    signer: wallet.signer,
    chainId: wallet.chainId,
  });
  const { trackTx } = useTransactions();
  const { addToast } = useToast();
  const agentApi = useAgentApi();

  const [taskId, setTaskId] = useState('');
  const [committee, setCommittee] = useState<string[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vote, setVote] = useState<'uphold' | 'dismiss'>('uphold');
  const [replayTraceHash, setReplayTraceHash] = useState('');
  const [signatures, setSignatures] = useState<Array<{ address: string; signature: string }>>([]);
  const [signing, setSigning] = useState(false);
  const [submittingResult, setSubmittingResult] = useState(false);

  // Sandbox replay state
  const [pocCode, setPocCode] = useState('');
  const [contractSource, setContractSource] = useState('');
  const [forkRpc, setForkRpc] = useState('');
  const [forkBlock, setForkBlock] = useState('');
  const [replayResult, setReplayResult] = useState<SandboxReplayResult | null>(null);
  const [replaying, setReplaying] = useState(false);

  const committeeSize = committee.length;
  const quorumNeeded = Math.ceil(committeeSize * 0.67) || 1;

  // Determine current step
  const currentStep = committee.length === 0 ? 0 : signatures.length === 0 ? 1 : signatures.length >= quorumNeeded ? 3 : 2;

  const fetchCommittee = async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      const members = await arbitration.getCommittee(taskId);
      setCommittee(members);
      if (wallet.address) {
        const member = await arbitration.isCommitteeMember(taskId, wallet.address);
        setIsMember(member);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch committee');
      setCommittee([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCommittee = async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await arbitration.selectCommittee(taskId);
      if (wallet.provider) trackTx(result.hash, 'Select Committee', wallet.provider);
      await result.wait();
      addToast('Committee selected', 'success');
      await fetchCommittee();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to select committee');
    } finally {
      setLoading(false);
    }
  };

  const handleSignVote = async () => {
    if (!taskId || !replayTraceHash) {
      setError('Please enter replay trace hash');
      return;
    }
    setSigning(true);
    setError(null);
    try {
      const signature = await arbitration.signVote(taskId, vote === 'uphold', replayTraceHash);
      setSignatures(prev => [...prev, { address: wallet.address!, signature }]);
      addToast('Vote signed successfully', 'success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign vote');
    } finally {
      setSigning(false);
    }
  };

  const handleSubmitResult = async () => {
    if (!taskId || signatures.length === 0) return;
    setSubmittingResult(true);
    setError(null);
    try {
      const sigs = signatures.map(s => s.signature);
      const result = await arbitration.submitResult(taskId, vote === 'uphold', replayTraceHash, sigs);
      if (wallet.provider) trackTx(result.hash, 'Submit Arbitration Result', wallet.provider);
      await result.wait();
      addToast('Arbitration result submitted on-chain', 'success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit result');
    } finally {
      setSubmittingResult(false);
    }
  };

  const handleRunReplay = async () => {
    if (!pocCode || !contractSource) {
      setError('Verification evidence and assignment source are required');
      return;
    }
    setReplaying(true);
    setError(null);
    try {
      const result = await agentApi.replaySandbox(
        pocCode,
        contractSource,
        forkRpc || undefined,
        forkBlock ? parseInt(forkBlock) : undefined,
      );
      if (result) {
        setReplayResult(result);
        setReplayTraceHash(result.replay_trace_hash);
        addToast(`Sandbox verdict: ${result.verdict}`, result.verdict === 'CHALLENGE_UPHELD' ? 'warning' : 'info');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Replay failed');
    } finally {
      setReplaying(false);
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        <h2 className="section-title">Arbitration</h2>

        {/* Step Progress */}
        <div className="card">
          <div className="flex items-center justify-between">
            {steps.map((step, i) => (
              <div key={i} className="flex flex-col items-center gap-2 flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  i < currentStep ? 'bg-[#0071e3]/10 border-[#0071e3] text-[#0071e3]' :
                  i === currentStep ? 'bg-[#0071e3]/5 border-[#0071e3]/50 text-[#0071e3]' :
                  'bg-[#f5f5f7] border-[#f5f5f7] text-[#86868b]'
                }`}>
                  {step.icon}
                </div>
                <span className={`text-xs text-center ${i <= currentStep ? 'text-[#1d1d1f]' : 'text-[#86868b]'}`}>
                  {step.label}
                </span>
                {i < steps.length - 1 && (
                  <div className={`absolute h-0.5 w-full ${i < currentStep ? 'bg-[#0071e3]' : 'bg-[#f5f5f7]'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Committee Lookup */}
        <div className="card space-y-4">
          <h3 className="text-lg font-semibold text-[#1d1d1f] flex items-center gap-2">
            <Search size={18} />
            Committee Lookup
          </h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={taskId}
              onChange={e => setTaskId(e.target.value)}
              placeholder="Task ID (0x...)"
              className="input flex-1 font-mono"
            />
            <button onClick={fetchCommittee} disabled={loading || !taskId} className="btn-secondary">
              Lookup
            </button>
            <button onClick={handleSelectCommittee} disabled={loading || !taskId} className="btn-primary">
              Select Committee
            </button>
          </div>
          {error && <p className="text-sm text-[#ff3b30]">{error}</p>}
        </div>

        {/* Committee Members */}
        {committee.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="card"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#1d1d1f]">
                Committee Members ({committee.length})
                {isMember && (
                  <span className="ml-2 text-xs bg-[#34c759]/10 text-[#34c759] px-2 py-0.5 rounded-full">
                    You are a member
                  </span>
                )}
              </h3>
              <ProgressRing
                value={signatures.length}
                max={quorumNeeded}
                size={60}
                label="quorum"
                color="text-[#0071e3]"
              />
            </div>
            <div className="space-y-2">
              {committee.map((member, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-[#f5f5f7] rounded-2xl">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: `#${member.slice(2, 8)}` }}
                  >
                    {member.slice(2, 4).toUpperCase()}
                  </div>
                  <span className="font-mono text-sm flex-1 text-[#1d1d1f]">{shortenAddress(member)}</span>
                  {member.toLowerCase() === wallet.address?.toLowerCase() && (
                    <span className="text-xs bg-[#0071e3]/10 text-[#0071e3] px-2 py-0.5 rounded-full">You</span>
                  )}
                  {signatures.find(s => s.address.toLowerCase() === member.toLowerCase()) && (
                    <span className="text-xs bg-[#34c759]/10 text-[#34c759] px-2 py-0.5 rounded-full">Signed</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Sandbox Replay Panel */}
        {committee.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="card space-y-4"
          >
            <h3 className="text-lg font-semibold text-[#1d1d1f] flex items-center gap-2">
              <Play size={18} />
              Sandbox Replay
            </h3>
            <p className="text-xs text-[#86868b]">
              Run the reporter's verification evidence in an isolated Foundry sandbox to verify the issue.
            </p>

            <div>
              <label className="label">Verification Evidence Code (Solidity test)</label>
              <textarea
                value={pocCode}
                onChange={e => setPocCode(e.target.value)}
                placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.0;&#10;import &quot;forge-std/Test.sol&quot;;&#10;..."
                className="input h-32 resize-y font-mono text-xs"
              />
            </div>

            <div>
              <label className="label">Assignment Source (target)</label>
              <textarea
                value={contractSource}
                onChange={e => setContractSource(e.target.value)}
                placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.0;&#10;contract Target { ... }"
                className="input h-32 resize-y font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Fork RPC (optional)</label>
                <input
                  type="text"
                  value={forkRpc}
                  onChange={e => setForkRpc(e.target.value)}
                  placeholder="http://127.0.0.1:8545"
                  className="input font-mono text-xs"
                />
              </div>
              <div>
                <label className="label">Fork Block (optional)</label>
                <input
                  type="number"
                  value={forkBlock}
                  onChange={e => setForkBlock(e.target.value)}
                  placeholder="latest"
                  className="input font-mono text-xs"
                />
              </div>
            </div>

            <button
              onClick={handleRunReplay}
              disabled={replaying || !pocCode || !contractSource}
              className="btn-primary w-full"
            >
              {replaying ? 'Running Replay...' : 'Run Replay'}
            </button>

            {replayResult && (
              <div className={`p-4 rounded-2xl ${
                replayResult.verdict === 'CHALLENGE_UPHELD'
                  ? 'bg-[#ff3b30]/5'
                  : 'bg-[#34c759]/5'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-sm font-bold ${
                    replayResult.verdict === 'CHALLENGE_UPHELD' ? 'text-[#ff3b30]' : 'text-[#34c759]'
                  }`}>
                    {replayResult.verdict}
                  </span>
                </div>
                <p className="text-xs text-[#1d1d1f] mb-2">{replayResult.reason}</p>
                <div className="text-xs text-[#6e6e73] space-y-1">
                  <p><span className="text-[#86868b]">Trace Hash:</span> <span className="font-mono">{replayResult.replay_trace_hash}</span></p>
                  <p><span className="text-[#86868b]">Exit Code:</span> {replayResult.exit_code}</p>
                </div>
                {replayResult.output && (
                  <details className="mt-2">
                    <summary className="text-xs text-[#86868b] cursor-pointer">Show output</summary>
                    <pre className="text-xs text-[#6e6e73] mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
                      {replayResult.output}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* Voting Panel */}
        {isMember && committee.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="card space-y-4"
          >
            <h3 className="text-lg font-semibold text-[#1d1d1f] flex items-center gap-2">
              <Shield size={18} />
              Cast Vote (EIP-712)
            </h3>

            <div>
              <label className="label">Decision</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setVote('uphold')}
                  className={`flex-1 px-4 py-3 rounded-2xl text-sm font-medium transition-all ${
                    vote === 'uphold'
                      ? 'bg-[#ff3b30]/10 text-[#ff3b30]'
                      : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'
                  }`}
                >
                  Uphold Dispute
                </button>
                <button
                  onClick={() => setVote('dismiss')}
                  className={`flex-1 px-4 py-3 rounded-2xl text-sm font-medium transition-all ${
                    vote === 'dismiss'
                      ? 'bg-[#34c759]/10 text-[#34c759]'
                      : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'
                  }`}
                >
                  Dismiss Dispute
                </button>
              </div>
            </div>

            <div>
              <label className="label">Replay Trace Hash (bytes32)</label>
              <input
                type="text"
                value={replayTraceHash}
                onChange={e => setReplayTraceHash(e.target.value)}
                placeholder="0x..."
                className="input font-mono"
              />
            </div>

            <button onClick={handleSignVote} disabled={signing || !replayTraceHash} className="btn-primary w-full">
              {signing ? 'Signing...' : 'Sign Vote'}
            </button>

            {signatures.length >= quorumNeeded && (
              <button onClick={handleSubmitResult} disabled={submittingResult} className="btn-primary bg-[#34c759] hover:bg-[#34c759]/90 w-full">
                {submittingResult ? 'Submitting...' : 'Submit Arbitration Result'}
              </button>
            )}
          </motion.div>
        )}

        {/* Process Explanation */}
        <div className="card">
          <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4">Arbitration Process</h3>
          <ol className="space-y-3 text-sm text-[#6e6e73]">
            {[
              'Dispute is raised against a proposal',
              'VRF-based committee selection from eligible participants (min reputation: 200)',
              'Committee members evaluate evidence and verification evidence replay results',
              'EIP-712 signed votes submitted (quorum: 67%)',
              'Result: dispute upheld (student slashed) or dismissed (reporter slashed)',
            ].map((text, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#0071e3]/10 flex items-center justify-center text-xs text-[#0071e3] font-bold">
                  {i + 1}
                </span>
                <span className="pt-0.5">{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </PageTransition>
  );
}
