import { shortenAddress, timeAgo } from '../lib/utils';

interface EventLogItemProps {
  name: string;
  blockNumber: number;
  transactionHash: string;
  timestamp?: number;
  args: Record<string, string>;
}

const eventColors: Record<string, string> = {
  TaskPublished: 'bg-blue-600/30 text-blue-300',
  ProposalSubmitted: 'bg-yellow-600/30 text-yellow-300',
  ChallengeRaised: 'bg-orange-600/30 text-orange-300',
  CommitteeSelected: 'bg-purple-600/30 text-purple-300',
  TaskFinalized: 'bg-green-600/30 text-green-300',
  ProposerSlashed: 'bg-red-600/30 text-red-300',
  AgentRegistered: 'bg-cyan-600/30 text-cyan-300',
  ReputationUpdated: 'bg-teal-600/30 text-teal-300',
  ScoreCommitted: 'bg-indigo-600/30 text-indigo-300',
  ScoreRevealed: 'bg-pink-600/30 text-pink-300',
};

export default function EventLogItem({ name, blockNumber, transactionHash, timestamp, args }: EventLogItemProps) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-700/50 last:border-0 hover:bg-gray-800/50">
      <span className={`text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${
        eventColors[name] || 'bg-gray-600/30 text-gray-300'
      }`}>
        {name}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Block #{blockNumber}</span>
          <span className="font-mono">{shortenAddress(transactionHash)}</span>
          {timestamp && <span>{timeAgo(timestamp)}</span>}
        </div>
        {Object.keys(args).length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            {Object.entries(args).map(([key, value]) => (
              <span key={key} className="text-xs text-gray-400">
                <span className="text-gray-500">{key}:</span>{' '}
                <span className="font-mono">{typeof value === 'string' && value.length > 20 ? shortenAddress(value) : String(value)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
