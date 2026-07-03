import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Monitor, Wrench, X, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import type { ReactNode } from 'react';

interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
  description: string;
  badge?: string;
}

const navItems: NavItem[] = [
  {
    path: '/',
    label: '监控',
    icon: <Monitor size={18} />,
    description: '总览 · 任务 · 参与者 · 事件',
  },
  {
    path: '/operations',
    label: '操作',
    icon: <Wrench size={18} />,
    description: 'AI 操作 · 仲裁',
    badge: '实时',
  },
];

interface SidebarProps {
  mobile?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ mobile = false, onClose }: SidebarProps) {
  return (
    <aside className={cn(
      'bg-white/70 backdrop-blur-xl flex flex-col',
      mobile ? 'w-72 h-full p-5' : 'w-64 hidden md:flex border-r border-black/[0.05] p-5'
    )}>
      {mobile && (
        <div className="flex justify-end mb-4">
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/[0.04]" aria-label="关闭菜单">
            <X size={18} />
          </button>
        </div>
      )}

      <div className="mb-4">
        <p className="text-[22px] font-semibold text-[#86868b] uppercase tracking-widest px-3 mb-3">导航</p>
        <nav className="space-y-2">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={mobile ? onClose : undefined}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all duration-200 group',
                  isActive
                    ? 'text-[#0071e3] font-medium'
                    : 'text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-black/[0.03]'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 bg-[#0071e3]/[0.07] rounded-xl"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                  <span className={cn(
                    'relative z-10 p-2 rounded-xl transition-colors',
                    isActive ? 'bg-[#0071e3]/10 text-[#0071e3]' : 'text-[#86868b] group-hover:text-[#1d1d1f] group-hover:bg-black/[0.04]'
                  )}>
                    {item.icon}
                  </span>
                  <div className="relative z-10 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[32px]">{item.label}</span>
                      {item.badge && (
                        <span className="px-1.5 py-0.5 rounded-full text-[20px] font-bold bg-[#34c759]/15 text-[#34c759] uppercase tracking-wide">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className={cn(
                      'text-[24px] mt-0.5 truncate transition-colors leading-relaxed',
                      isActive ? 'text-[#0071e3]/60' : 'text-[#86868b]'
                    )}>
                      {item.description}
                    </p>
                  </div>
                  {isActive && (
                    <ChevronRight size={14} className="relative z-10 text-[#0071e3]/50 flex-shrink-0" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="px-3 py-2 mb-3">
        <div className="h-px bg-black/[0.05]" />
      </div>

      <div className="px-3 space-y-2">
        <p className="text-[22px] font-semibold text-[#86868b] uppercase tracking-widest">详情视图</p>
        <p className="text-[24px] text-[#86868b] leading-relaxed">
          点击任意任务或参与者查看详情。
        </p>
      </div>

      <div className="flex-1" />

      <div className="pt-3 border-t border-black/[0.05]">
        <p className="text-[22px] text-[#86868b] text-center font-mono">EduChain v0.1.0 · 研究演示</p>
      </div>
    </aside>
  );
}
