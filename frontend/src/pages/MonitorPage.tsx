import { useState, useEffect, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend
} from 'recharts';
import {
  Users, ListTodo, Coins, Shield, Activity, ArrowRight,
  FileCode2, Scale, Vote, CheckCircle2, AlertTriangle, Brain,
  TrendingUp, Layers, Lock, Cpu, LayoutDashboard, Search,
  Grid, List, UserPlus, Plus, Wallet, AlertCircle, Radio, Filter,
  Circle, XCircle, Clock
} from 'lucide-react';
import { ethers } from 'ethers';
import { useRegistry } from '../hooks/useRegistry';
import { useDisputeResolution } from '../hooks/useDisputeResolution';
import { useStakeOracle } from '../hooks/useStakeOracle';
import { useAgentApi } from '../hooks/useAgentApi';
import { useActivityData } from '../hooks/useActivityData';
import { useTransactions } from '../contexts/TransactionContext';
import { useToast } from '../contexts/ToastContext';
import { formatEther, shortenAddress, getStatusLabel } from '../lib/utils';
import { TaskStatus } from '../types';
import DisputeResolutionABI from '../contracts/abis/DisputeResolution.json';
import ArbitrationCommitteeABI from '../contracts/abis/ArbitrationCommittee.json';
import RegistryABI from '../contracts/abis/Registry.json';
import { getAddresses } from '../contracts/addresses';
import StatCard from '../components/ui/StatCard';
import PageTransition from '../components/ui/PageTransition';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import EventLogItem from '../components/EventLogItem';
import { cn } from '../lib/cn';
import type { useWallet } from '../hooks/useWallet';

type TabId = 'overview' | 'tasks' | 'agents' | 'events';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: '总览', icon: <LayoutDashboard size={15} /> },
  { id: 'tasks', label: '任务', icon: <ListTodo size={15} /> },
  { id: 'agents', label: '参与者', icon: <Users size={15} /> },
  { id: 'events', label: '事件日志', icon: <Radio size={15} /> },
];

const PROTOCOL_FLOW = [
  { step: 1, icon: <FileCode2 size={22} />, title: '教师发布', desc: '布置编程作业与评分标准', color: '#0071e3', bg: 'bg-[#0071e3]/10' },
  { step: 2, icon: <Brain size={22} />, title: 'AI + 同行评审', desc: 'AI 自动审查 + 多位同行打分', color: '#5856d6', bg: 'bg-[#5856d6]/10' },
  { step: 3, icon: <AlertTriangle size={22} />, title: '争议窗口', desc: '48h 内可对评审结果提出质疑', color: '#ff9f0a', bg: 'bg-[#ff9f0a]/10' },
  { step: 4, icon: <Scale size={22} />, title: '仲裁裁决', desc: '学术委员会审查证据并投票', color: '#ff3b30', bg: 'bg-[#ff3b30]/10' },
  { step: 5, icon: <Vote size={22} />, title: '达成共识', desc: '委员会 67% 多数形成决议', color: '#34c759', bg: 'bg-[#34c759]/10' },
  { step: 6, icon: <CheckCircle2 size={22} />, title: '学分结算', desc: '奖学金/惩罚自动执行，信誉更新', color: '#34c759', bg: 'bg-[#34c759]/10' },
];

const KEY_FEATURES = [
  { icon: <Layers size={20} />, title: '乐观评审', desc: '作业默认通过，仅在有人提出质疑时才进入仲裁流程，减少不必要开销。', color: '#0071e3' },
  { icon: <Brain size={20} />, title: 'AI 智能评审', desc: 'AI 自动分析代码质量、正确性、规范性，识别抄袭痕迹并提供改进建议。', color: '#5856d6' },
  { icon: <Shield size={20} />, title: '学术争议仲裁', desc: '抄袭指控由学术委员会审查验证代码后投票裁决，全程链上存证不可篡改。', color: '#ff3b30' },
  { icon: <Lock size={20} />, title: '学分质押与信誉', desc: '学生和评审者质押学分参与，不诚实行为会被罚没学分并降低学术信誉。', color: '#ff9f0a' },
  { icon: <Cpu size={20} />, title: '博弈论激励机制', desc: '系统参数经博弈论标定，确保诚实学习和公正评审是每个参与者的最优策略。', color: '#34c759' },
  { icon: <TrendingUp size={20} />, title: '数据不可篡改', desc: '所有评审记录、争议证据、仲裁结果均通过区块链存证，永久可追溯可验证。', color: '#ff9f0a' },
];

