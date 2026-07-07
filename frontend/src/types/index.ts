export enum TaskStatus {
  Open = 0,
  Proposed = 1,
  InReview = 2,
  Challenged = 3,
  Finalized = 4,
  Slashed = 5,
}

export interface Agent {
  address: string;
  did: string;
  stake: bigint;
  reputation: number;
  weight: number;
  registered: boolean;
  model?: string;
}

export interface Task {
  id: number;
  publisher: string;
  codeHash: string;
  constraints: string[];
  challengePeriod: number;
  minStake: bigint;
  reward: bigint;
  status: TaskStatus;
  proposer: string;
  challenger: string;
  stateRoot: string;
  evidenceRoot: string;
  traceRoot: string;
  ipfsCid: string;
}

export interface Proposal {
  stateRoot: string;
  evidenceRoot: string;
  traceRoot: string;
  ipfsCid: string;
  timestamp: number;
}

export interface Challenge {
  challengeType: number;
  pocCid: string;
  description: string;
  stake: bigint;
  timestamp: number;
}

export interface AuditResult {
  state_root: string;
  evidence_root: string;
  trace_root: string;
  vulnerabilities: Array<{
    type: string;
    severity: string;
    description: string;
    location: string;
  }>;
  severity_score: number;
  ipfs_cid?: string;
}

export interface PoCResult {
  poc_code: string;
  compilation_success: boolean;
  exploit_type: string;
  ipfs_cid?: string;
}

export interface ArbitrationVote {
  vote: 'uphold' | 'dismiss';
  confidence: number;
  reasoning: string;
}

export interface ScoreResult {
  score: number;
  dimensions: Record<string, number>;
  reasoning: string;
}

// New types for enhanced frontend

export interface TimelineEvent {
  name: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
  actor?: string;
  data?: string;
}

export type TxStatus = 'pending' | 'confirmed' | 'failed';

export interface TxState {
  hash: string;
  description: string;
  status: TxStatus;
  timestamp: number;
  confirmations?: number;
  error?: string;
}

export interface ProtocolEvent {
  name: string;
  blockNumber: number;
  transactionHash: string;
  timestamp?: number;
  args: Record<string, string>;
}
