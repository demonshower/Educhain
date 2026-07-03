import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Skeleton from './components/ui/Skeleton';

const MonitorPage = lazy(() => import('./pages/MonitorPage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const AgentDetailPage = lazy(() => import('./pages/AgentDetailPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));

function PageLoader() {
  return <Skeleton variant="card" count={3} className="max-w-4xl" />;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MonitorPage />} />
          <Route path="/operations" element={<OperationsPage />} />
          <Route path="/agents/:address" element={<AgentDetailPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