const statusConfig = {
  [TaskStatus.Open]: { variant: 'info' as const, icon: <Circle size={12} /> },
  [TaskStatus.Proposed]: { variant: 'warning' as const, icon: <Clock size={12} /> },
  [TaskStatus.InReview]: { variant: 'info' as const, icon: <Clock size={12} /> },
  [TaskStatus.Challenged]: { variant: 'error' as const, icon: <AlertTriangle size={12} /> },
  [TaskStatus.Finalized]: { variant: 'success' as const, icon: <CheckCircle2 size={12} /> },
  [TaskStatus.Slashed]: { variant: 'error' as const, icon: <XCircle size={12} /> },
};

function generateIdenticon(address: string): string {
  return `#${address.slice(2, 8)}`;
}

interface ParsedEvent {
  name: string;
  blockNumber: number;
  transactionHash: string;
  args: Record<string, string>;
}

export default function MonitorPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const wallet = useOutletContext<ReturnType<typeof useWallet>>();

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-4xl font-bold text-[#1d1d1f] tracking-tight">协议监控</h2>
            <p className="text-lg text-[#86868b] mt-1">实时查看参与者、任务与链上事件</p>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 p-1 bg-[#f5f5f7] rounded-2xl w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200',
                activeTab === tab.id
                  ? 'bg-white text-[#1d1d1f] shadow-apple-sm'
                  : 'text-[#6e6e73] hover:text-[#1d1d1f]'
              )}
            >
              {tab.icon}
              {tab.label}
              {activeTab === tab.id && (
                <motion.div layoutId="monitor-tab" className="absolute inset-0 bg-white rounded-xl -z-10 shadow-apple-sm" transition={{ type: 'spring', stiffness: 400, damping: 35 }} />
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
            {activeTab === 'overview' && <OverviewTab wallet={wallet} onTabChange={setActiveTab} />}
            {activeTab === 'tasks' && <TasksTab wallet={wallet} />}
            {activeTab === 'agents' && <AgentsTab wallet={wallet} />}
            {activeTab === 'events' && <EventsTab wallet={wallet} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}

/* ===========================  OVERVIEW TAB  =========================== */
function OverviewTab({ wallet, onTabChange }: { wallet: ReturnType<typeof useWallet>; onTabChange: (tab: TabId) => void }) {
  const { agentCount } = useRegistry({ provider: wallet.provider, signer: wallet.signer, chainId: wallet.chainId });
  const { taskCount } = useDisputeResolution({ provider: wallet.provider, signer: wallet.signer, chainId: wallet.chainId });
  const { params } = useStakeOracle({ provider: wallet.provider, chainId: wallet.chainId });
  const { getHealth } = useAgentApi();
  const [backendStatus, setBackendStatus] = useState<{ status: string; agent_loaded: boolean } | null>(null);
  const { activityData, statusDistribution } = useActivityData(taskCount);

  useEffect(() => { getHealth().then(setBackendStatus); }, [getHealth]);

  const stakeData = [
    { name: 'Min Student Stake', value: params ? Number(formatEther(params.minProposerStake)) : 1 },
    { name: 'Min Reporter Stake', value: params ? Number(formatEther(params.minChallengerStake)) : 1 },
    { name: 'Review Effort', value: params ? Number(formatEther(params.auditCost)) : 0.1 },
    { name: 'Evidence Cost', value: params ? Number(formatEther(params.pocCost)) : 0.05 },
  ];

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0071e3] via-[#0077ed] to-[#5856d6] p-10 md:p-14 shadow-apple-lg"
      >
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-white translate-x-1/3 -translate-y-1/3" />
          <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-white -translate-x-1/4 translate-y-1/4" />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div>
            <h2 className="text-5xl md:text-6xl font-bold text-white tracking-tight leading-tight mb-4">
              智慧教育<br />学术诚信评审框架
            </h2>
            <p className="text-white/80 text-xl leading-relaxed max-w-xl">
              AI 评审代理链上竞争评审作业代码，乐观执行与可验证的争议仲裁协议
            </p>
          </div>
          <div className="flex gap-3 flex-wrap md:flex-col">
            <button onClick={() => onTabChange('tasks')} className="flex items-center gap-2 px-6 py-3 bg-white text-[#0071e3] rounded-full text-base font-semibold hover:bg-white/90 transition-colors shadow-apple-sm whitespace-nowrap">
              查看任务 <ArrowRight size={16} />
            </button>
            <button onClick={() => onTabChange('agents')} className="flex items-center gap-2 px-6 py-3 bg-white/20 text-white rounded-full text-base font-semibold hover:bg-white/30 transition-colors whitespace-nowrap">
              查看参与者 <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard label="已注册参与者" value={agentCount} icon={<Users size={22} />} gradient="cyan" />
        <StatCard label="任务总数" value={taskCount} icon={<ListTodo size={22} />} gradient="purple" />
        <StatCard label="学生最低质押" value={params ? Number(formatEther(params.minProposerStake)) : 0} suffix="学分" icon={<Coins size={22} />} gradient="emerald" />
        <StatCard label="举报者最低质押" value={params ? Number(formatEther(params.minChallengerStake)) : 0} suffix="学分" icon={<Shield size={22} />} gradient="amber" />
      </div>

      {/* Protocol Flow */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card">
        <div className="flex items-center justify-between mb-7">
          <div>
            <h3 className="text-2xl font-bold text-[#1d1d1f]">协议生命周期</h3>
            <p className="text-base text-[#86868b] mt-1.5">从任务发布到最终确认的完整流程</p>
          </div>
          <span className="text-sm px-4 py-2 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-semibold">6 个阶段</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
          {PROTOCOL_FLOW.map((stage, i) => (
            <div key={i} className="relative flex flex-col items-center text-center gap-4">
              {i < PROTOCOL_FLOW.length - 1 && (
                <div className="hidden lg:block absolute top-8 left-[60%] w-full h-px bg-gradient-to-r from-[#e0e0e5] to-transparent z-0" />
              )}
              <div className={`relative z-10 w-16 h-16 rounded-2xl ${stage.bg} flex items-center justify-center`} style={{ color: stage.color }}>
                {stage.icon}
                <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#1d1d1f] text-white text-xs font-bold flex items-center justify-center">{stage.step}</span>
              </div>
              <div>
                <p className="text-base font-semibold text-[#1d1d1f] leading-tight">{stage.title}</p>
                <p className="text-sm text-[#86868b] mt-1.5 leading-relaxed hidden md:block">{stage.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card">
          <h3 className="text-xl font-bold text-[#1d1d1f] mb-4">任务状态分布</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusDistribution} cx="50%" cy="50%" innerRadius={65} outerRadius={95} paddingAngle={3} dataKey="value">
                {statusDistribution.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-1 justify-center">
            {statusDistribution.map(item => (
              <div key={item.name} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#f5f5f7]">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-[#6e6e73]">{item.name}</span>
                <span className="text-[#1d1d1f] font-semibold">{item.value}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="card lg:col-span-2">
          <h3 className="text-xl font-bold text-[#1d1d1f] mb-4">近期活跃度</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={activityData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0071e3" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#0071e3" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorProposals" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34c759" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#34c759" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="name" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Area type="monotone" dataKey="tasks" name="任务" stroke="#0071e3" fill="url(#colorTasks)" strokeWidth={2.5} dot={false} />
              <Area type="monotone" dataKey="proposals" name="提案" stroke="#34c759" fill="url(#colorProposals)" strokeWidth={2.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Economic Parameters + Stake Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="card">
          <h3 className="text-xl font-bold text-[#1d1d1f] mb-5">经济参数</h3>
          {params ? (
            <dl className="space-y-4 text-sm">
              <ParamRow label="问题检出概率 (p_detect)" value={`${params.pDetect / 100}%`} percent={params.pDetect / 100} color="#0071e3" />
              <ParamRow label="仲裁准确率 (p_arb)" value={`${params.pArbCorrect / 100}%`} percent={params.pArbCorrect / 100} color="#5856d6" />
              <ParamRow label="罚没分配系数 (α)" value={`${params.alpha / 100}%`} percent={params.alpha / 100} color="#ff9f0a" />
              <div className="flex justify-between py-2 border-t border-black/[0.04]">
                <dt className="text-[#6e6e73]">评审成本</dt>
                <dd className="text-[#1d1d1f] font-mono font-semibold">{formatEther(params.auditCost)} 学分</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#6e6e73]">验证证据生成成本</dt>
                <dd className="text-[#1d1d1f] font-mono font-semibold">{formatEther(params.pocCost)} 学分</dd>
              </div>
            </dl>
          ) : (
            <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-8 bg-[#f5f5f7] rounded-xl animate-pulse" />)}</div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="card">
          <h3 className="text-xl font-bold text-[#1d1d1f] mb-4">质押要求</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stakeData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
              <XAxis dataKey="name" stroke="#86868b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} unit=" 学分" />
              <Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }} formatter={(v: number) => [`${v} 学分`, '']} />
              <Bar dataKey="value" fill="#0071e3" radius={[8, 8, 0, 0]}>
                {stakeData.map((_, index) => (
                  <Cell key={index} fill={['#0071e3', '#5856d6', '#ff9f0a', '#ff3b30'][index % 4]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Core Design Principles */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <div className="mb-5">
          <h3 className="text-2xl font-bold text-[#1d1d1f]">核心设计原则</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {KEY_FEATURES.map((f, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.05 }} className="card-hover p-5">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl flex-shrink-0" style={{ backgroundColor: `${f.color}18`, color: f.color }}>{f.icon}</div>
                <div>
                  <p className="text-base font-semibold text-[#1d1d1f] mb-1">{f.title}</p>
                  <p className="text-sm text-[#86868b] leading-relaxed">{f.desc}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* System Status */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="card">
        <h3 className="text-xl font-bold text-[#1d1d1f] mb-4">系统状态</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {backendStatus ? (
            <>
              <StatusRow label="后端 API" value={backendStatus.status} ok={backendStatus.status === 'ok'} />
              <StatusRow label="AI 评审代理运行时" value={backendStatus.agent_loaded ? '已加载' : '未加载'} ok={backendStatus.agent_loaded} />
              <StatusRow label="沙箱验证引擎" value="可用" ok={true} />
            </>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-[#ff3b30]/5 sm:col-span-3">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff3b30]" />
              <span className="text-sm text-[#ff3b30] font-medium">后端不可达 — 请启动 Python API 服务</span>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/* ===========================  TASKS TAB  =========================== */
function TasksTab({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const dispute = useDisputeResolution({ provider: wallet.provider, signer: wallet.signer, chainId: wallet.chainId });
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
      result.taskId.then(id => { if (id) addToast(`Task published: ${shortenAddress(id)}`, 'success'); });
      setShowPublish(false);
      setCodeHash(''); setSourceCode(''); setConstraints('');
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
        setCodeHash('0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join(''));
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-[#1d1d1f]">作业任务</h3>
          <p className="text-sm text-[#6e6e73] mt-0.5">{dispute.taskCount} 个链上任务</p>
        </div>
        <button onClick={() => setShowPublish(!showPublish)} className="btn-primary flex items-center gap-2">
          <Plus size={16} />
          {showPublish ? '取消' : '发布任务'}
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {[
          { value: -1 as const, label: '全部', count: statusCounts.all },
          { value: TaskStatus.Open, label: '开放', count: statusCounts[TaskStatus.Open] },
          { value: TaskStatus.Proposed, label: '已提案', count: statusCounts[TaskStatus.Proposed] },
          { value: TaskStatus.InReview, label: '评审中', count: statusCounts[TaskStatus.InReview] },
          { value: TaskStatus.Challenged, label: '有争议', count: statusCounts[TaskStatus.Challenged] },
          { value: TaskStatus.Finalized, label: '已确认', count: statusCounts[TaskStatus.Finalized] },
          { value: TaskStatus.Slashed, label: '已罚没', count: statusCounts[TaskStatus.Slashed] },
        ].map(f => (
          <button key={f.value} onClick={() => { setFilter(f.value); setPage(0); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${filter === f.value ? 'bg-[#0071e3] text-white' : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'}`}>
            {f.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[22px] ${filter === f.value ? 'bg-white/20' : 'bg-black/[0.04]'}`}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* Publish Form */}
      {showPublish && (
        <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} onSubmit={handlePublish} className="card space-y-5">
          <h3 className="text-lg font-semibold text-[#1d1d1f]">Publish New Assignment</h3>
          <p className="text-sm text-[#86868b]">Submit assignment code for quality review. Participants will compete to provide the best analysis.</p>
          <div>
            <label className="label">作业代码</label>
            <textarea value={sourceCode} onChange={e => handleSourceChange(e.target.value)} placeholder={`// 请在此粘贴学生提交的作业代码&#10;// 例如：Python 冒泡排序实现&#10;&#10;def bubble_sort(arr):&#10;    n = len(arr)&#10;    for i in range(n):&#10;        for j in range(n - i - 1):&#10;            if arr[j] > arr[j + 1]:&#10;                arr[j], arr[j + 1] = arr[j + 1], arr[j]`} className="input h-40 resize-y font-mono text-xs" />
            <p className="text-xs text-[#86868b] mt-1.5">Code hash will be auto-generated from source</p>
          </div>
          <div>
            <label className="label">Code Hash (bytes32)</label>
            <input type="text" value={codeHash} onChange={e => setCodeHash(e.target.value)} placeholder="0x..." className="input font-mono text-sm" required />
          </div>
          <div>
            <label className="label">Hard Constraints</label>
            <textarea value={constraints} onChange={e => setConstraints(e.target.value)} placeholder="no-reentrancy, no-oracle-manipulation, no-flash-loan" className="input h-16 resize-none text-sm" />
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
          {error && <div className="flex items-center gap-2 p-4 rounded-2xl bg-[#ff3b30]/5"><AlertTriangle size={14} className="text-[#ff3b30]" /><span className="text-sm text-[#ff3b30]">{error}</span></div>}
          <button type="submit" disabled={submitting} className="btn-primary w-full">{submitting ? 'Publishing...' : 'Publish Task'}</button>
        </motion.form>
      )}

      {/* Task List */}
      {dispute.loading ? (
        <Skeleton variant="card" count={5} />
      ) : filteredTasks.length === 0 ? (
        <div className="space-y-4">
          <EmptyState title={filter === -1 ? '暂无任务' : '没有符合条件的任务'} description="链上任务发布后将显示在此处。" />
          <TaskIdInput />
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {paginatedTasks.map((task, i) => {
              const config = statusConfig[task.status];
              return (
                <motion.div key={task.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                  <Link to={`/tasks/${task.id}`} className="card-hover block group relative overflow-hidden">
                    <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-3xl ${task.status === TaskStatus.Open ? 'bg-[#0071e3]' : task.status === TaskStatus.Proposed ? 'bg-[#ff9f0a]' : task.status === TaskStatus.InReview ? 'bg-[#5856d6]' : task.status === TaskStatus.Challenged ? 'bg-[#ff3b30]' : task.status === TaskStatus.Finalized ? 'bg-[#34c759]' : 'bg-[#ff3b30]'}`} />
                    <div className="flex items-center justify-between pl-3">
                      <span className="font-mono text-sm text-[#1d1d1f] group-hover:text-[#0071e3] transition-colors">{shortenAddress(task.id)}</span>
                      <StatusBadge variant={config.variant} icon={config.icon}>{getStatusLabel(task.status)}</StatusBadge>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary text-sm">上一页</button>
              <span className="text-sm text-[#6e6e73]">第 {page + 1} / {totalPages} 页</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-secondary text-sm">下一页</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TaskIdInput() {
  const [taskId, setTaskId] = useState('');
  return (
    <div className="flex gap-2 justify-center">
      <input type="text" value={taskId} onChange={e => setTaskId(e.target.value)} placeholder="Enter task ID (0x...)" className="input max-w-xs font-mono text-sm" />
      <Link to={taskId ? `/tasks/${taskId}` : '#'} className={`btn-secondary text-sm ${!taskId ? 'pointer-events-none opacity-50' : ''}`}>View</Link>
    </div>
  );
}

/* ===========================  AGENTS TAB  =========================== */
function AgentsTab({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
  const { agents, loading, register } = useRegistry({ provider: wallet.provider, signer: wallet.signer, chainId: wallet.chainId });
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
    if (!wallet.isConnected) { setError('Please connect your wallet first'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const result = await register(did, stakeAmount, model || undefined);
      if (wallet.provider) trackTx(result.hash, 'Register Participant', wallet.provider);
      await result.wait();
      addToast('Participant registered successfully!', 'success');
      setShowForm(false); setDid(''); setModel(''); setStakeAmount('1.0');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-[#1d1d1f]">已注册参与者</h3>
          <p className="text-sm text-[#6e6e73] mt-0.5">{agents.length} 个链上评审者</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
          <UserPlus size={16} />
          {showForm ? '取消' : '注册参与者'}
        </button>
      </div>

      {/* Search & View Toggle */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b]" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="按地址或 DID 搜索..." className="input pl-9" />
        </div>
        <div className="flex bg-[#f5f5f7] rounded-xl overflow-hidden">
          <button onClick={() => setViewMode('grid')} className={`p-2.5 transition-colors ${viewMode === 'grid' ? 'bg-white shadow-apple-sm text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'}`} aria-label="Grid view"><Grid size={16} /></button>
          <button onClick={() => setViewMode('table')} className={`p-2.5 transition-colors ${viewMode === 'table' ? 'bg-white shadow-apple-sm text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'}`} aria-label="Table view"><List size={16} /></button>
        </div>
      </div>

      {/* Registration Form */}
      {showForm && (
        <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} onSubmit={handleRegister} className="card space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[#1d1d1f]">Register New Participant</h3>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${wallet.isConnected ? 'bg-[#34c759]/10 text-[#34c759]' : 'bg-[#ff9f0a]/10 text-[#ff9f0a]'}`}>
              <Wallet size={12} />
              {wallet.isConnected ? shortenAddress(wallet.address!) : 'Not connected'}
            </div>
          </div>
          <p className="text-sm text-[#86868b]">Register as a review participant to join the EduChain protocol. You'll need to stake Credits as collateral.</p>
          <div>
            <label className="label">DID (Decentralized Identifier)</label>
            <input type="text" value={did} onChange={e => setDid(e.target.value)} placeholder="did:example:agent-001" className="input" required />
            <p className="text-xs text-[#86868b] mt-1.5">Max 31 characters. Used for on-chain identity.</p>
          </div>
          <div>
            <label className="label">AI Model</label>
            <select value={model} onChange={e => setModel(e.target.value)} className="input">
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
          </div>
          <div>
            <label className="label">Stake Amount (Credits)</label>
            <div className="relative">
              <input type="number" step="0.1" min="1.0" value={stakeAmount} onChange={e => setStakeAmount(e.target.value)} className="input pr-12" required />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#86868b]">学分</span>
            </div>
            <p className="text-xs text-[#86868b] mt-1.5">Minimum: 1.0 Credits. Higher stake = higher weight in committee selection.</p>
          </div>
          {wallet.balance !== null && (
            <div className="flex items-center gap-2 p-4 rounded-2xl bg-[#f5f5f7]">
              <Wallet size={14} className="text-[#86868b]" />
              <span className="text-sm text-[#6e6e73]">Balance: {formatEther(wallet.balance)} Credits</span>
            </div>
          )}
          {error && <div className="flex items-center gap-2 p-4 rounded-2xl bg-[#ff3b30]/5"><AlertCircle size={14} className="text-[#ff3b30]" /><span className="text-sm text-[#ff3b30]">{error}</span></div>}
          <button type="submit" disabled={submitting || !wallet.isConnected} className="btn-primary w-full">{submitting ? 'Registering...' : `Register & Stake ${stakeAmount} Credits`}</button>
        </motion.form>
      )}

      {/* Agent List */}
      {loading ? (
        <p className="text-[#86868b]">Loading agents...</p>
      ) : filteredAgents.length === 0 ? (
        <EmptyState title="未找到参与者" description={searchQuery ? '请尝试其他搜索词。' : '暂无已注册的参与者，成为第一个吧！'} />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredAgents.map((agent, i) => (
            <motion.div key={agent.address} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Link to={`/agents/${agent.address}`} className="card-hover block group">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: generateIdenticon(agent.address) }}>
                    {agent.address.slice(2, 4).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-[#1d1d1f] group-hover:text-[#0071e3] transition-colors truncate">{shortenAddress(agent.address)}</p>
                    <p className="text-xs text-[#86868b] truncate">{agent.did}</p>
                  </div>
                </div>
                {agent.model && (
                  <div className="mb-3">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#0071e3]/10 text-[#0071e3]">{agent.model}</span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2.5 rounded-xl bg-[#f5f5f7]">
                    <p className="text-[20px] text-[#86868b] uppercase tracking-wider">Stake</p>
                    <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5">{formatEther(agent.stake)}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#f5f5f7]">
                    <p className="text-[20px] text-[#86868b] uppercase tracking-wider">Rep</p>
                    <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5">{agent.reputation}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#f5f5f7]">
                    <p className="text-[20px] text-[#86868b] uppercase tracking-wider">Weight</p>
                    <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5">{agent.weight}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="w-full bg-[#f5f5f7] rounded-full h-1.5">
                    <div className="bg-[#0071e3] h-1.5 rounded-full transition-all duration-700" style={{ width: `${Math.min(Number(agent.reputation) / 10, 100)}%` }} />
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
                  <th className="p-4 font-medium">Address</th>
                  <th className="p-4 font-medium">DID</th>
                  <th className="p-4 font-medium">Model</th>
                  <th className="p-4 font-medium">Stake</th>
                  <th className="p-4 font-medium">Reputation</th>
                  <th className="p-4 font-medium">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {filteredAgents.map(agent => (
                  <tr key={agent.address} className="text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors">
                    <td className="p-4"><Link to={`/agents/${agent.address}`} className="font-mono text-[#0071e3] hover:underline">{shortenAddress(agent.address)}</Link></td>
                    <td className="p-4 font-mono text-xs text-[#86868b]">{agent.did}</td>
                    <td className="p-4">{agent.model ? <span className="px-2 py-0.5 rounded-full text-xs bg-[#0071e3]/10 text-[#0071e3]">{agent.model}</span> : <span className="text-[#86868b]">—</span>}</td>
                    <td className="p-4">{formatEther(agent.stake)} 学分</td>
                    <td className="p-4">{agent.reputation}</td>
                    <td className="p-4">{agent.weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===========================  EVENTS TAB  =========================== */
function EventsTab({ wallet }: { wallet: ReturnType<typeof useWallet> }) {
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
          parsed.fragment.inputs.forEach((input, i) => { args[input.name] = String(parsed.args[i]); });
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-[#1d1d1f] flex items-center gap-3">
          事件日志
          <span className="flex items-center gap-1.5 text-xs bg-[#34c759]/10 text-[#34c759] px-2.5 py-1 rounded-full">
            <Radio size={10} className="animate-pulse" />
            实时
          </span>
        </h3>
        <span className="text-sm text-[#6e6e73]">{events.length} 条事件</span>
      </div>

      {eventTypes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-[#86868b]" />
          <button onClick={() => { setTypeFilter(null); setPage(0); }} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${!typeFilter ? 'bg-[#0071e3] text-white' : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'}`}>全部</button>
          {eventTypes.map(type => (
            <button key={type} onClick={() => { setTypeFilter(type); setPage(0); }} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${typeFilter === type ? 'bg-[#0071e3] text-white' : 'bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#e8e8ed]'}`}>{type}</button>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-4"><Skeleton variant="card" count={5} /></div>
        ) : paginatedEvents.length === 0 ? (
          <p className="text-[#86868b] text-center py-8">No events found</p>
        ) : (
          paginatedEvents.map((event, i) => (
            <motion.div key={`${event.transactionHash}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
              <EventLogItem name={event.name} blockNumber={event.blockNumber} transactionHash={event.transactionHash} args={event.args} />
            </motion.div>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary text-sm">Previous</button>
          <span className="text-sm text-[#6e6e73]">Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-secondary text-sm">Next</button>
        </div>
      )}
    </div>
  );
}

/* ===========================  HELPERS  =========================== */
function ParamRow({ label, value, percent, color = '#0071e3' }: { label: string; value: string; percent?: number; color?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <dt className="text-[#6e6e73]">{label}</dt>
        <dd className="text-[#1d1d1f] font-mono font-semibold">{value}</dd>
      </div>
      {percent !== undefined && (
        <div className="w-full bg-[#f5f5f7] rounded-full h-2">
          <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }} />
        </div>
      )}
    </div>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={`flex items-center justify-between p-4 rounded-2xl ${ok ? 'bg-[#34c759]/5' : 'bg-[#ff9f0a]/5'}`}>
      <div>
        <p className="text-xs text-[#86868b] mb-0.5">{label}</p>
        <p className={`text-sm font-semibold ${ok ? 'text-[#34c759]' : 'text-[#ff9f0a]'}`}>{value}</p>
      </div>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${ok ? 'bg-[#34c759]/10' : 'bg-[#ff9f0a]/10'}`}>
        {ok ? <Activity size={16} className="text-[#34c759]" /> : <AlertTriangle size={16} className="text-[#ff9f0a]" />}
      </div>
    </div>
  );
}
