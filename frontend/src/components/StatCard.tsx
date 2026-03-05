import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  color?: 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'cyan';
  trend?: 'up' | 'down' | 'flat';
  onClick?: () => void;
}

const colorMap = {
  green: 'text-green-400 bg-green-400/10',
  yellow: 'text-yellow-400 bg-yellow-400/10',
  red: 'text-red-400 bg-red-400/10',
  blue: 'text-blue-400 bg-blue-400/10',
  purple: 'text-purple-400 bg-purple-400/10',
  cyan: 'text-cyan-400 bg-cyan-400/10',
};

export default function StatCard({ title, value, subtitle, icon: Icon, color = 'blue', onClick }: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-start gap-3',
        onClick && 'cursor-pointer hover:border-zinc-600 hover:bg-zinc-800/50 transition-colors',
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className={cn('p-2 rounded-lg', colorMap[color])}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-500 uppercase tracking-wide">{title}</p>
        <p className="text-xl font-semibold text-zinc-100 mt-0.5 tabular-nums transition-all duration-300">
          {value}
        </p>
        {subtitle && (
          <p className="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
