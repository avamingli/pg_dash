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
}

const MetricsContext = createContext<MetricsContextValue>({
  latest: null,
  history: [],
  connected: false,
  send: () => {},
  clusterInfo: null,
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
  const [history, setHistory] = useState<MetricsSnapshot[]>([]);

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
      })
      .catch(() => {});
  }, []);

  return (
    <MetricsContext.Provider value={{ latest, history, connected, send, clusterInfo }}>
      {children}
    </MetricsContext.Provider>
  );
}
