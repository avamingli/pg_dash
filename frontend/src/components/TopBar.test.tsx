import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import TopBar from './TopBar';

// Mock MetricsContext
vi.mock('@/contexts/MetricsContext', () => ({
  useMetrics: () => ({
    connected: true,
    latest: {
      pg: {
        connections: { total: 42, max_connections: 100, active: 5, idle: 30, idle_in_transaction: 2, waiting: 0 },
      },
    },
    history: [],
    send: vi.fn(),
  }),
}));

// Mock api
vi.mock('@/lib/api', () => ({
  api: {
    getServerInfo: vi.fn().mockResolvedValue({
      version: 'PostgreSQL 19devel on x86_64',
      uptime: '2 days',
    }),
    getAlertCount: vi.fn().mockResolvedValue({ count: 3 }),
  },
}));

function renderTopBar() {
  return render(
    <BrowserRouter>
      <TopBar />
    </BrowserRouter>
  );
}

describe('TopBar', () => {
  it('shows connection status', () => {
    renderTopBar();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows connection count', () => {
    renderTopBar();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('/ 100')).toBeInTheDocument();
  });

  it('renders database name', () => {
    renderTopBar();
    expect(screen.getByText('postgres')).toBeInTheDocument();
  });
});
