import { createContext, useContext } from 'react';
import type { MetricsSnapshot, ClusterInfo } from '@/types/metrics';

/**
 * The live-metrics context: the WebSocket snapshot stream every page
 * reads from.
 *
 * The context object and its hook live here rather than beside the
 * provider because a component file that also exports non-components
 * breaks Fast Refresh — the same reason planAggregate.ts sits outside
 * QueryWatchPanel.tsx. MetricsContext.tsx holds the provider.
 */
export interface MetricsContextValue {
  latest: MetricsSnapshot | null;
  history: MetricsSnapshot[];
  connected: boolean;
  send: (data: unknown) => void;
  clusterInfo: ClusterInfo | null;
  queryMetricsAvailable: boolean;
  // Live query plan tree requires both this AND queryMetricsAvailable —
  // see ServerInfo.real_plan_shmem_available.
  realPlanShmemAvailable: boolean;
  // Whether the exact build/version string (server version, product
  // version, segment count) is shown in the UI. Off by default so a
  // screen share doesn't leak build details; toggled by clicking the
  // logo in Sidebar.
  showVersionDetails: boolean;
  toggleVersionDetails: () => void;
}

export const MetricsContext = createContext<MetricsContextValue>({
  latest: null,
  history: [],
  connected: false,
  send: () => {},
  clusterInfo: null,
  queryMetricsAvailable: false,
  realPlanShmemAvailable: false,
  showVersionDetails: false,
  toggleVersionDetails: () => {},
});

export function useMetrics() {
  return useContext(MetricsContext);
}
