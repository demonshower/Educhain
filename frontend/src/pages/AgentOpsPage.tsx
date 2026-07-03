import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Zap, Shield, BarChart3, Play, Cpu,
  ChevronDown, CheckCircle, AlertTriangle, Loader2
} from 'lucide-react';
import { useAgentApi, type SandboxReplayResult, type TaskPickupResult } from '../hooks/useAgentApi';
import { useToast } from '../contexts/ToastContext';
import type { AuditResult, PoCResult, ArbitrationVote, ScoreResult } from '../types';
import PageTransition from '../components/ui/PageTransition';
import type { useWallet } from '../hooks/useWallet';

type PanelId = 'audit' | 'poc' | 'arbitration' | 'score' | 'sandbox' | 'pickup';

interface PanelConfig {
  id: PanelId;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  endpoint: string;
}

const panels: PanelConfig[] = [
  { id: 'audit', title: 'Quality Review', description: 'LLM-powered issue analysis', icon: <Brain size={20} />, color: 'cyan', endpoint: 'POST /api/audit/perform' },
  { id: 'poc', title: 'Verification Evidence Generation', description: 'Generate Foundry verification code', icon: <Zap size={20} />, color: 'amber', endpoint: 'POST /api/poc/generate' },
  { id: 'arbitration', title: 'Arbitration Evaluate', description: 'AI committee vote reasoning', icon: <Shield size={20} />, color: 'violet', endpoint: 'POST /api/arbitration/evaluate' },
  { id: 'score', title: 'Review Scoring', description: 'Compute verification score', icon: <BarChart3 size={20} />, color: 'emerald', endpoint: 'POST /api/audit/score' },
  { id: 'sandbox', title: 'Sandbox Replay', description: 'Run verification evidence in isolated Foundry env', icon: <Play size={20} />, color: 'rose', endpoint: 'POST /api/sandbox/replay' },
  { id: 'pickup', title: 'Participant Task Pickup', description: 'Full review pipeline with state roots', icon: <Cpu size={20} />, color: 'blue', endpoint: 'POST /api/agent/pickup-task' },
];

