import { useState, useEffect } from 'react';
import { useParams, useOutletContext, Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { FileText, Shield, AlertTriangle, BarChart3, Clock, ArrowLeft } from 'lucide-react';
import { useDisputeResolution, type ProposalInfo, type ChallengeInfo } from '../hooks/useDisputeResolution';
import { useTransactions } from '../contexts/TransactionContext';
import { useToast } from '../contexts/ToastContext';
import { useAgentApi } from '../hooks/useAgentApi';
import { getStatusLabel, formatEther } from '../lib/utils';
import { TaskStatus } from '../types';
import type { TimelineEvent } from '../types';
import TaskTimeline from '../components/TaskTimeline';
import CopyButton from '../components/ui/CopyButton';
import StatusBadge from '../components/ui/StatusBadge';
import Tabs from '../components/ui/Tabs';
import PageTransition from '../components/ui/PageTransition';
import IpfsUpload from '../components/ui/IpfsUpload';
import DisputeResolutionABI from '../contracts/abis/DisputeResolution.json';
import { getAddresses } from '../contracts/addresses';
import type { useWallet } from '../hooks/useWallet';

const SCORE_STORAGE_KEY = 'educhain-score-commits';

const statusVariants: Record<number, 'info' | 'warning' | 'error' | 'success'> = {
  [TaskStatus.Open]: 'info',
  [TaskStatus.Proposed]: 'warning',
  [TaskStatus.Challenged]: 'error',
  [TaskStatus.Finalized]: 'success',
  [TaskStatus.Slashed]: 'error',
};

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const wallet = useOutletContext<ReturnType<typeof useWallet>>();
  const dispute = useDisputeResolution({
    provider: wallet.provider,
    signer: wallet.signer,
    chainId: wallet.chainId,
  });
  const { trackTx } = useTransactions();
  const { addToast } = useToast();
  const agentApi = useAgentApi();

  const [status, setStatus] = useState<TaskStatus>(TaskStatus.Open);
  const [proposal, setProposal] = useState<ProposalInfo | null>(null);
  const [challenge, setChallenge] = useState<ChallengeInfo | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Proposal form
  const [showProposal, setShowProposal] = useState(false);
  const [propStateRoot, setPropStateRoot] = useState('');
  const [propEvidenceRoot, setPropEvidenceRoot] = useState('');
  const [propTraceRoot, setPropTraceRoot] = useState('');
  const [propCID, setPropCID] = useState('');
  const [propStake, setPropStake] = useState('1.0');

  // Challenge form
  const [showChallenge, setShowChallenge] = useState(false);
  const [chalType, setChalType] = useState(0);
  const [chalPocCID, setChalPocCID] = useState('');
  const [chalDesc, setChalDesc] = useState('');
  const [chalStake, setChalStake] = useState('1.0');

  // Score commit form
  const [showScore, setShowScore] = useState(false);
  const [score, setScore] = useState('75');
  const [salt, setSalt] = useState('');

  // Score reveal form
  const [showReveal, setShowReveal] = useState(false);
  const [revealScore, setRevealScore] = useState('');
  const [revealSalt, setRevealSalt] = useState('');
  const [revealIndex, setRevealIndex] = useState('0');

  // AI Audit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<object | null>(null);
  const [auditSourceCode, setAuditSourceCode] = useState('');

  useEffect(() => {
    if (!taskId) return;
    loadTask();
    loadTimeline();
    loadSavedCommit();
  }, [taskId]);

  function loadSavedCommit() {
    if (!taskId || !wallet.address) return;
    try {
      const stored = JSON.parse(localStorage.getItem(SCORE_STORAGE_KEY) || '{}');
      const key = `${wallet.address}-${taskId}`;
      if (stored[key]) {
        setRevealScore(stored[key].score);
        setRevealSalt(stored[key].salt);
      }
    } catch { /* ignore */ }
  }

  async function loadTask() {
    if (!taskId) return;
    setLoading(true);
    try {
      const s = await dispute.getTaskStatus(taskId);
      setStatus(s);
      const p = await dispute.getProposal(taskId);
      setProposal(p);
      if (s >= TaskStatus.Challenged) {
        const c = await dispute.getChallenge(taskId);
        setChallenge(c);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadTimeline() {
    if (!taskId || !wallet.provider || !wallet.chainId) return;
    try {
      const addrs = getAddresses(wallet.chainId);
      const contract = new ethers.Contract(addrs.disputeResolution, DisputeResolutionABI, wallet.provider);
      const filter = contract.filters.TaskPublished(taskId);
      const logs = await contract.queryFilter(filter, 0);
      const events: TimelineEvent[] = [];
      const allFilter = contract.filters;
      const eventNames = ['TaskPublished', 'ProposalSubmitted', 'ChallengeRaised', 'TaskFinalized', 'ScoreCommitted', 'ScoreRevealed'];

      for (const name of eventNames) {
        try {
          const f = (allFilter as Record<string, (taskId: string) => ethers.ContractEventName>)[name]?.(taskId);
          if (f) {
            const eLogs = await contract.queryFilter(f, 0);
            for (const log of eLogs) {
              const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
              events.push({
                name,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                timestamp: 0,
                actor: parsed?.args?.[1] || undefined,
                data: undefined,
              });
            }
          }
        } catch { /* event may not exist */ }
      }

      if (events.length === 0 && logs.length > 0) {
        events.push({
          name: 'TaskPublished',
          blockNumber: logs[0].blockNumber,
          transactionHash: logs[0].transactionHash,
          timestamp: 0,
        });
      }

      events.sort((a, b) => a.blockNumber - b.blockNumber);
      setTimeline(events);
    } catch { /* ignore timeline errors */ }
  }

  // Build tabs
  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <FileText size={14} />,
      content: renderOverview(),
    },
    ...(proposal ? [{
      id: 'proposal',
      label: 'Proposal',
      icon: <BarChart3 size={14} />,
      content: renderProposal(),
    }] : []),
    ...(challenge ? [{
      id: 'challenge',
      label: 'Dispute',
      icon: <AlertTriangle size={14} />,
      content: renderChallenge(),
    }] : []),
    ...(status === TaskStatus.Proposed ? [{
      id: 'scoring',
      label: 'Scoring',
      icon: <Shield size={14} />,
      content: renderScoring(),
    }] : []),
    {
      id: 'timeline',
      label: 'Timeline',
      icon: <Clock size={14} />,
      content: <TaskTimeline events={timeline} />,
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-8">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-2 rounded-xl text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/[0.04] transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h2 className="section-title">Task Detail</h2>
          <StatusBadge variant={statusVariants[status] || 'neutral'} pulse={status < TaskStatus.Finalized}>
            {getStatusLabel(status)}
          </StatusBadge>
        </div>

        <div className="card">
          <p className="text-xs text-[#86868b] mb-1 uppercase tracking-wider">Task ID</p>
          <div className="flex items-center gap-2">
            <p className="font-mono text-sm break-all text-[#1d1d1f]">{taskId}</p>
            <CopyButton text={taskId || ''} />
          </div>
        </div>

        {loading ? (
          <p className="text-[#86868b]">Loading...</p>
        ) : (
          <Tabs tabs={tabs} />
        )}

        {error && (
          <div className="flex items-center gap-2 p-4 rounded-2xl bg-[#ff3b30]/5">
            <span className="text-sm text-[#ff3b30]">{error}</span>
          </div>
        )}
      </div>
    </PageTransition>
  );

  function renderOverview() {
    return (
      <div className="space-y-4">
        {/* Actions */}
        {status === TaskStatus.Open && !proposal && (
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setShowProposal(!showProposal)} className="btn-primary">
                Submit Proposal
              </button>
              <button onClick={handleRunAudit} disabled={agentApi.loading} className="btn-secondary flex items-center gap-2">
                {agentApi.loading ? (
                  <><span className="w-3 h-3 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin" /> Running AI Review...</>
                ) : 'Run AI Review'}
              </button>
            </div>
            <div>
              <label className="label">Source Code (for AI review)</label>
              <textarea
                value={auditSourceCode}
                onChange={e => setAuditSourceCode(e.target.value)}
                placeholder="Paste Solidity source code here for a full review..."
                className="input h-32 resize-y font-mono text-xs"
              />
            </div>
          </div>
        )}

        {auditResult && (
          <div className="card bg-[#f5f5f7] space-y-3">
            <h4 className="font-semibold text-[#0071e3] flex items-center gap-2">
              <BarChart3 size={16} /> AI Review Result
            </h4>
            {/* Severity indicator */}
            {'severity_score' in (auditResult as Record<string, unknown>) && (
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-14">
                  <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#f5f5f7]" />
                    <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2.5"
                      strokeDasharray={`${((auditResult as Record<string, number>).severity_score || 0) * 0.94} 94`}
                      className={(auditResult as Record<string, number>).severity_score >= 70 ? 'text-[#ff3b30]' : (auditResult as Record<string, number>).severity_score >= 40 ? 'text-[#ff9f0a]' : 'text-[#34c759]'}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[#1d1d1f]">
                    {(auditResult as Record<string, number>).severity_score}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-[#1d1d1f]">Severity Score</p>
                  <p className="text-xs text-[#86868b]">Higher = more critical issues found</p>
                </div>
              </div>
            )}
            {/* Vulnerabilities list */}
            {'vulnerabilities' in (auditResult as Record<string, unknown>) && (
              <div className="space-y-2">
                {((auditResult as Record<string, Array<Record<string, string>>>).vulnerabilities || []).map((v, i) => (
                  <div key={i} className="p-3 rounded-2xl bg-white">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        v.severity === 'critical' ? 'bg-[#ff3b30]/10 text-[#ff3b30]' :
                        v.severity === 'high' ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' :
                        'bg-[#ff9f0a]/10 text-[#ff9f0a]'
                      }`}>{v.severity}</span>
                      <span className="text-sm font-medium text-[#1d1d1f]">{v.type}</span>
                    </div>
                    <p className="text-xs text-[#6e6e73]">{v.description}</p>
                    {v.location && <p className="text-xs text-[#86868b] font-mono mt-1">{v.location}</p>}
                  </div>
                ))}
              </div>
            )}
            {/* State roots */}
            {'state_root' in (auditResult as Record<string, unknown>) && (
              <div className="grid grid-cols-1 gap-1.5 text-xs font-mono">
                <div className="p-2 rounded-xl bg-white"><span className="text-[#86868b]">state_root: </span><span className="text-[#1d1d1f] break-all">{(auditResult as Record<string, string>).state_root}</span></div>
                <div className="p-2 rounded-xl bg-white"><span className="text-[#86868b]">evidence_root: </span><span className="text-[#1d1d1f] break-all">{(auditResult as Record<string, string>).evidence_root}</span></div>
                <div className="p-2 rounded-xl bg-white"><span className="text-[#86868b]">trace_root: </span><span className="text-[#1d1d1f] break-all">{(auditResult as Record<string, string>).trace_root}</span></div>
              </div>
            )}
          </div>
        )}

        {showProposal && <ProposalForm />}

        {status === TaskStatus.Proposed && !challenge && (
          <div className="space-y-4">
            <button onClick={() => setShowChallenge(!showChallenge)} className="btn-primary bg-[#ff9f0a] hover:bg-[#ff9f0a]/90">
              Raise Dispute
            </button>
            {showChallenge && <ChallengeForm />}
          </div>
        )}

        {status === TaskStatus.Proposed && (
          <button onClick={handleFinalize} disabled={submitting} className="btn-primary bg-[#34c759] hover:bg-[#34c759]/90">
            {submitting ? 'Finalizing...' : 'Finalize (Optimistic)'}
          </button>
        )}
      </div>
    );
  }

  function renderProposal() {
    if (!proposal) return null;
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 text-sm">
          <Field label="Student" value={proposal.proposer} mono />
          <Field label="State Root" value={proposal.stateRoot} mono />
          <Field label="Evidence Root" value={proposal.evidenceRoot} mono />
          <Field label="Trace Root" value={proposal.traceRoot} mono />
          <Field label="Evidence CID" value={proposal.evidenceCID} />
          <Field label="Stake" value={`${formatEther(proposal.stake)} 学分`} />
          <Field label="Score Count" value={String(proposal.scoreCount)} />
        </div>
      </div>
    );
  }

  function renderChallenge() {
    if (!challenge) return null;
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 text-sm">
          <Field label="Reporter" value={challenge.challenger} mono />
          <Field label="Type" value={['Semantic', 'Evidence', 'Constraint'][challenge.challengeType]} />
          <Field label="Verification Evidence CID" value={challenge.pocCID} />
          <Field label="Description" value={challenge.description} />
          <Field label="Stake" value={`${formatEther(challenge.stake)} 学分`} />
        </div>
      </div>
    );
  }

  function renderScoring() {
    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setShowScore(!showScore)} className="btn-secondary">
            Commit Score
          </button>
          <button onClick={() => setShowReveal(!showReveal)} className="btn-secondary">
            Reveal Score
          </button>
        </div>
        {showScore && <ScoreForm />}
        {showReveal && <RevealForm />}
      </div>
    );
  }

  async function handleRunAudit() {
    if (!taskId) return;
    if (auditSourceCode) {
      // Use the full pickup-task endpoint for richer results
      const result = await agentApi.pickupTask(parseInt(taskId), auditSourceCode);
      if (result) {
        setAuditResult(result);
        setPropStateRoot(result.state_root);
        setPropEvidenceRoot(result.evidence_root);
        setPropTraceRoot(result.trace_root);
        if (result.recommendation === 'propose') {
          setShowProposal(true);
          addToast(`Agent recommends: ${result.recommendation} (confidence: ${(result.confidence * 100).toFixed(0)}%)`, 'success');
        } else {
          addToast(`Agent recommends skipping this task (confidence: ${(result.confidence * 100).toFixed(0)}%)`, 'warning');
        }
      }
    } else {
      const result = await agentApi.performAudit(taskId);
      if (result) {
        setAuditResult(result);
        setPropStateRoot(result.state_root);
        setPropEvidenceRoot(result.evidence_root);
        setPropTraceRoot(result.trace_root);
      }
    }
  }

  async function handleSubmitProposal(e: React.FormEvent) {
    e.preventDefault();
    if (!taskId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await dispute.submitProposal(taskId, propStateRoot, propEvidenceRoot, propTraceRoot, propCID, propStake);
      if (wallet.provider) trackTx(result.hash, 'Submit Proposal', wallet.provider);
      await result.wait();
      setShowProposal(false);
      await loadTask();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRaiseChallenge(e: React.FormEvent) {
    e.preventDefault();
    if (!taskId) return;
    setSubmitting(true);
    setError(null);
    try {
      const pocHash = ethers.keccak256(ethers.toUtf8Bytes(chalPocCID));
      const result = await dispute.raiseChallenge(taskId, chalType, chalPocCID, pocHash, chalDesc, chalStake);
      if (wallet.provider) trackTx(result.hash, 'Raise Dispute', wallet.provider);
      await result.wait();
      setShowChallenge(false);
      await loadTask();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommitScore(e: React.FormEvent) {
    e.preventDefault();
    if (!taskId) return;
    setSubmitting(true);
    setError(null);
    try {
      const newSalt = salt || ethers.hexlify(ethers.randomBytes(32));
      setSalt(newSalt);
      const commitHash = ethers.solidityPackedKeccak256(['uint256', 'bytes32'], [parseInt(score), newSalt]);
      const result = await dispute.commitScore(taskId, commitHash);
      if (wallet.provider) trackTx(result.hash, 'Commit Score', wallet.provider);
      const stored = JSON.parse(localStorage.getItem(SCORE_STORAGE_KEY) || '{}');
      const key = `${wallet.address}-${taskId}`;
      stored[key] = { score, salt: newSalt };
      localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(stored));
      await result.wait();
      addToast('Score committed. Save your salt for reveal!', 'success');
      setShowScore(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevealScore(e: React.FormEvent) {
    e.preventDefault();
    if (!taskId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await dispute.revealScore(taskId, parseInt(revealIndex), parseInt(revealScore), revealSalt);
      if (wallet.provider) trackTx(result.hash, 'Reveal Score', wallet.provider);
      await result.wait();
      addToast('Score revealed successfully', 'success');
      setShowReveal(false);
      await loadTask();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinalize() {
    if (!taskId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await dispute.finalizeOptimistic(taskId);
      if (wallet.provider) trackTx(result.hash, 'Finalize Task', wallet.provider);
      await result.wait();
      addToast('Task finalized', 'success');
      await loadTask();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  function ProposalForm() {
    return (
      <form onSubmit={handleSubmitProposal} className="card space-y-4">
        <h3 className="text-lg font-semibold text-[#1d1d1f]">Submit Proposal</h3>
        <div>
          <label className="label">State Root</label>
          <input type="text" value={propStateRoot} onChange={e => setPropStateRoot(e.target.value)} className="input font-mono" placeholder="0x..." required />
        </div>
        <div>
          <label className="label">Evidence Root</label>
          <input type="text" value={propEvidenceRoot} onChange={e => setPropEvidenceRoot(e.target.value)} className="input font-mono" placeholder="0x..." required />
        </div>
        <div>
          <label className="label">Trace Root</label>
          <input type="text" value={propTraceRoot} onChange={e => setPropTraceRoot(e.target.value)} className="input font-mono" placeholder="0x..." required />
        </div>
        <div>
          <label className="label">Evidence CID (IPFS)</label>
          <IpfsUpload
            accept=".json,.zip"
            label="Upload evidence package"
            onUploaded={(cid) => setPropCID(cid)}
          />
          <input type="text" value={propCID} onChange={e => setPropCID(e.target.value)} className="input mt-2" placeholder="Qm... (or upload above)" required />
        </div>
        <div>
          <label className="label">Stake (学分)</label>
          <input type="number" step="0.1" min="1.0" value={propStake} onChange={e => setPropStake(e.target.value)} className="input" required />
        </div>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Submitting...' : 'Submit Proposal'}
        </button>
      </form>
    );
  }

  function ChallengeForm() {
    return (
      <form onSubmit={handleRaiseChallenge} className="card space-y-4">
        <h3 className="text-lg font-semibold text-[#1d1d1f]">Raise Dispute</h3>
        <div>
          <label className="label">Dispute Type</label>
          <select value={chalType} onChange={e => setChalType(parseInt(e.target.value))} className="input">
            <option value={0}>Semantic Mismatch</option>
            <option value={1}>Verification Evidence</option>
            <option value={2}>Constraint Violation</option>
          </select>
        </div>
        <div>
          <label className="label">Verification Evidence CID (IPFS)</label>
          <IpfsUpload
            accept=".sol"
            label="Upload Verification Evidence (.sol)"
            onUploaded={(cid) => setChalPocCID(cid)}
          />
          <input type="text" value={chalPocCID} onChange={e => setChalPocCID(e.target.value)} className="input mt-2" placeholder="Qm... (or upload above)" required />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea value={chalDesc} onChange={e => setChalDesc(e.target.value)} className="input h-20 resize-none" required />
        </div>
        <div>
          <label className="label">Stake (学分)</label>
          <input type="number" step="0.1" min="1.0" value={chalStake} onChange={e => setChalStake(e.target.value)} className="input" required />
        </div>
        <button type="submit" disabled={submitting} className="btn-primary bg-[#ff9f0a] hover:bg-[#ff9f0a]/90">
          {submitting ? 'Submitting...' : 'Raise Dispute'}
        </button>
      </form>
    );
  }

  function ScoreForm() {
    return (
      <form onSubmit={handleCommitScore} className="card space-y-4">
        <h3 className="text-lg font-semibold text-[#1d1d1f]">Commit Peer Reviewer Score</h3>
        <p className="text-xs text-[#86868b]">Step 1: Commit a hash of your score. Step 2: Reveal after all commits.</p>
        <div>
          <label className="label">Score (0-100)</label>
          <input type="number" min="0" max="100" value={score} onChange={e => setScore(e.target.value)} className="input" required />
        </div>
        <div>
          <label className="label">Salt (auto-generated if empty)</label>
          <input type="text" value={salt} onChange={e => setSalt(e.target.value)} className="input font-mono" placeholder="Leave empty for random" />
        </div>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Committing...' : 'Commit Score'}
        </button>
        {salt && (
          <div className="flex items-center gap-2">
            <p className="text-xs text-[#ff9f0a] break-all">Salt: {salt}</p>
            <CopyButton text={salt} />
          </div>
        )}
      </form>
    );
  }

  function RevealForm() {
    return (
      <form onSubmit={handleRevealScore} className="card space-y-4">
        <h3 className="text-lg font-semibold text-[#1d1d1f]">Reveal Score</h3>
        <p className="text-xs text-[#86868b]">Reveal your previously committed score with the original salt.</p>
        <div>
          <label className="label">Peer Reviewer Index</label>
          <input type="number" min="0" value={revealIndex} onChange={e => setRevealIndex(e.target.value)} className="input" required />
        </div>
        <div>
          <label className="label">Score (0-100)</label>
          <input type="number" min="0" max="100" value={revealScore} onChange={e => setRevealScore(e.target.value)} className="input" required />
        </div>
        <div>
          <label className="label">Salt</label>
          <input type="text" value={revealSalt} onChange={e => setRevealSalt(e.target.value)} className="input font-mono" placeholder="0x..." required />
        </div>
        <button type="submit" disabled={submitting} className="btn-primary bg-teal-500 hover:bg-teal-500/90">
          {submitting ? 'Revealing...' : 'Reveal Score'}
        </button>
      </form>
    );
  }
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 p-4 rounded-2xl bg-[#f5f5f7]">
      <span className="text-[#86868b] text-xs sm:w-32 flex-shrink-0 uppercase tracking-wider">{label}</span>
      <span className={`text-[#1d1d1f] ${mono ? 'font-mono text-xs break-all' : 'text-sm'}`}>{value}</span>
    </div>
  );
}
