import { Shield, Wifi, WifiOff, Search, Zap } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { shortenAddress } from '../lib/utils';
import { cn } from '../lib/cn';

interface HeaderProps {
  wallet: ReturnType<typeof useWallet>;
  pendingTxCount?: number;
}

export default function Header({ wallet, pendingTxCount = 0 }: HeaderProps) {
  const { address, chainId, isConnecting, connect, disconnect, switchToAnvil } = wallet;

  const networkName = chainId === 31337 ? 'Anvil 本地' : chainId === 1 ? '以太坊主网' : `链 ${chainId}`;
  const isWrongNetwork = chainId !== null && chainId !== 31337;

  return (
    <header className="h-16 bg-white/90 backdrop-blur-xl border-b border-black/[0.06] flex items-center justify-between px-8 sticky top-0 z-40 shadow-apple-sm">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0071e3] to-[#5856d6] flex items-center justify-center shadow-apple-sm">
            <Shield className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-[36px] font-bold text-[#1d1d1f] tracking-tight leading-tight">EduChain</h1>
            <p className="text-[22px] text-[#86868b] leading-tight hidden sm:block">智慧教育学术诚信系统</p>
          </div>
        </div>
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#f5f5f7] border border-black/[0.04]">
          <Zap size={11} className="text-[#ff9f0a]" />
          <span className="text-[24px] text-[#6e6e73] font-medium">区块链原生 AI 评审协议</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
          className="hidden md:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#f5f5f7] text-[#86868b] text-xs hover:bg-[#e8e8ed] transition-colors border border-black/[0.04]"
          aria-label="搜索"
        >
          <Search size={13} />
          <span>快速搜索</span>
          <kbd className="px-1.5 py-0.5 bg-white rounded text-[20px] font-mono shadow-apple-sm">⌘K</kbd>
        </button>

        {chainId && (
          <span className={cn(
            'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium border',
            isWrongNetwork
              ? 'bg-[#ff3b30]/10 text-[#ff3b30] border-[#ff3b30]/20'
              : 'bg-[#34c759]/10 text-[#34c759] border-[#34c759]/20'
          )}>
            {isWrongNetwork ? <WifiOff size={11} /> : <Wifi size={11} />}
            {networkName}
          </span>
        )}

        {isWrongNetwork && (
          <button onClick={switchToAnvil} className="text-xs text-[#ff9f0a] hover:text-[#ff9f0a]/80 transition-colors font-medium">
            切换到 Anvil
          </button>
        )}

        {pendingTxCount > 0 && (
          <span className="relative flex items-center justify-center w-7 h-7">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0071e3] opacity-20" />
            <span className="relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[22px] font-bold">
              {pendingTxCount}
            </span>
          </span>
        )}

        {address ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-sm text-[#1d1d1f] font-mono bg-[#f5f5f7] px-4 py-2 rounded-full border border-black/[0.04]">
              <span className="w-2 h-2 rounded-full bg-[#34c759]" />
              {shortenAddress(address)}
            </div>
            <button onClick={disconnect} className="text-xs text-[#86868b] hover:text-[#1d1d1f] transition-colors px-2 py-1">
              断开
            </button>
          </div>
        ) : (
          <button
            onClick={connect}
            disabled={isConnecting}
            className="btn-primary text-sm px-5 py-2"
          >
            {isConnecting ? '连接中...' : '连接钱包'}
          </button>
        )}
      </div>
    </header>
  );
}
