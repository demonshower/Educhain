import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Zap, Shield, BarChart3, Play, Cpu,
  ChevronDown, CheckCircle, AlertTriangle, Loader2,
  Search, Users, Vote, CheckCircle2, Scale, Wrench
} from 'lucide-react';
import { useAgentApi, type SandboxReplayResult, type TaskPickupResult } from '../hooks/useAgentApi';
import { useArbitration } from '../hooks/useArbitration';
import { useTransactions } from '../contexts/TransactionContext';
import { useToast } from '../contexts/ToastContext';
import { shortenAddress } from '../lib/utils';
import ProgressRing from '../components/ui/ProgressRing';
import PageTransition from '../components/ui/PageTransition';
import type { AuditResult, PoCResult, ArbitrationVote, ScoreResult } from '../types';
import { cn } from '../lib/cn';
import type { useWallet } from '../hooks/useWallet';

type TabId = 'ai-ops' | 'arbitration';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'ai-ops', label: 'AI 操作', icon: <Wrench size={15} /> },
  { id: 'arbitration', label: '仲裁', icon: <Scale size={15} /> },
];

export default function OperationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('ai-ops');
  const wallet = useOutletContext<ReturnType<typeof useWallet>>();

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-4xl font-bold text-[#1d1d1f] tracking-tight">学术诚信操作台</h2>
            <p className="text-lg text-[#86868b] mt-1">AI 作业评审、抄袭验证、争议仲裁与评分管理</p>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 p-1 bg-[#f5f5f7] rounded-2xl w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                activeTab === tab.id
                  ? 'bg-white text-[#1d1d1f] shadow-apple-sm'
                  : 'text-[#6e6e73] hover:text-[#1d1d1f]'
              )}
            >
              {tab.icon}
              {tab.label}
              {activeTab === tab.id && (
                <motion.div layoutId="ops-tab" className="absolute inset-0 bg-white rounded-xl -z-10 shadow-apple-sm" transition={{ type: 'spring', stiffness: 400, damping: 35 }} />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {activeTab === 'ai-ops' && <AgentOpsTab />}
            {activeTab === 'arbitration' && <ArbitrationTab wallet={wallet} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}

/* ===========================  AI OPS TAB  =========================== */
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
  { id: 'audit', title: '质量评审', description: 'LLM 问题分析', icon: <Brain size={32} />, color: 'cyan', endpoint: '' },
  { id: 'poc', title: '验证证据生成', description: '生成可执行抄袭验证代码', icon: <Zap size={32} />, color: 'amber', endpoint: '' },
  { id: 'arbitration', title: '仲裁评估', description: 'AI 委员会投票推理', icon: <Shield size={32} />, color: 'violet', endpoint: '' },
  { id: 'score', title: '评审评分', description: '计算评审质量验证分', icon: <BarChart3 size={32} />, color: 'emerald', endpoint: '' },
  { id: 'sandbox', title: '沙箱重放', description: '在隔离环境中执行验证证据', icon: <Play size={32} />, color: 'rose', endpoint: '' },
  { id: 'pickup', title: 'AI 评审代理承接任务', description: '运行完整评审流水线', icon: <Cpu size={32} />, color: 'blue', endpoint: '' },
];

const colorMap: Record<string, string> = {
  cyan: 'from-[#0071e3]/10 to-[#0071e3]/5 border-[#0071e3]/20 text-[#0071e3]',
  amber: 'from-[#ff9f0a]/10 to-[#ff9f0a]/5 border-[#ff9f0a]/20 text-[#ff9f0a]',
  violet: 'from-purple-500/10 to-purple-500/5 border-purple-500/20 text-purple-600',
  emerald: 'from-[#34c759]/10 to-[#34c759]/5 border-[#34c759]/20 text-[#34c759]',
  rose: 'from-[#ff3b30]/10 to-[#ff3b30]/5 border-[#ff3b30]/20 text-[#ff3b30]',
  blue: 'from-[#0071e3]/10 to-[#0071e3]/5 border-[#0071e3]/20 text-[#0071e3]',
};

function AgentOpsTab() {
  const agentApi = useAgentApi();
  const { addToast } = useToast();
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);

  const [auditCodeHash, setAuditCodeHash] = useState('');
  const [auditSource, setAuditSource] = useState('');
  const [auditConstraints, setAuditConstraints] = useState('');
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);

  const [pocVulnType, setPocVulnType] = useState('');
  const [pocTarget, setPocTarget] = useState('');
  const [pocDesc, setPocDesc] = useState('');
  const [pocResult, setPocResult] = useState<PoCResult | null>(null);

  const [arbTaskId, setArbTaskId] = useState('');
  const [arbStateRoot, setArbStateRoot] = useState('');
  const [arbChalDesc, setArbChalDesc] = useState('');
  const [arbPocCid, setArbPocCid] = useState('');
  const [arbResult, setArbResult] = useState<ArbitrationVote | null>(null);

  const [scoreTaskId, setScoreTaskId] = useState('');
  const [scoreStateRoot, setScoreStateRoot] = useState('');
  const [scoreEvCids, setScoreEvCids] = useState('');
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);

  const [sbPocCode, setSbPocCode] = useState('');
  const [sbContract, setSbContract] = useState('');
  const [sbForkRpc, setSbForkRpc] = useState('');
  const [sbForkBlock, setSbForkBlock] = useState('');
  const [sbResult, setSbResult] = useState<SandboxReplayResult | null>(null);

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

  return (
    <div className="space-y-10">
      <div>
        <h3 className="text-4xl font-bold text-[#1d1d1f]">AI 评审代理操作</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {panels.map((panel) => (
          <motion.button
            key={panel.id}
            onClick={() => setActivePanel(activePanel === panel.id ? null : panel.id)}
            className={`card-hover text-left cursor-pointer group p-7 ${activePanel === panel.id ? 'ring-2 ring-[#0071e3]/20' : ''}`}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="flex items-start justify-between">
              <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${colorMap[panel.color]} border flex items-center justify-center`}>
                {panel.icon}
              </div>
              <ChevronDown size={22} className={`text-[#86868b] transition-transform ${activePanel === panel.id ? 'rotate-180' : ''}`} />
            </div>
              <h3 className="font-semibold text-[#1d1d1f] mt-6 text-2xl">{panel.title}</h3>
              <p className="text-lg text-[#86868b] mt-2">{panel.description}</p>
          </motion.button>
        ))}
      </div>

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
              <AuditPanel codeHash={auditCodeHash} setCodeHash={setAuditCodeHash} source={auditSource} setSource={setAuditSource} constraints={auditConstraints} setConstraints={setAuditConstraints} onSubmit={handleAudit} loading={agentApi.loading} result={auditResult} />
            )}
            {activePanel === 'poc' && (
              <PoCPanel vulnType={pocVulnType} setVulnType={setPocVulnType} target={pocTarget} setTarget={setPocTarget} desc={pocDesc} setDesc={setPocDesc} onSubmit={handlePoC} loading={agentApi.loading} result={pocResult} />
            )}
            {activePanel === 'arbitration' && (
              <ArbitrationEvalPanel taskId={arbTaskId} setTaskId={setArbTaskId} stateRoot={arbStateRoot} setStateRoot={setArbStateRoot} chalDesc={arbChalDesc} setChalDesc={setArbChalDesc} pocCid={arbPocCid} setPocCid={setArbPocCid} onSubmit={handleArbitration} loading={agentApi.loading} result={arbResult} />
            )}
            {activePanel === 'score' && (
              <ScorePanel taskId={scoreTaskId} setTaskId={setScoreTaskId} stateRoot={scoreStateRoot} setStateRoot={setScoreStateRoot} evCids={scoreEvCids} setEvCids={setScoreEvCids} onSubmit={handleScore} loading={agentApi.loading} result={scoreResult} />
            )}
            {activePanel === 'sandbox' && (
              <SandboxPanel pocCode={sbPocCode} setPocCode={setSbPocCode} contract={sbContract} setContract={setSbContract} forkRpc={sbForkRpc} setForkRpc={setSbForkRpc} forkBlock={sbForkBlock} setForkBlock={setSbForkBlock} onSubmit={handleSandbox} loading={agentApi.loading} result={sbResult} />
            )}
            {activePanel === 'pickup' && (
              <PickupPanel taskId={pickupTaskId} setTaskId={setPickupTaskId} source={pickupSource} setSource={setPickupSource} onSubmit={handlePickup} loading={agentApi.loading} result={pickupResult} />
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
  );
}

