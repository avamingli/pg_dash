import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { api } from '@/lib/api';
import type { MetricsSnapshot, ClusterInfo } from '@/types/metrics';

const MAX_HISTORY = 300; // 10 min at 2s intervals

interface MetricsContextValue {
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

const MetricsContext = createContext<MetricsContextValue>({
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

interface MetricsProviderProps {
  children: ReactNode;
}

export function MetricsProvider({ children }: MetricsProviderProps) {
  const [latest, setLatest] = useState<MetricsSnapshot | null>(null);
  const historyRef = useRef<MetricsSnapshot[]>([]);
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
  const [queryMetricsAvailable, setQueryMetricsAvailable] = useState(false);
  const [realPlanShmemAvailable, setRealPlanShmemAvailable] = useState(false);
  const [history, setHistory] = useState<MetricsSnapshot[]>([]);
  const [showVersionDetails, setShowVersionDetails] = useState(false);
  const toggleVersionDetails = useCallback(() => setShowVersionDetails(v => !v), []);

  // Build WS URL — use VITE_WS_URL (direct to backend) when set,
  // otherwise derive from current page origin (for production behind a reverse proxy).
  const wsUrl = useMemo(() => {
    const envWs = import.meta.env.VITE_WS_URL;
    return envWs
      ? `${envWs}/ws`
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
  }, []);

  const onMessage = useCallback((data: unknown) => {
    const snapshot = data as MetricsSnapshot;
    setLatest(snapshot);

    const h = historyRef.current;
    h.push(snapshot);
    if (h.length > MAX_HISTORY) {
      h.shift();
    }
    historyRef.current = h;
    // Update state reference for consumers (copy array ref to trigger re-render)
    setHistory([...h]);
  }, []);

  const { connected, send } = useWebSocket({ url: wsUrl, onMessage });

  // Fetch cluster info once on mount
  useEffect(() => {
    api.getServerInfo()
      .then(info => {
        if (info.cluster_info) {
          setClusterInfo(info.cluster_info);
        }
        setQueryMetricsAvailable(info.query_metrics_available ?? false);
        setRealPlanShmemAvailable(info.real_plan_shmem_available ?? false);
      })
      .catch(() => {});
  }, []);

  // Rebrand the browser tab when connected to a WarehousePG cluster.
  useEffect(() => {
    if (clusterInfo?.mode !== 'warehousepg') return;

    document.title = 'WarehousePG Dashboard';

    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.href = '/warehousepg-icon.png';
  }, [clusterInfo]);

  return (
    <MetricsContext.Provider value={{ latest, history, connected, send, clusterInfo, queryMetricsAvailable, realPlanShmemAvailable, showVersionDetails, toggleVersionDetails }}>
      {children}
    </MetricsContext.Provider>
  );
}
