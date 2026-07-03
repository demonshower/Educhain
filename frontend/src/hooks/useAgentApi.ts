import { useState, useCallback } from 'react';
import type { AuditResult, PoCResult, ArbitrationVote, ScoreResult } from '../types';

const API_BASE = '/api';

export interface SandboxReplayResult {
  verdict: string;
  reason: string;
  replay_trace_hash: string;
  output: string;
  exit_code: number;
}

export interface TaskPickupResult {
  state_root: string;
  evidence_root: string;
  trace_root: string;
  recommendation: string;
  confidence: number;
  severity_score: number;
  vulnerabilities: Array<{ evidence_id?: string; provenance?: string }>;
}

export function useAgentApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async <T>(path: string, body?: unknown): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      const opts: RequestInit = body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'GET' };
      const res = await fetch(`${API_BASE}${path}`, opts);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Request failed: ${res.status}`);
      }
      return await res.json() as T;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const performAudit = useCallback(async (codeHash: string, sourceCode?: string, constraints?: string[]) => {
    return request<AuditResult>('/audit/perform', { code_hash: codeHash, source_code: sourceCode, constraints });
  }, [request]);

  const generatePoC = useCallback(async (vulnerabilityType: string, targetContract: string, description: string) => {
    return request<PoCResult>('/poc/generate', { vulnerability_type: vulnerabilityType, target_contract: targetContract, description });
  }, [request]);

  const evaluateArbitration = useCallback(async (taskId: number, proposalStateRoot: string, challengeDescription: string, pocCid?: string) => {
    return request<ArbitrationVote>('/arbitration/evaluate', { task_id: taskId, proposal_state_root: proposalStateRoot, challenge_description: challengeDescription, poc_cid: pocCid });
  }, [request]);

  const scoreAudit = useCallback(async (taskId: number, proposalStateRoot: string, evidenceCids: string[]) => {
    return request<ScoreResult>('/audit/score', { task_id: taskId, proposal_state_root: proposalStateRoot, evidence_cids: evidenceCids });
  }, [request]);

  const replaySandbox = useCallback(async (pocCode: string, contractSource: string, forkRpc?: string, forkBlock?: number) => {
    return request<SandboxReplayResult>('/sandbox/replay', {
      poc_code: pocCode,
      contract_source: contractSource,
      fork_rpc: forkRpc || null,
      fork_block: forkBlock || null,
    });
  }, [request]);

  const pickupTask = useCallback(async (taskId: number, sourceCode: string) => {
    return request<TaskPickupResult>('/agent/pickup-task', { task_id: taskId, source_code: sourceCode });
  }, [request]);

  const getConfig = useCallback(async () => {
    return request<Record<string, unknown>>('/config');
  }, [request]);

  const getHealth = useCallback(async () => {
    return request<{ status: string; agent_loaded: boolean }>('/health');
  }, [request]);

  return { loading, error, performAudit, generatePoC, evaluateArbitration, scoreAudit, replaySandbox, pickupTask, getConfig, getHealth };
}