function SubmitButton({ loading, label, onClick }: { loading: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
      {loading ? <><Loader2 size={16} className="animate-spin" /> 运行中...</> : label}
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
      <pre className="text-xs text-[#6e6e73] overflow-auto max-h-80 font-mono whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
    </motion.div>
  );
}

function AuditPanel({ codeHash, setCodeHash, source, setSource, constraints, setConstraints, onSubmit, loading, result }: {
  codeHash: string; setCodeHash: (v: string) => void; source: string; setSource: (v: string) => void;
  constraints: string; setConstraints: (v: string) => void; onSubmit: () => void; loading: boolean; result: AuditResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Brain size={18} className="text-[#0071e3]" /> 质量评审</h3>
      <div><label className="label">作业编号</label><input type="text" value={codeHash} onChange={e => setCodeHash(e.target.value)} className="input font-mono" placeholder="0x..." /></div>
      <div><label className="label">作业源码</label><textarea value={source} onChange={e => setSource(e.target.value)} className="input h-40 resize-y font-mono text-xs" placeholder={`# 请在此粘贴学生提交的作业代码&#10;# 例如：Python 冒泡排序&#10;&#10;def bubble_sort(arr):&#10;    n = len(arr)&#10;    for i in range(n):&#10;        for j in range(n - i - 1):&#10;            if arr[j] > arr[j + 1]:&#10;                arr[j], arr[j + 1] = arr[j + 1], arr[j]&#10;    return arr`} /></div>
      <div><label className="label">评分要求（逗号分隔）</label><input type="text" value={constraints} onChange={e => setConstraints(e.target.value)} className="input" placeholder="功能正确, 代码规范, 文档完整, 无抄袭" /></div>
      <SubmitButton loading={loading} label="运行评审" onClick={onSubmit} />
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
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${v.severity === 'critical' ? 'bg-[#ff3b30]/10 text-[#ff3b30]' : 'bg-[#ff9f0a]/10 text-[#ff9f0a]'}`}>{v.severity}</span>
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
  vulnType: string; setVulnType: (v: string) => void; target: string; setTarget: (v: string) => void;
  desc: string; setDesc: (v: string) => void; onSubmit: () => void; loading: boolean; result: PoCResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Zap size={18} className="text-[#ff9f0a]" /> 验证证据生成</h3>
      <div>
        <label className="label">问题类型</label>
        <select value={vulnType} onChange={e => setVulnType(e.target.value)} className="input">
          <option value="">选择类型...</option>
          <option value="plagiarism">疑似抄袭</option>
          <option value="logic-error">逻辑错误</option>
          <option value="incomplete">功能不完整</option>
          <option value="constraint-violation">违反作业要求</option>
          <option value="code-quality">代码质量差</option>
          <option value="documentation">文档缺失</option>
        </select>
      </div>
      <div><label className="label">目标作业代码</label><textarea value={target} onChange={e => setTarget(e.target.value)} className="input h-32 resize-y font-mono text-xs" placeholder={`def bubble_sort(arr):&#10;    n = len(arr)&#10;    for i in range(n):&#10;        for j in range(n - i - 1):&#10;            if arr[j] > arr[j+1]:&#10;                arr[j], arr[j+1] = arr[j+1], arr[j]&#10;    return arr`} /></div>
      <div><label className="label">问题描述</label><textarea value={desc} onChange={e => setDesc(e.target.value)} className="input h-20 resize-y" placeholder="描述问题..." /></div>
      <SubmitButton loading={loading} label="生成验证证据" onClick={onSubmit} />
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className={result.compilation_success ? 'badge-green' : 'badge-red'}>{result.compilation_success ? 'Compiles' : 'Compilation Failed'}</span>
            <span className="badge-orange">{result.exploit_type}</span>
          </div>
          <div className="p-3 rounded-2xl bg-[#f5f5f7]"><pre className="text-xs text-[#1d1d1f] overflow-auto max-h-60 font-mono whitespace-pre-wrap">{result.poc_code}</pre></div>
        </div>
      )}
    </div>
  );
}