export default function AgentOpsPage() {
  useOutletContext<ReturnType<typeof useWallet>>();
  const agentApi = useAgentApi();
  const { addToast } = useToast();
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);

  // Audit state
  const [auditCodeHash, setAuditCodeHash] = useState('');
  const [auditSource, setAuditSource] = useState('');
  const [auditConstraints, setAuditConstraints] = useState('');
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);

  // PoC state
  const [pocVulnType, setPocVulnType] = useState('');
  const [pocTarget, setPocTarget] = useState('');
  const [pocDesc, setPocDesc] = useState('');
  const [pocResult, setPocResult] = useState<PoCResult | null>(null);

  // Arbitration state
  const [arbTaskId, setArbTaskId] = useState('');
  const [arbStateRoot, setArbStateRoot] = useState('');
  const [arbChalDesc, setArbChalDesc] = useState('');
  const [arbPocCid, setArbPocCid] = useState('');
  const [arbResult, setArbResult] = useState<ArbitrationVote | null>(null);

  // Score state
  const [scoreTaskId, setScoreTaskId] = useState('');
  const [scoreStateRoot, setScoreStateRoot] = useState('');
  const [scoreEvCids, setScoreEvCids] = useState('');
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);

  // Sandbox state
  const [sbPocCode, setSbPocCode] = useState('');
  const [sbContract, setSbContract] = useState('');
  const [sbForkRpc, setSbForkRpc] = useState('');
  const [sbForkBlock, setSbForkBlock] = useState('');
  const [sbResult, setSbResult] = useState<SandboxReplayResult | null>(null);

  // Pickup state
  const [pickupTaskId, setPickupTaskId] = useState('');
  const [pickupSource, setPickupSource] = useState('');
  const [pickupResult, setPickupResult] = useState<TaskPickupResult | null>(null);

  const handleAudit = async () => {
    const constraints = auditConstraints ? auditConstraints.split(',').map(s => s.trim()) : undefined;
    const result = await agentApi.performAudit(auditCodeHash, auditSource || undefined, constraints);
    if (result) { setAuditResult(result); addToast('Review complete', 'success'); }
  };

  const handlePoC = async () => {
    const result = await agentApi.generatePoC(pocVulnType, pocTarget, pocDesc);
    if (result) { setPocResult(result); addToast('Verification evidence generated', 'success'); }
  };

  const handleArbitration = async () => {
    const result = await agentApi.evaluateArbitration(parseInt(arbTaskId), arbStateRoot, arbChalDesc, arbPocCid || undefined);
    if (result) { setArbResult(result); addToast(`Vote: ${result.vote}`, 'success'); }
  };

  const handleScore = async () => {
    const cids = scoreEvCids ? scoreEvCids.split(',').map(s => s.trim()) : [];
    const result = await agentApi.scoreAudit(parseInt(scoreTaskId), scoreStateRoot, cids);
    if (result) { setScoreResult(result); addToast(`Score: ${result.score}/100`, 'success'); }
  };

  const handleSandbox = async () => {
    const result = await agentApi.replaySandbox(sbPocCode, sbContract, sbForkRpc || undefined, sbForkBlock ? parseInt(sbForkBlock) : undefined);
    if (result) { setSbResult(result); addToast(`Verdict: ${result.verdict}`, result.verdict === 'CHALLENGE_UPHELD' ? 'warning' : 'success'); }
  };

  const handlePickup = async () => {
    const result = await agentApi.pickupTask(parseInt(pickupTaskId), pickupSource);
    if (result) { setPickupResult(result); addToast(`Recommendation: ${result.recommendation}`, 'success'); }
  };

  const colorMap: Record<string, string> = {
    cyan: 'from-[#0071e3]/10 to-[#0071e3]/5 border-[#0071e3]/20 text-[#0071e3]',
    amber: 'from-[#ff9f0a]/10 to-[#ff9f0a]/5 border-[#ff9f0a]/20 text-[#ff9f0a]',
    violet: 'from-purple-500/10 to-purple-500/5 border-purple-500/20 text-purple-600',
    emerald: 'from-[#34c759]/10 to-[#34c759]/5 border-[#34c759]/20 text-[#34c759]',
    rose: 'from-[#ff3b30]/10 to-[#ff3b30]/5 border-[#ff3b30]/20 text-[#ff3b30]',
    blue: 'from-[#0071e3]/10 to-[#0071e3]/5 border-[#0071e3]/20 text-[#0071e3]',
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h2 className="section-title">AI Review Operations</h2>
          <p className="text-[15px] text-[#6e6e73] mt-1">Direct access to all backend AI endpoints</p>
        </div>

        {/* Backend status */}
        <BackendStatusBar />

        {/* Operation panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {panels.map((panel) => (
            <motion.button
              key={panel.id}
              onClick={() => setActivePanel(activePanel === panel.id ? null : panel.id)}
              className={`card-hover text-left cursor-pointer group ${activePanel === panel.id ? 'ring-2 ring-[#0071e3]/20' : ''}`}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${colorMap[panel.color]} border flex items-center justify-center`}>
                  {panel.icon}
                </div>
                <ChevronDown size={16} className={`text-[#86868b] transition-transform ${activePanel === panel.id ? 'rotate-180' : ''}`} />
              </div>
              <h3 className="font-semibold text-[#1d1d1f] mt-3">{panel.title}</h3>
              <p className="text-xs text-[#86868b] mt-1">{panel.description}</p>
              <code className="text-[10px] text-[#86868b] mt-2 block font-mono">{panel.endpoint}</code>
            </motion.button>
          ))}
        </div>

        {/* Active panel form */}
        <AnimatePresence mode="wait">
          {activePanel && (
            <motion.div
              key={activePanel}
              initial={{ opacity: 0, y: 20, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              transition={{ duration: 0.3 }}
              className="card space-y-4"
            >
              {activePanel === 'audit' && (
                <AuditPanel
                  codeHash={auditCodeHash} setCodeHash={setAuditCodeHash}
                  source={auditSource} setSource={setAuditSource}
                  constraints={auditConstraints} setConstraints={setAuditConstraints}
                  onSubmit={handleAudit} loading={agentApi.loading}
                  result={auditResult}
                />
              )}
              {activePanel === 'poc' && (
                <PoCPanel
                  vulnType={pocVulnType} setVulnType={setPocVulnType}
                  target={pocTarget} setTarget={setPocTarget}
                  desc={pocDesc} setDesc={setPocDesc}
                  onSubmit={handlePoC} loading={agentApi.loading}
                  result={pocResult}
                />
              )}
              {activePanel === 'arbitration' && (
                <ArbitrationPanel
                  taskId={arbTaskId} setTaskId={setArbTaskId}
                  stateRoot={arbStateRoot} setStateRoot={setArbStateRoot}
                  chalDesc={arbChalDesc} setChalDesc={setArbChalDesc}
                  pocCid={arbPocCid} setPocCid={setArbPocCid}
                  onSubmit={handleArbitration} loading={agentApi.loading}
                  result={arbResult}
                />
              )}
              {activePanel === 'score' && (
                <ScorePanel
                  taskId={scoreTaskId} setTaskId={setScoreTaskId}
                  stateRoot={scoreStateRoot} setStateRoot={setScoreStateRoot}
                  evCids={scoreEvCids} setEvCids={setScoreEvCids}
                  onSubmit={handleScore} loading={agentApi.loading}
                  result={scoreResult}
                />
              )}
              {activePanel === 'sandbox' && (
                <SandboxPanel
                  pocCode={sbPocCode} setPocCode={setSbPocCode}
                  contract={sbContract} setContract={setSbContract}
                  forkRpc={sbForkRpc} setForkRpc={setSbForkRpc}
                  forkBlock={sbForkBlock} setForkBlock={setSbForkBlock}
                  onSubmit={handleSandbox} loading={agentApi.loading}
                  result={sbResult}
                />
              )}
              {activePanel === 'pickup' && (
                <PickupPanel
                  taskId={pickupTaskId} setTaskId={setPickupTaskId}
                  source={pickupSource} setSource={setPickupSource}
                  onSubmit={handlePickup} loading={agentApi.loading}
                  result={pickupResult}
                />
              )}
              {agentApi.error && (
                <div className="flex items-center gap-2 p-4 rounded-2xl bg-[#ff3b30]/5">
                  <AlertTriangle size={14} className="text-[#ff3b30]" />
                  <span className="text-sm text-[#ff3b30]">{agentApi.error}</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}

function BackendStatusBar() {
  const { getHealth, getConfig } = useAgentApi();
  const [health, setHealth] = useState<{ status: string; agent_loaded: boolean } | null>(null);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  useState(() => {
    getHealth().then(setHealth);
    getConfig().then(setConfig);
  });

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${health ? 'bg-[#34c759]' : 'bg-[#ff3b30]'}`} />
            <span className="text-sm text-[#1d1d1f]">Backend: {health?.status || 'Offline'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Cpu size={14} className={health?.agent_loaded ? 'text-[#34c759]' : 'text-[#86868b]'} />
            <span className="text-sm text-[#6e6e73]">AI Agent: {health?.agent_loaded ? 'Ready' : 'Not loaded'}</span>
          </div>
        </div>
        <button onClick={() => setShowConfig(!showConfig)} className="text-xs text-[#86868b] hover:text-[#1d1d1f] transition-colors">
          {showConfig ? 'Hide Config' : 'Show Config'}
        </button>
      </div>
      <AnimatePresence>
        {showConfig && config && (
          <motion.pre
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="text-xs text-[#6e6e73] mt-3 overflow-auto max-h-60 font-mono bg-[#f5f5f7] rounded-2xl p-3"
          >
            {JSON.stringify(config, null, 2)}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}

function SubmitButton({ loading, label, onClick }: { loading: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
      {loading ? <><Loader2 size={16} className="animate-spin" /> Running...</> : label}
    </button>
  );
}

function ResultBlock({ data, title }: { data: unknown; title: string }) {
  if (!data) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-4 rounded-2xl bg-[#f5f5f7]">
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle size={14} className="text-[#34c759]" />
        <span className="text-sm font-medium text-[#1d1d1f]">{title}</span>
      </div>
      <pre className="text-xs text-[#6e6e73] overflow-auto max-h-80 font-mono whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
    </motion.div>
  );
}

function AuditPanel({ codeHash, setCodeHash, source, setSource, constraints, setConstraints, onSubmit, loading, result }: {
  codeHash: string; setCodeHash: (v: string) => void;
  source: string; setSource: (v: string) => void;
  constraints: string; setConstraints: (v: string) => void;
  onSubmit: () => void; loading: boolean;
  result: AuditResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Brain size={18} className="text-[#0071e3]" /> Quality Review</h3>
      <div>
        <label className="label">Code Hash</label>
        <input type="text" value={codeHash} onChange={e => setCodeHash(e.target.value)} className="input font-mono" placeholder="0x..." />
      </div>
      <div>
        <label className="label">Source Code (Solidity)</label>
        <textarea value={source} onChange={e => setSource(e.target.value)} className="input h-40 resize-y font-mono text-xs" placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.0;&#10;..." />
      </div>
      <div>
        <label className="label">Constraints (comma-separated)</label>
        <input type="text" value={constraints} onChange={e => setConstraints(e.target.value)} className="input" placeholder="no-reentrancy, no-oracle-manipulation" />
      </div>
      <SubmitButton loading={loading} label="Run Review" onClick={onSubmit} />
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="badge-blue">Severity: {result.severity_score}/100</span>
            <span className="badge bg-purple-500/10 text-purple-600">{result.vulnerabilities?.length || 0} issues</span>
          </div>
          {result.vulnerabilities && result.vulnerabilities.length > 0 && (
            <div className="space-y-2">
              {result.vulnerabilities.map((v, i) => (
                <div key={i} className="p-3 rounded-2xl bg-[#f5f5f7]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${v.severity === 'critical' ? 'bg-[#ff3b30]/10 text-[#ff3b30]' : v.severity === 'high' ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]' : 'bg-[#ff9f0a]/10 text-[#ff9f0a]'}`}>
                      {v.severity}
                    </span>
                    <span className="text-sm font-medium text-[#1d1d1f]">{v.type}</span>
                  </div>
                  <p className="text-xs text-[#6e6e73]">{v.description}</p>
                  {v.location && <p className="text-xs text-[#86868b] font-mono mt-1">{v.location}</p>}
                </div>
              ))}
            </div>
          )}
          <ResultBlock data={{ state_root: result.state_root, evidence_root: result.evidence_root, trace_root: result.trace_root }} title="State Roots" />
        </div>
      )}
    </div>
  );
}

