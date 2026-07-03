import { useState, useEffect } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend
} from 'recharts';
import {
  Users, ListTodo, Coins, Shield, Activity, Server, ArrowRight,
  FileCode2, Scale, Vote, CheckCircle2, AlertTriangle, Brain,
  TrendingUp, Layers, Lock, Cpu
} from 'lucide-react';
import { useRegistry } from '../hooks/useRegistry';
import { useDisputeResolution } from '../hooks/useDisputeResolution';
import { useStakeOracle } from '../hooks/useStakeOracle';
import { useAgentApi } from '../hooks/useAgentApi';
import { useActivityData } from '../hooks/useActivityData';
import { formatEther } from '../lib/utils';
import StatCard from '../components/ui/StatCard';
import PageTransition from '../components/ui/PageTransition';
import type { useWallet } from '../hooks/useWallet';

const PROTOCOL_FLOW = [
  { step: 1, icon: <FileCode2 size={22} />, title: '发布任务', desc: '作业代码哈希上链', color: '#0071e3', bg: 'bg-[#0071e3]/10' },
  { step: 2, icon: <Brain size={22} />, title: 'AI 评审', desc: 'AI 评审代理质押竞标', color: '#5856d6', bg: 'bg-[#5856d6]/10' },
  { step: 3, icon: <AlertTriangle size={22} />, title: '争议窗口', desc: '乐观期内可提出争议', color: '#ff9f0a', bg: 'bg-[#ff9f0a]/10' },
  { step: 4, icon: <Scale size={22} />, title: '仲裁', desc: 'VRF 委员会投票', color: '#ff3b30', bg: 'bg-[#ff3b30]/10' },
  { step: 5, icon: <Vote size={22} />, title: '达成共识', desc: '67% 法定人数决议', color: '#34c759', bg: 'bg-[#34c759]/10' },
  { step: 6, icon: <CheckCircle2 size={22} />, title: '最终结算', desc: '奖惩到账', color: '#34c759', bg: 'bg-[#34c759]/10' },
];

const KEY_FEATURES = [
  { icon: <Layers size={20} />, title: '乐观执行', desc: '默认接受提案，仅在经济激励触发时才进入争议流程。', color: '#0071e3' },
  { icon: <Brain size={20} />, title: 'LLM 驱动评审', desc: 'AI 评审代理质押学分竞争评审奖励，利益与诚信对齐。', color: '#5856d6' },
  { icon: <Shield size={20} />, title: '语义争议解决', desc: 'Foundry 沙盒回放 + VRF 委员会 + EIP-712 链上投票。', color: '#ff3b30' },
  { icon: <Lock size={20} />, title: '质押加权声誉', desc: '声誉由质押量决定，作恶即被 Slash，行为可追责。', color: '#ff9f0a' },
  { icon: <Cpu size={20} />, title: '链上预言机参数', desc: 'StakeOracle 合约管理 p_detect、p_arb 等经济均衡参数。', color: '#34c759' },
  { icon: <TrendingUp size={20} />, title: '纳什均衡设计', desc: '参数标定使诚实报告成为理性参与者的严格优势策略。', color: '#ff9f0a' },
];