function ArbitrationEvalPanel({ taskId, setTaskId, stateRoot, setStateRoot, chalDesc, setChalDesc, pocCid, setPocCid, onSubmit, loading, result }: {
  taskId: string; setTaskId: (v: string) => void; stateRoot: string; setStateRoot: (v: string) => void;
  chalDesc: string; setChalDesc: (v: string) => void; pocCid: string; setPocCid: (v: string) => void;
  onSubmit: () => void; loading: boolean; result: ArbitrationVote | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Shield size={18} className="text-purple-600" /> 仲裁评估</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="label">任务 ID</label><input type="number" value={taskId} onChange={e => setTaskId(e.target.value)} className="input" placeholder="1" /></div>
        <div><label className="label">验证证据 CID（可选）</label><input type="text" value={pocCid} onChange={e => setPocCid(e.target.value)} className="input font-mono" placeholder="Qm..." /></div>
      </div>
      <div><label className="label">提案状态根</label><input type="text" value={stateRoot} onChange={e => setStateRoot(e.target.value)} className="input font-mono" placeholder="0x..." /></div>
      <div><label className="label">争议描述</label><textarea value={chalDesc} onChange={e => setChalDesc(e.target.value)} className="input h-20 resize-y" placeholder="描述争议内容..." /></div>
      <SubmitButton loading={loading} label="评估" onClick={onSubmit} />
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className={result.vote === 'uphold' ? 'badge-red' : 'badge-green'}>裁决：{result.vote === 'uphold' ? '争议成立' : '争议驳回'}</span>
            <span className="badge-blue">置信度：{(result.confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="p-3 rounded-2xl bg-[#f5f5f7]"><p className="text-sm text-[#1d1d1f]">{result.reasoning}</p></div>
        </div>
      )}
    </div>
  );
}

