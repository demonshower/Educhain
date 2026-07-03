import { shortenAddress, timeAgo } from '../lib/utils';
import type { TimelineEvent } from '../types';

interface TaskTimelineProps {
  events: TimelineEvent[];
}

const stepColors: Record<string, string> = {
  TaskPublished: 'bg-blue-500',
  ProposalSubmitted: 'bg-yellow-500',
  ChallengeRaised: 'bg-orange-500',
  CommitteeSelected: 'bg-purple-500',
  TaskFinalized: 'bg-green-500',
  ProposerSlashed: 'bg-red-500',
  ScoreCommitted: 'bg-cyan-500',
  ScoreRevealed: 'bg-teal-500',
};

export default function TaskTimeline({ events }: TaskTimelineProps) {
  if (events.length === 0) return null;

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4">Timeline</h3>
      <div className="relative pl-6 space-y-4">
        {/* Vertical line */}
        <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-gray-700" />

        {events.map((event, i) => (
          <div key={i} className="relative flex gap-3">
            {/* Dot */}
            <div className={`absolute -left-6 top-1 w-[14px] h-[14px] rounded-full border-2 border-gray-800 ${
              stepColors[event.name] || 'bg-gray-500'
            }`} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-100">{formatEventName(event.name)}</span>
                <span className="text-xs text-gray-500">Block #{event.blockNumber}</span>
              </div>
              {event.timestamp > 0 && (
                <p className="text-xs text-gray-500">{timeAgo(event.timestamp)}</p>
              )}
              {event.actor && (
                <p className="text-xs text-gray-400 font-mono">{shortenAddress(event.actor)}</p>
              )}
              {event.data && (
                <p className="text-xs text-gray-500 truncate">{event.data}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatEventName(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').trim();
}
