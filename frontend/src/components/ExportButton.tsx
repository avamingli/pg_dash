import { Download } from 'lucide-react';

interface ExportButtonProps {
  data: Record<string, unknown>[];
  filename?: string;
  columns?: string[];
}

export default function ExportButton({ data, filename = 'export.csv', columns }: ExportButtonProps) {
  function handleExport() {
    if (!data || data.length === 0) return;

    const cols = columns ?? Object.keys(data[0]);
    const lines: string[] = [];
    lines.push(cols.map(c => `"${c}"`).join(','));

    for (const row of data) {
      lines.push(cols.map(c => {
        const v = row[c];
        if (v == null) return '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport}
      disabled={!data || data.length === 0}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 rounded transition-colors disabled:opacity-30"
      title="Export as CSV"
    >
      <Download size={12} />
      CSV
    </button>
  );
}
