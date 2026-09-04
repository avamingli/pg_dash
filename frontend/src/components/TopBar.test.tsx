import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import TopBar from './TopBar';

// Mock MetricsContext. showVersionDetails is true here so these tests can
// check what the version text actually says once revealed, without also
// having to click the toggle first in every one of them.
const toggleVersionDetails = vi.fn();
vi.mock('@/contexts/metrics', () => ({
  useMetrics: () => ({
    connected: true,
    latest: {
      pg: {
        connections: { total: 42, max_connections: 100, active: 5, idle: 30, idle_in_transaction: 2, waiting: 0 },
      },
    },
    history: [],
    send: vi.fn(),
    showVersionDetails: true,
    toggleVersionDetails,
  }),
}));

// Mock api
const getServerInfo = vi.fn().mockResolvedValue({
  version: 'PostgreSQL 19devel on x86_64',
  uptime: '2 days',
  user: 'gpadmin',
  host: '127.0.0.1',
  port: '5432',
});
vi.mock('@/lib/api', () => ({
  api: {
    getServerInfo: (...args: unknown[]) => getServerInfo(...args),
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

  it('renders the connection string once server info loads', async () => {
    renderTopBar();
    expect(await screen.findByText('gpadmin@127.0.0.1:5432')).toBeInTheDocument();
  });

  it('labels a WarehousePG cluster by product name, not "Cloudberry"', async () => {
    getServerInfo.mockResolvedValueOnce({
      version: 'PostgreSQL 19devel on x86_64',
      uptime: '2 days',
      cluster_info: {
        mode: 'warehousepg',
        product_name: 'WarehousePG',
        version: '7.0.0-beta.0',
        pg_version: '12.12',
        num_segments: 3,
        has_mirrors: false,
        resource_mgr: 'none',
      },
    });
    renderTopBar();
    expect(await screen.findByText(/WarehousePG 7\.0\.0-beta\.0/)).toBeInTheDocument();
    expect(screen.queryByText(/^Cloudberry/)).not.toBeInTheDocument();
  });

  it('clicking the eye icon calls toggleVersionDetails', async () => {
    renderTopBar();
    await userEvent.click(await screen.findByTitle('Hide version details'));
    expect(toggleVersionDetails).toHaveBeenCalledTimes(1);
  });
});
