import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  Database,
  BarChart3,
  Terminal,
  GitBranch,
  Lock,
  Trash2,
  Cpu,
  Settings,
  Bell,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/activity', icon: Activity, label: 'Activity Monitor' },
  { to: '/databases', icon: Database, label: 'Databases' },
  { to: '/queries', icon: BarChart3, label: 'Query Analysis' },
  { to: '/sql', icon: Terminal, label: 'SQL Editor' },
  { to: '/replication', icon: GitBranch, label: 'Replication' },
  { to: '/locks', icon: Lock, label: 'Locks' },
  { to: '/vacuum', icon: Trash2, label: 'Vacuum' },
  { to: '/system', icon: Cpu, label: 'System' },
  { to: '/config', icon: Settings, label: 'Server Config' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'h-screen bg-zinc-900 border-r border-zinc-800 flex flex-col transition-all duration-200',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        {!collapsed && (
          <span className="text-lg font-bold" style={{ color: 'var(--pg-blue-light)' }}>
            PG Dash
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-zinc-800 text-white border-r-2'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              )
            }
            style={({ isActive }) => ({
              borderColor: isActive ? 'var(--pg-blue)' : 'transparent',
            })}
          >
            <Icon size={18} />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