function ScorePanel({ taskId, setTaskId, stateRoot, setStateRoot, evCids, setEvCids, onSubmit, loading, result }: {
  taskId: string; setTaskId: (v: string) => void; stateRoot: string; setStateRoot: (v: string) => void;
  evCids: string; setEvCids: (v: string) => void; onSubmit: () => void; loading: boolean; result: ScoreResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><BarChart3 size={18} className="text-[#34c759]" /> 评审评分</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="label">任务 ID</label><input type="number" value={taskId} onChange={e => setTaskId(e.target.value)} className="input" placeholder="1" /></div>
        <div><label className="label">证据 CID（逗号分隔）</label><input type="text" value={evCids} onChange={e => setEvCids(e.target.value)} className="input font-mono" placeholder="Qm..., Qm..." /></div>
      </div>
      <div><label className="label">提案状态根</label><input type="text" value={stateRoot} onChange={e => setStateRoot(e.target.value)} className="input font-mono" placeholder="0x..." /></div>
      <SubmitButton loading={loading} label="计算评分" onClick={onSubmit} />
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#f5f5f7]" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={`${result.score * 0.975} 97.5`} className={result.score >= 70 ? 'text-[#34c759]' : result.score >= 40 ? 'text-[#ff9f0a]' : 'text-[#ff3b30]'} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-[#1d1d1f]">{result.score}</span>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[#1d1d1f] mb-2">{result.reasoning}</p>
              {result.dimensions && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(result.dimensions).map(([key, val]) => (
                    <span key={key} className="text-xs bg-[#f5f5f7] px-2 py-1 rounded-lg text-[#6e6e73]">{key}: <span className="text-[#1d1d1f] font-medium">{val}</span></span>
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
  pocCode: string; setPocCode: (v: string) => void; contract: string; setContract: (v: string) => void;
  forkRpc: string; setForkRpc: (v: string) => void; forkBlock: string; setForkBlock: (v: string) => void;
  onSubmit: () => void; loading: boolean; result: SandboxReplayResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Play size={18} className="text-[#ff3b30]" /> 沙箱重放</h3>
      <div><label className="label">验证测试代码</label><textarea value={pocCode} onChange={e => setPocCode(e.target.value)} className="input h-40 resize-y font-mono text-xs" placeholder={`// 抄袭/错误验证测试代码&#10;// 用于在沙箱中运行比对验证&#10;&#10;import unittest&#10;&#10;class TestPlagiarism(unittest.TestCase):&#10;    def test_code_similarity(self):&#10;        # 验证两份代码的相似度是否超过阈值&#10;        self.assertTrue(check_similarity(code_a, code_b) > 0.8)`} /></div>
      <div><label className="label">作业源码</label><textarea value={contract} onChange={e => setContract(e.target.value)} className="input h-32 resize-y font-mono text-xs" placeholder={`def bubble_sort(arr):&#10;    n = len(arr)&#10;    for i in range(n):&#10;        for j in range(n - i - 1):&#10;            if arr[j] > arr[j+1]:&#10;                arr[j], arr[j+1] = arr[j+1], arr[j]&#10;    return arr`} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="label">Fork RPC（可选）</label><input type="text" value={forkRpc} onChange={e => setForkRpc(e.target.value)} className="input font-mono text-xs" placeholder="http://127.0.0.1:8545" /></div>
        <div><label className="label">Fork 区块（可选）</label><input type="number" value={forkBlock} onChange={e => setForkBlock(e.target.value)} className="input font-mono text-xs" placeholder="latest" /></div>
      </div>
      <button type="button" onClick={onSubmit} disabled={loading || !pocCode || !contract} className="btn-primary w-full flex items-center justify-center gap-2">
        {loading ? <><Loader2 size={16} className="animate-spin" /> 重放中...</> : '运行重放'}
      </button>
      {result && (
        <div className={`p-4 rounded-2xl ${result.verdict === 'CHALLENGE_UPHELD' ? 'bg-[#ff3b30]/5' : 'bg-[#34c759]/5'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-sm font-bold ${result.verdict === 'CHALLENGE_UPHELD' ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>{result.verdict}</span>
            <span className="text-xs text-[#86868b]">Exit code: {result.exit_code}</span>
          </div>
          <p className="text-xs text-[#1d1d1f] mb-2">{result.reason}</p>
          <p className="text-xs text-[#86868b] font-mono break-all">验证哈希: {result.replay_trace_hash}</p>
          {result.output && (
            <details className="mt-2">
              <summary className="text-xs text-[#86868b] cursor-pointer hover:text-[#1d1d1f]">查看验证输出</summary>
              <pre className="text-xs text-[#6e6e73] mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono bg-[#f5f5f7] p-2 rounded-xl">{result.output}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function PickupPanel({ taskId, setTaskId, source, setSource, onSubmit, loading, result }: {
  taskId: string; setTaskId: (v: string) => void; source: string; setSource: (v: string) => void;
  onSubmit: () => void; loading: boolean; result: TaskPickupResult | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg flex items-center gap-2 text-[#1d1d1f]"><Cpu size={18} className="text-[#0071e3]" /> AI 评审代理承接任务</h3>
      <p className="text-xs text-[#86868b]">运行完整评审流水线：问题分析、状态根计算与提案决策。</p>
      <div><label className="label">任务 ID</label><input type="number" value={taskId} onChange={e => setTaskId(e.target.value)} className="input" placeholder="1" /></div>
      <div><label className="label">学生作业源码</label><textarea value={source} onChange={e => setSource(e.target.value)} className="input h-40 resize-y font-mono text-xs" placeholder={`# 粘贴学生完整作业代码&#10;# AI 将自动运行完整评审流水线&#10;&#10;def bubble_sort(arr):&#10;    n = len(arr)&#10;    for i in range(n):&#10;        ...`} /></div>
      <button type="button" onClick={onSubmit} disabled={loading || !source} className="btn-primary w-full flex items-center justify-center gap-2">
        {loading ? <><Loader2 size={16} className="animate-spin" /> 流水线运行中...</> : '运行完整评审流水线'}
      </button>
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={result.recommendation === 'propose' ? 'badge-green' : 'badge-orange'}>Recommendation: {result.recommendation}</span>
            <span className="badge-blue">Confidence: {(result.confidence * 100).toFixed(0)}%</span>
            <span className="badge bg-purple-500/10 text-purple-600">Severity: {result.severity_score}/100</span>
          </div>
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="p-2 rounded-xl bg-[#f5f5f7] font-mono"><span className="text-[#86868b]">state_root:</span> <span className="text-[#1d1d1f] break-all">{result.state_root}</span></div>
            <div className="p-2 rounded-xl bg-[#f5f5f7] font-mono"><span className="text-[#86868b]">evidence_root:</span> <span className="text-[#1d1d1f] break-all">{result.evidence_root}</span></div>
            <div className="p-2 rounded-xl bg-[#f5f5f7] font-mono"><span className="text-[#86868b]">trace_root:</span> <span className="text-[#1d1d1f] break-all">{result.trace_root}</span></div>
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

/* ===========================  ARBITRATION TAB  =========================== */
const arbSteps = [
  { icon: <AlertTriangle size={16} />, label: '争议发起' },
  { icon: <Users size={16} />, label: '委员会选出' },
  { icon: <Vote size={16} />, label: '投票完成' },
  { icon: <CheckCircle2 size={16} />, label: '结果提交' },
];

function ArbitrationTab({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const arbitration = useArbitration({ provider: wallet.provider, signer: wallet.signer, chainId: wallet.chainId });
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

  const [pocCode, setPocCode] = useState('');
  const [contractSource, setContractSource] = useState('');
  const [forkRpc, setForkRpc] = useState('');
  const [forkBlock, setForkBlock] = useState('');
  const [replayResult, setReplayResult] = useState<SandboxReplayResult | null>(null);
  const [replaying, setReplaying] = useState(false);

  const committeeSize = committee.length;
  const quorumNeeded = Math.ceil(committeeSize * 0.67) || 1;
  const currentStep = committee.length === 0 ? 0 : signatures.length === 0 ? 1 : signatures.length >= quorumNeeded ? 3 : 2;

  const fetchCommittee = async () => {
    if (!taskId) return;
    setLoading(true); setError(null);
    try {
      const members = await arbitration.getCommittee(taskId);
      setCommittee(members);
      if (wallet.address) setIsMember(await arbitration.isCommitteeMember(taskId, wallet.address));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch committee');
      setCommittee([]);
    } finally { setLoading(false); }
  };

  const handleSelectCommittee = async () => {
    if (!taskId) return;
    setLoading(true); setError(null);
    try {
      const result = await arbitration.selectCommittee(taskId);
      if (wallet.provider) trackTx(result.hash, 'Select Committee', wallet.provider);
      await result.wait();
      addToast('Committee selected', 'success');
      await fetchCommittee();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to select committee');
    } finally { setLoading(false); }
  };

  const handleSignVote = async () => {
    if (!taskId || !replayTraceHash) { setError('Please enter replay trace hash'); return; }
    setSigning(true); setError(null);
    try {
      const signature = await arbitration.signVote(taskId, vote === 'uphold', replayTraceHash);
      setSignatures(prev => [...prev, { address: wallet.address!, signature }]);
      addToast('Vote signed successfully', 'success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign vote');
    } finally { setSigning(false); }
  };

  const handleSubmitResult = async () => {
    if (!taskId || signatures.length === 0) return;
    setSubmittingResult(true); setError(null);
    try {
      const sigs = signatures.map(s => s.signature);
      const result = await arbitration.submitResult(taskId, vote === 'uphold', replayTraceHash, sigs);
      if (wallet.provider) trackTx(result.hash, 'Submit Arbitration Result', wallet.provider);
      await result.wait();
      addToast('Arbitration result submitted on-chain', 'success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit result');
    } finally { setSubmittingResult(false); }
  };

  const handleRunReplay = async () => {
    if (!pocCode || !contractSource) { setError('PoC code and contract source are required'); return; }
    setReplaying(true); setError(null);
    try {
      const result = await agentApi.replaySandbox(pocCode, contractSource, forkRpc || undefined, forkBlock ? parseInt(forkBlock) : undefined);
      if (result) {
        setReplayResult(result);
        setReplayTraceHash(result.replay_trace_hash);
        addToast(`Sandbox verdict: ${result.verdict}`, result.verdict === 'CHALLENGE_UPHELD' ? 'warning' : 'info');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Replay failed');
    } finally { setReplaying(false); }
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-3xl font-bold text-[#1d1d1f]">争议仲裁</h3>
        <p className="text-lg text-[#6e6e73] mt-2">管理 VRF 委员会选举与链上投票提交</p>
      </div>

      {/* Step Progress */}
      <div className="card">
        <p className="text-base font-semibold text-[#86868b] uppercase tracking-widest mb-6">仲裁进度</p>
        <div className="flex items-center justify-between">
          {arbSteps.map((step, i) => (
            <div key={i} className="flex flex-col items-center gap-3 flex-1 relative">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all ${i < currentStep ? 'bg-[#0071e3]/10 border-[#0071e3] text-[#0071e3]' : i === currentStep ? 'bg-[#0071e3]/5 border-[#0071e3]/50 text-[#0071e3]' : 'bg-[#f5f5f7] border-[#f5f5f7] text-[#86868b]'}`}>
                {step.icon}
              </div>
              <span className={`text-base text-center leading-tight ${i <= currentStep ? 'text-[#1d1d1f] font-semibold' : 'text-[#86868b]'}`}>{step.label}</span>
              {i < arbSteps.length - 1 && (
                <div className={`absolute top-7 left-1/2 w-full h-0.5 ${i < currentStep ? 'bg-[#0071e3]' : 'bg-[#f5f5f7]'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Two-column layout for main interface */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Committee Lookup */}
        <div className="space-y-5">
          <div className="card space-y-5">
            <h3 className="text-2xl font-semibold text-[#1d1d1f] flex items-center gap-3"><Search size={24} /> 委员会查询</h3>
            <div className="flex flex-col gap-3">
              <input type="text" value={taskId} onChange={e => setTaskId(e.target.value)} placeholder="任务 ID (0x...)" className="input flex-1 font-mono text-base py-3" />
              <div className="flex gap-3">
                <button onClick={fetchCommittee} disabled={loading || !taskId} className="btn-secondary flex-1 text-base py-3">查询</button>
                <button onClick={handleSelectCommittee} disabled={loading || !taskId} className="btn-primary flex-1 text-base py-3">选举委员会</button>
              </div>
            </div>
            {error && <p className="text-base text-[#ff3b30]">{error}</p>}
          </div>

          {/* Committee Members */}
          {committee.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xl font-semibold text-[#1d1d1f]">
                  委员会（{committee.length} 人）
                  {isMember && <span className="ml-2 text-sm bg-[#34c759]/10 text-[#34c759] px-3 py-1 rounded-full">您是委员</span>}
                </h3>
                <ProgressRing value={signatures.length} max={quorumNeeded} size={64} label="quorum" color="text-[#0071e3]" />
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {committee.map((member, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 bg-[#f5f5f7] rounded-2xl">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: `#${member.slice(2, 8)}` }}>
                      {member.slice(2, 4).toUpperCase()}
                    </div>
                    <span className="font-mono text-base flex-1 text-[#1d1d1f]">{shortenAddress(member)}</span>
                    {member.toLowerCase() === wallet.address?.toLowerCase() && <span className="text-sm bg-[#0071e3]/10 text-[#0071e3] px-3 py-1 rounded-full">我</span>}
                    {signatures.find(s => s.address.toLowerCase() === member.toLowerCase()) && <span className="text-sm bg-[#34c759]/10 text-[#34c759] px-3 py-1 rounded-full">已签名</span>}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Vote Panel */}
          {isMember && committee.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card space-y-5">
              <h3 className="text-xl font-semibold text-[#1d1d1f] flex items-center gap-3"><Shield size={22} /> 投票（EIP-712）</h3>
              <div>
                <label className="label text-base">裁决</label>
                <div className="flex gap-3">
                  <button onClick={() => setVote('uphold')} className={`flex-1 px-4 py-4 rounded-2xl text-base font-medium transition-all ${vote === 'uphold' ? 'bg-[#ff3b30]/10 text-[#ff3b30]' : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'}`}>争议成立</button>
                  <button onClick={() => setVote('dismiss')} className={`flex-1 px-4 py-4 rounded-2xl text-base font-medium transition-all ${vote === 'dismiss' ? 'bg-[#34c759]/10 text-[#34c759]' : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'}`}>争议驳回</button>
                </div>
              </div>
              <div>
                <label className="label text-base">Replay Trace Hash (bytes32)</label>
                <input type="text" value={replayTraceHash} onChange={e => setReplayTraceHash(e.target.value)} placeholder="0x..." className="input font-mono text-base py-3" />
              </div>
              <button onClick={handleSignVote} disabled={signing || !replayTraceHash} className="btn-primary w-full text-base py-3">{signing ? '签名中...' : '签名投票'}</button>
              {signatures.length >= quorumNeeded && (
                <button onClick={handleSubmitResult} disabled={submittingResult} className="btn-primary bg-[#34c759] hover:bg-[#34c759]/90 w-full text-base py-3">{submittingResult ? '提交中...' : '提交仲裁结果'}</button>
              )}
            </motion.div>
          )}
        </div>

        {/* Right: Sandbox + Process */}
        <div className="space-y-5">
          {committee.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card space-y-5">
              <h3 className="text-xl font-semibold text-[#1d1d1f] flex items-center gap-3"><Play size={22} /> 沙箱重放</h3>
              <p className="text-base text-[#86868b]">在隔离沙箱中运行验证测试代码，检查抄袭/错误是否可复现。</p>
              <div><label className="label text-base">验证测试代码</label><textarea value={pocCode} onChange={e => setPocCode(e.target.value)} placeholder={`// 抄袭/错误验证测试代码&#10;def test_plagiarism():&#10;    ...`} className="input h-32 resize-y font-mono text-sm" /></div>
              <div><label className="label text-base">被举报的学生作业代码</label><textarea value={contractSource} onChange={e => setContractSource(e.target.value)} placeholder={`def bubble_sort(arr):&#10;    ...`} className="input h-32 resize-y font-mono text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label text-base">Fork RPC</label><input type="text" value={forkRpc} onChange={e => setForkRpc(e.target.value)} placeholder="http://127.0.0.1:8545" className="input font-mono text-sm py-3" /></div>
                <div><label className="label text-base">Fork Block</label><input type="number" value={forkBlock} onChange={e => setForkBlock(e.target.value)} placeholder="latest" className="input font-mono text-sm py-3" /></div>
              </div>
              <button onClick={handleRunReplay} disabled={replaying || !pocCode || !contractSource} className="btn-primary w-full text-base py-3">{replaying ? '重放中...' : '运行重放'}</button>
              {replayResult && (
                <div className={`p-5 rounded-2xl ${replayResult.verdict === 'CHALLENGE_UPHELD' ? 'bg-[#ff3b30]/5' : 'bg-[#34c759]/5'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-base font-bold ${replayResult.verdict === 'CHALLENGE_UPHELD' ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>{replayResult.verdict}</span>
                  </div>
                  <p className="text-sm text-[#1d1d1f] mb-2">{replayResult.reason}</p>
                  <p className="text-sm text-[#6e6e73]"><span className="text-[#86868b]">验证哈希:</span> <span className="font-mono">{replayResult.replay_trace_hash}</span></p>
                </div>
              )}
            </motion.div>
          )}

          {/* Process Explanation */}
          <div className="card">
            <h3 className="text-xl font-semibold text-[#1d1d1f] mb-5">仲裁流程说明</h3>
            <ol className="space-y-4 text-base text-[#6e6e73]">
              {[
                '举报者对作业评审结果发起学术争议',
                '从学术信誉 ≥ 200 的师生中随机选出仲裁委员会',
                '委员会成员审查验证证据和沙箱重放结果',
                '委员会签名投票，需达到 67% 法定人数',
                '裁决：争议成立则被举报学生罚没学分；否则举报者受罚',
              ].map((text, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#0071e3]/10 flex items-center justify-center text-base text-[#0071e3] font-bold">{i + 1}</span>
                  <span className="pt-1">{text}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