export default function DashboardPage() {
  const wallet = useOutletContext<ReturnType<typeof useWallet>>();
  const { agentCount } = useRegistry({ provider: wallet.provider, signer: wallet.signer, chainId: wallet.chainId });
  const { taskCount } = useDisputeResolution({ provider: wallet.provider, signer: wallet.signer, chainId: wallet.chainId });
  const { params } = useStakeOracle({ provider: wallet.provider, chainId: wallet.chainId });
  const { getHealth } = useAgentApi();
  const [backendStatus, setBackendStatus] = useState<{ status: string; agent_loaded: boolean } | null>(null);
  const { activityData, statusDistribution } = useActivityData(taskCount);

  useEffect(() => {
    getHealth().then(setBackendStatus);
  }, [getHealth]);

  const stakeData = [
    { name: '学生最低', value: params ? Number(formatEther(params.minProposerStake)) : 1 },
    { name: '举报者最低', value: params ? Number(formatEther(params.minChallengerStake)) : 1 },
    { name: '评审成本', value: params ? Number(formatEther(params.auditCost)) : 0.1 },
    { name: '验证证据成本', value: params ? Number(formatEther(params.pocCost)) : 0.05 },
  ];

  return (
    <PageTransition>
      <div className="space-y-10">

        {/* Hero Banner */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0071e3] via-[#0077ed] to-[#5856d6] p-8 md:p-10 shadow-apple-lg"
        >
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-white translate-x-1/3 -translate-y-1/3" />
            <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-white -translate-x-1/4 translate-y-1/4" />
          </div>
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/20 text-white/90 text-xs font-medium mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse" />
                运行中 · Anvil 测试网
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight leading-tight mb-2">
                智慧教育<br />学术诚信评审框架
              </h2>
              <p className="text-white/80 text-lg md:text-xl leading-relaxed max-w-xl">
                区块链原生 AI 作业代码评审协议，乐观执行 + 密码学可验证争议解决。
              </p>
            </div>
            <div className="flex gap-3 flex-wrap md:flex-col">
              <Link to="/tasks" className="flex items-center gap-2 px-5 py-2.5 bg-white text-[#0071e3] rounded-full text-sm font-semibold hover:bg-white/90 transition-colors shadow-apple-sm whitespace-nowrap">
                查看任务 <ArrowRight size={14} />
              </Link>
              <Link to="/agents" className="flex items-center gap-2 px-5 py-2.5 bg-white/20 text-white rounded-full text-sm font-semibold hover:bg-white/30 transition-colors whitespace-nowrap">
                查看参与者 <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </motion.div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard label="已注册参与者" value={agentCount} icon={<Users size={22} />} gradient="cyan" />
          <StatCard label="总任务数" value={taskCount} icon={<ListTodo size={22} />} gradient="purple" />
          <StatCard
            label="学生最低质押"
            value={params ? Number(formatEther(params.minProposerStake)) : 0}
            suffix="学分"
            icon={<Coins size={22} />}
            gradient="emerald"
          />
          <StatCard
            label="举报者最低质押"
            value={params ? Number(formatEther(params.minChallengerStake)) : 0}
            suffix="学分"
            icon={<Shield size={22} />}
            gradient="amber"
          />
        </div>

        {/* Protocol Flow */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="card"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-bold text-[#1d1d1f]">协议生命周期</h3>
              <p className="text-sm text-[#86868b] mt-1">从任务提交到最终结算的完整流程</p>
            </div>
            <span className="text-xs px-3 py-1.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-medium">6 个阶段</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {PROTOCOL_FLOW.map((stage, i) => (
              <div key={i} className="relative flex flex-col items-center text-center gap-3">
                {i < PROTOCOL_FLOW.length - 1 && (
                  <div className="hidden lg:block absolute top-6 left-[60%] w-full h-px bg-gradient-to-r from-[#e0e0e5] to-transparent z-0" />
                )}
                <div className={`relative z-10 w-12 h-12 rounded-2xl ${stage.bg} flex items-center justify-center`} style={{ color: stage.color }}>
                  {stage.icon}
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#1d1d1f] text-white text-[9px] font-bold flex items-center justify-center">
                    {stage.step}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#1d1d1f] leading-tight">{stage.title}</p>
                  <p className="text-xs text-[#86868b] mt-1 leading-relaxed hidden md:block">{stage.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Task Status Distribution */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="card"
          >
            <h3 className="text-lg font-semibold text-[#1d1d1f] mb-1">任务分布</h3>
            <p className="text-xs text-[#86868b] mb-4">当前状态概览</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={statusDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={95}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusDistribution.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                />
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

          {/* Activity Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="card lg:col-span-2"
          >
            <h3 className="text-lg font-semibold text-[#1d1d1f] mb-1">近期活动</h3>
            <p className="text-xs text-[#86868b] mb-4">每日任务与提案数量</p>
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
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Area type="monotone" dataKey="tasks" name="任务" stroke="#0071e3" fill="url(#colorTasks)" strokeWidth={2.5} dot={false} />
                <Area type="monotone" dataKey="proposals" name="提案" stroke="#34c759" fill="url(#colorProposals)" strokeWidth={2.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Economic Parameters + Stake Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="card"
          >
            <h3 className="text-lg font-semibold text-[#1d1d1f] mb-1">经济参数</h3>
            <p className="text-xs text-[#86868b] mb-5">链上 StakeOracle 配置</p>
            {params ? (
              <dl className="space-y-4 text-sm">
                <ParamRow label="问题检出概率 (p_detect)" value={`${params.pDetect / 100}%`} percent={params.pDetect / 100} color="#0071e3" />
                <ParamRow label="仲裁准确率 (p_arb)" value={`${params.pArbCorrect / 100}%`} percent={params.pArbCorrect / 100} color="#5856d6" />
                <ParamRow label="Alpha — Slash 分配" value={`${params.alpha / 100}%`} percent={params.alpha / 100} color="#ff9f0a" />
                <div className="flex justify-between py-2 border-t border-black/[0.04]">
                  <dt className="text-[#6e6e73]">评审成本</dt>
                  <dd className="text-[#1d1d1f] font-mono font-semibold">{formatEther(params.auditCost)} 学分</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#6e6e73]">验证证据成本</dt>
                  <dd className="text-[#1d1d1f] font-mono font-semibold">{formatEther(params.pocCost)} 学分</dd>
                </div>
              </dl>
            ) : (
              <div className="space-y-3">
                {[1,2,3,4,5].map(i => <div key={i} className="h-8 bg-[#f5f5f7] rounded-xl animate-pulse" />)}
              </div>
            )}
          </motion.div>

          {/* Stake Requirements Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="card"
          >
            <h3 className="text-lg font-semibold text-[#1d1d1f] mb-1">质押要求</h3>
            <p className="text-xs text-[#86868b] mb-4">各角色所需学分</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stakeData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                <XAxis dataKey="name" stroke="#86868b" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} unit=" 学分" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }}
                  formatter={(v: number) => [`${v} 学分`, '']}
                />
                <Bar dataKey="value" fill="#0071e3" radius={[8, 8, 0, 0]}>
                  {stakeData.map((_, index) => (
                    <Cell key={index} fill={['#0071e3', '#5856d6', '#ff9f0a', '#ff3b30'][index % 4]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        </div>

        {/* Key Features Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="mb-5">
            <h3 className="text-xl font-bold text-[#1d1d1f]">核心设计原则</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {KEY_FEATURES.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.05 }}
                className="card-hover p-5"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl flex-shrink-0" style={{ backgroundColor: `${f.color}18`, color: f.color }}>
                    {f.icon}
                  </div>
                  <div>
                    <p className="text-base font-semibold text-[#1d1d1f] mb-1">{f.title}</p>
                    <p className="text-sm text-[#86868b] leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Backend Status */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="card"
        >
          <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
            <Server size={18} className="text-[#86868b]" />
            系统状态
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {backendStatus ? (
              <>
                <StatusRow label="后端 API" value={backendStatus.status === 'ok' ? '正常' : '异常'} ok={backendStatus.status === 'ok'} />
                <StatusRow label="AI 评审代理" value={backendStatus.agent_loaded ? '已加载' : '未加载'} ok={backendStatus.agent_loaded} />
                <StatusRow label="沙盒 (Foundry)" value="可用" ok={true} />
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-[#ff3b30]/5 sm:col-span-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ff3b30]" />
                  <span className="text-sm text-[#ff3b30] font-medium">后端不可达 — 请启动 Python API 服务</span>
                </div>
              </>
            )}
          </div>
        </motion.div>

      </div>
    </PageTransition>
  );
}

function ParamRow({ label, value, percent, color = '#0071e3' }: { label: string; value: string; percent?: number; color?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <dt className="text-[#6e6e73]">{label}</dt>
        <dd className="text-[#1d1d1f] font-mono font-semibold">{value}</dd>
      </div>
      {percent !== undefined && (
        <div className="w-full bg-[#f5f5f7] rounded-full h-2">
          <div
            className="h-2 rounded-full transition-all duration-700"
            style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
          />
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
        {ok
          ? <Activity size={16} className="text-[#34c759]" />
          : <AlertTriangle size={16} className="text-[#ff9f0a]" />
        }
      </div>
    </div>
  );
}
