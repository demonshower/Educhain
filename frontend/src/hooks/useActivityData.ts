import { useMemo } from 'react';

interface ActivityDataPoint {
  name: string;
  tasks: number;
  proposals: number;
  challenges: number;
}

interface TaskStatusData {
  name: string;
  value: number;
  color: string;
}

export function useActivityData(taskCount: number) {
  const activityData = useMemo<ActivityDataPoint[]>(() => {
    // Generate mock activity data based on task count
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map((name, i) => ({
      name,
      tasks: Math.max(0, Math.floor(taskCount * (0.1 + Math.sin(i) * 0.05))),
      proposals: Math.max(0, Math.floor(taskCount * (0.08 + Math.cos(i) * 0.03))),
      challenges: Math.max(0, Math.floor(taskCount * (0.02 + Math.sin(i + 1) * 0.01))),
    }));
  }, [taskCount]);

  const statusDistribution = useMemo<TaskStatusData[]>(() => {
    const total = Math.max(taskCount, 1);
    return [
      { name: 'Open', value: Math.ceil(total * 0.3), color: '#06b6d4' },
      { name: 'Proposed', value: Math.ceil(total * 0.35), color: '#f59e0b' },
      { name: 'Challenged', value: Math.ceil(total * 0.1), color: '#f97316' },
      { name: 'Finalized', value: Math.ceil(total * 0.2), color: '#10b981' },
      { name: 'Slashed', value: Math.ceil(total * 0.05), color: '#ef4444' },
    ];
  }, [taskCount]);

  return { activityData, statusDistribution };
}