function PoCPanel({ vulnType, setVulnType, target, setTarget, desc, setDesc, onSubmit, loading, result }: {
  vulnType: string; setVulnType: (v: string) => void;
  target: string; setTarget: (v: string) => void;
  desc: string; setDesc: (v: string) => void;
  onSubmit: () => void; loading: boolean;
  result: PoCResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Zap size={18} className="text-[#ff9f0a]" /> Verification Evidence Generation</h3>
      <div>
        <label className="label">Issue Type</label>
        <select value={vulnType} onChange={e => setVulnType(e.target.value)} className="input">
          <option value="">Select type...</option>
          <option value="reentrancy">Reentrancy</option>
          <option value="oracle-manipulation">Oracle Manipulation</option>
          <option value="flash-loan">Flash Loan Attack</option>
          <option value="access-control">Access Control</option>
          <option value="integer-overflow">Integer Overflow</option>
          <option value="front-running">Front-Running</option>
        </select>
      </div>
      <div>
        <label className="label">Target Assignment Code (Solidity)</label>
        <textarea value={target} onChange={e => setTarget(e.target.value)} className="input h-32 resize-y font-mono text-xs" placeholder="contract Target { ... }" />
      </div>
      <div>
        <label className="label">Issue Description</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} className="input h-20 resize-y" placeholder="Describe the issue..." />
      </div>
      <SubmitButton loading={loading} label="Generate Verification Evidence" onClick={onSubmit} />
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className={result.compilation_success ? 'badge-green' : 'badge-red'}>
              {result.compilation_success ? 'Compiles' : 'Compilation Failed'}
            </span>
            <span className="badge-orange">{result.exploit_type}</span>
          </div>
          <div className="p-3 rounded-2xl bg-[#f5f5f7]">
            <pre className="text-xs text-[#1d1d1f] overflow-auto max-h-60 font-mono whitespace-pre-wrap">{result.poc_code}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ArbitrationPanel({ taskId, setTaskId, stateRoot, setStateRoot, chalDesc, setChalDesc, pocCid, setPocCid, onSubmit, loading, result }: {
  taskId: string; setTaskId: (v: string) => void;
  stateRoot: string; setStateRoot: (v: string) => void;
  chalDesc: string; setChalDesc: (v: string) => void;
  pocCid: string; setPocCid: (v: string) => void;
  onSubmit: () => void; loading: boolean;
  result: ArbitrationVote | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Shield size={18} className="text-purple-600" /> Arbitration Evaluate</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Task ID</label>
          <input type="number" value={taskId} onChange={e => setTaskId(e.target.value)} className="input" placeholder="1" />
        </div>
        <div>
          <label className="label">Verification Evidence CID (optional)</label>
          <input type="text" value={pocCid} onChange={e => setPocCid(e.target.value)} className="input font-mono" placeholder="Qm..." />
        </div>
      </div>
      <div>
        <label className="label">Proposal State Root</label>
        <input type="text" value={stateRoot} onChange={e => setStateRoot(e.target.value)} className="input font-mono" placeholder="0x..." />
      </div>
      <div>
        <label className="label">Dispute Description</label>
        <textarea value={chalDesc} onChange={e => setChalDesc(e.target.value)} className="input h-20 resize-y" placeholder="Describe the dispute..." />
      </div>
      <SubmitButton loading={loading} label="Evaluate" onClick={onSubmit} />
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className={result.vote === 'uphold' ? 'badge-red' : 'badge-green'}>
              Vote: {result.vote.toUpperCase()}
            </span>
            <span className="badge-blue">Confidence: {(result.confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="p-3 rounded-2xl bg-[#f5f5f7]">
            <p className="text-sm text-[#1d1d1f]">{result.reasoning}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ScorePanel({ taskId, setTaskId, stateRoot, setStateRoot, evCids, setEvCids, onSubmit, loading, result }: {
  taskId: string; setTaskId: (v: string) => void;
  stateRoot: string; setStateRoot: (v: string) => void;
  evCids: string; setEvCids: (v: string) => void;
  onSubmit: () => void; loading: boolean;
  result: ScoreResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><BarChart3 size={18} className="text-[#34c759]" /> Review Scoring</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Task ID</label>
          <input type="number" value={taskId} onChange={e => setTaskId(e.target.value)} className="input" placeholder="1" />
        </div>
        <div>
          <label className="label">Evidence CIDs (comma-separated)</label>
          <input type="text" value={evCids} onChange={e => setEvCids(e.target.value)} className="input font-mono" placeholder="Qm..., Qm..." />
        </div>
      </div>
      <div>
        <label className="label">Proposal State Root</label>
        <input type="text" value={stateRoot} onChange={e => setStateRoot(e.target.value)} className="input font-mono" placeholder="0x..." />
      </div>
      <button type="button" onClick={onSubmit} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
        {loading ? <><Loader2 size={16} className="animate-spin" /> Scoring...</> : 'Compute Score'}
      </button>
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#f5f5f7]" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeDasharray={`${result.score * 0.975} 97.5`}
                  className={result.score >= 70 ? 'text-[#34c759]' : result.score >= 40 ? 'text-[#ff9f0a]' : 'text-[#ff3b30]'}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-[#1d1d1f]">{result.score}</span>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[#1d1d1f] mb-2">{result.reasoning}</p>
              {result.dimensions && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(result.dimensions).map(([key, val]) => (
                    <span key={key} className="text-xs bg-[#f5f5f7] px-2 py-1 rounded-lg text-[#6e6e73]">
                      {key}: <span className="text-[#1d1d1f] font-medium">{val}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SandboxPanel({ pocCode, setPocCode, contract, setContract, forkRpc, setForkRpc, forkBlock, setForkBlock, onSubmit, loading, result }: {
  pocCode: string; setPocCode: (v: string) => void;
  contract: string; setContract: (v: string) => void;
  forkRpc: string; setForkRpc: (v: string) => void;
  forkBlock: string; setForkBlock: (v: string) => void;
  onSubmit: () => void; loading: boolean;
  result: SandboxReplayResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Play size={18} className="text-[#ff3b30]" /> Sandbox Replay</h3>
      <div>
        <label className="label">Verification Evidence Code (Foundry test)</label>
        <textarea value={pocCode} onChange={e => setPocCode(e.target.value)} className="input h-40 resize-y font-mono text-xs" placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.0;&#10;import &quot;forge-std/Test.sol&quot;;&#10;..." />
      </div>
      <div>
        <label className="label">Assignment Source</label>
        <textarea value={contract} onChange={e => setContract(e.target.value)} className="input h-32 resize-y font-mono text-xs" placeholder="contract Target { ... }" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Fork RPC (optional)</label>
          <input type="text" value={forkRpc} onChange={e => setForkRpc(e.target.value)} className="input font-mono text-xs" placeholder="http://127.0.0.1:8545" />
        </div>
        <div>
          <label className="label">Fork Block (optional)</label>
          <input type="number" value={forkBlock} onChange={e => setForkBlock(e.target.value)} className="input font-mono text-xs" placeholder="latest" />
        </div>
      </div>
      <button type="button" onClick={onSubmit} disabled={loading || !pocCode || !contract} className="btn-primary w-full flex items-center justify-center gap-2">
        {loading ? <><Loader2 size={16} className="animate-spin" /> Replaying...</> : 'Run Replay'}
      </button>
      {result && (
        <div className={`p-4 rounded-2xl ${result.verdict === 'CHALLENGE_UPHELD' ? 'bg-[#ff3b30]/5' : 'bg-[#34c759]/5'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-sm font-bold ${result.verdict === 'CHALLENGE_UPHELD' ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>
              {result.verdict}
            </span>
            <span className="text-xs text-[#86868b]">Exit code: {result.exit_code}</span>
          </div>
          <p className="text-xs text-[#1d1d1f] mb-2">{result.reason}</p>
          <p className="text-xs text-[#86868b] font-mono break-all">Trace: {result.replay_trace_hash}</p>
          {result.output && (
            <details className="mt-2">
              <summary className="text-xs text-[#86868b] cursor-pointer hover:text-[#1d1d1f]">Show forge output</summary>
              <pre className="text-xs text-[#6e6e73] mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono bg-[#f5f5f7] p-2 rounded-xl">{result.output}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function PickupPanel({ taskId, setTaskId, source, setSource, onSubmit, loading, result }: {
  taskId: string; setTaskId: (v: string) => void;
  source: string; setSource: (v: string) => void;
  onSubmit: () => void; loading: boolean;
  result: TaskPickupResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Cpu size={18} className="text-[#0071e3]" /> Participant Task Pickup</h3>
      <p className="text-xs text-[#86868b]">Runs the full review pipeline: issue analysis, state root computation, and recommendation.</p>
      <div>
        <label className="label">Task ID</label>
        <input type="number" value={taskId} onChange={e => setTaskId(e.target.value)} className="input" placeholder="1" />
      </div>
      <div>
        <label className="label">Source Code (Solidity)</label>
        <textarea value={source} onChange={e => setSource(e.target.value)} className="input h-40 resize-y font-mono text-xs" placeholder="// Full contract source code..." />
      </div>
      <button type="button" onClick={onSubmit} disabled={loading || !source} className="btn-primary w-full flex items-center justify-center gap-2">
        {loading ? <><Loader2 size={16} className="animate-spin" /> Running Pipeline...</> : 'Run Full Review Pipeline'}
      </button>
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={result.recommendation === 'propose' ? 'badge-green' : 'badge-orange'}>
              Recommendation: {result.recommendation}
            </span>
            <span className="badge-blue">Confidence: {(result.confidence * 100).toFixed(0)}%</span>
            <span className="badge bg-purple-500/10 text-purple-600">Severity: {result.severity_score}/100</span>
          </div>
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="p-2 rounded-xl bg-[#f5f5f7] font-mono">
              <span className="text-[#86868b]">state_root:</span> <span className="text-[#1d1d1f] break-all">{result.state_root}</span>
            </div>
            <div className="p-2 rounded-xl bg-[#f5f5f7] font-mono">
              <span className="text-[#86868b]">evidence_root:</span> <span className="text-[#1d1d1f] break-all">{result.evidence_root}</span>
            </div>
            <div className="p-2 rounded-xl bg-[#f5f5f7] font-mono">
              <span className="text-[#86868b]">trace_root:</span> <span className="text-[#1d1d1f] break-all">{result.trace_root}</span>
            </div>
          </div>
          {result.vulnerabilities && result.vulnerabilities.length > 0 && (
            <div className="p-3 rounded-2xl bg-[#f5f5f7]">
              <p className="text-xs text-[#6e6e73] mb-1">{result.vulnerabilities.length} issues found</p>
              <pre className="text-xs text-[#86868b] font-mono overflow-auto max-h-40">{JSON.stringify(result.vulnerabilities, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
