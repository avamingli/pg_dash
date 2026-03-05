import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MetricsProvider } from '@/contexts/MetricsContext';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import StatusBar from '@/components/StatusBar';
import Overview from '@/pages/Overview';
import Activity from '@/pages/Activity';
import Databases from '@/pages/Databases';
import Queries from '@/pages/Queries';
import SQLEditor from '@/pages/SQLEditor';
import Replication from '@/pages/Replication';
import Locks from '@/pages/Locks';
import Vacuum from '@/pages/Vacuum';
import System from '@/pages/System';
import ServerConfig from '@/pages/ServerConfig';
import Alerts from '@/pages/Alerts';
import './index.css';

function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto p-6 bg-zinc-950">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/databases" element={<Databases />} />
            <Route path="/queries" element={<Queries />} />
            <Route path="/sql" element={<SQLEditor />} />
            <Route path="/replication" element={<Replication />} />
            <Route path="/locks" element={<Locks />} />
            <Route path="/vacuum" element={<Vacuum />} />
            <Route path="/system" element={<System />} />
            <Route path="/config" element={<ServerConfig />} />
            <Route path="/alerts" element={<Alerts />} />
          </Routes>
        </main>
        <StatusBar />
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <MetricsProvider>
        <AppLayout />
      </MetricsProvider>
    </BrowserRouter>
  );
}

export default App;
