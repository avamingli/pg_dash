import { Clock, Radio } from 'lucide-react';
import type { TimeRange } from '@/lib/timeRange';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const OPTIONS: { key: TimeRange; label: string }[] = [
  { key: 'realtime', label: 'Real-time' },
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '24h', label: '24h' },
  { key: '3d', label: '3d' },
  { key: '7d', label: '7d' },
];

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
      {OPTIONS.map(opt => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded transition-colors ${
            value === opt.key
              ? 'bg-zinc-700 text-white'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
          }`}
        >
          {opt.key === 'realtime' && <Radio size={10} />}
          {opt.key !== 'realtime' && <Clock size={10} />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
