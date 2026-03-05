import {} from 'react';
import { Clock, Radio } from 'lucide-react';

export type TimeRange = 'realtime' | '1h' | '6h' | '24h' | '3d' | '7d';

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

export function timeRangeToISO(range: TimeRange): { from: string; to: string } | null {
  if (range === 'realtime') return null;
  const to = new Date();
  const from = new Date();
  switch (range) {
    case '1h': from.setHours(from.getHours() - 1); break;
    case '6h': from.setHours(from.getHours() - 6); break;
    case '24h': from.setDate(from.getDate() - 1); break;
    case '3d': from.setDate(from.getDate() - 3); break;
    case '7d': from.setDate(from.getDate() - 7); break;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

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
