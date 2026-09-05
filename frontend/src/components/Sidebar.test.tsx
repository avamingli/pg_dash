import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Sidebar from './Sidebar';

const useMetrics = vi.fn();
vi.mock('@/contexts/metrics', () => ({
  useMetrics: () => useMetrics(),
}));

function renderSidebar() {
  return render(
    <BrowserRouter>
      <Sidebar />
    </BrowserRouter>
  );
}

describe('Sidebar', () => {
  it('shows the default PG Dash brand when not connected to WarehousePG', () => {
    useMetrics.mockReturnValue({ clusterInfo: null });
    renderSidebar();
    expect(screen.getByText('PG Dash')).toBeInTheDocument();
    expect(screen.queryByText('WarehousePG')).not.toBeInTheDocument();
  });

  it('swaps to the WarehousePG brand when connected to a WarehousePG cluster', () => {
    useMetrics.mockReturnValue({
      clusterInfo: {
        mode: 'warehousepg',
        product_name: 'WarehousePG',
        version: '7.0.0-beta.0',
        pg_version: '12.12',
        num_segments: 3,
        has_mirrors: false,
        resource_mgr: 'none',
      },
    });
    renderSidebar();
    expect(screen.getByText('WarehousePG')).toBeInTheDocument();
    expect(screen.queryByText('PG Dash')).not.toBeInTheDocument();
  });

  it('shows the Cluster nav item for a WarehousePG connection', () => {
    useMetrics.mockReturnValue({
      clusterInfo: { mode: 'warehousepg', product_name: 'WarehousePG' },
    });
    renderSidebar();
    expect(screen.getByText('Cluster')).toBeInTheDocument();
  });

  it('lists Plan Replay right after SQL Editor on a distributed cluster only', () => {
    // Recordings come from the Watch panel, which needs an MPP cluster —
    // so the replay entry follows the same gate as Cluster.
    useMetrics.mockReturnValue({
      clusterInfo: { mode: 'cloudberry', product_name: 'Apache Cloudberry' },
    });
    renderSidebar();
    const labels = screen.getAllByRole('link').map(a => a.textContent);
    expect(labels.indexOf('Plan Replay')).toBe(labels.indexOf('SQL Editor') + 1);
  });

  it('hides Plan Replay on plain PostgreSQL', () => {
    useMetrics.mockReturnValue({
      clusterInfo: { mode: 'postgresql', product_name: 'PostgreSQL' },
    });
    renderSidebar();
    expect(screen.queryByText('Plan Replay')).not.toBeInTheDocument();
    expect(screen.queryByText('Cluster')).not.toBeInTheDocument();
    expect(screen.getByText('SQL Editor')).toBeInTheDocument();
  });
});
