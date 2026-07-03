import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import DisputeResolutionABI from '../contracts/abis/DisputeResolution.json';
import { getAddresses } from '../contracts/addresses';
import { TaskStatus } from '../types';

interface UseDisputeResolutionProps {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  chainId: number | null;
}

export interface TaskInfo {
  id: string;
  codeHash: string;
  hardConstraints: string;
  challengePeriod: number;
  minStakingAmount: bigint;
  reward: bigint;
  publisher: string;
  publishedAt: number;
  status: TaskStatus;
}

export interface ProposalInfo {
  proposer: string;
  stateRoot: string;
  evidenceRoot: string;
  traceRoot: string;
  evidenceCID: string;
  stake: bigint;
  timestamp: number;
  scoreCount: number;
}

export interface ChallengeInfo {
  challenger: string;
  challengeType: number;
  pocCID: string;
  pocCodeHash: string;
  description: string;
  stake: bigint;
  timestamp: number;
}

const MOCK_TASKS_KEY = 'educhain-mock-tasks';

type MockTask = { id: string; status: TaskStatus; blockNumber: number };

function loadMockTasks(): MockTask[] {
  try {
    const stored = localStorage.getItem(MOCK_TASKS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch { return []; }
}

function saveMockTasks(tasks: MockTask[]) {
  localStorage.setItem(MOCK_TASKS_KEY, JSON.stringify(tasks));
}

export function useDisputeResolution({ provider, signer, chainId }: UseDisputeResolutionProps) {
  const [taskCount, setTaskCount] = useState(() => loadMockTasks().length);
  const [tasks, setTasks] = useState<MockTask[]>(() => loadMockTasks());
  const [loading, setLoading] = useState(false);

  const isMockMode = !provider;

  const getContract = useCallback((useSigner = false) => {
    if (!provider || !chainId) return null;
    const { disputeResolution } = getAddresses(chainId);
    const runner = useSigner && signer ? signer : provider;
    return new ethers.Contract(disputeResolution, DisputeResolutionABI, runner);
  }, [provider, signer, chainId]);

  // Fetch all tasks via TaskPublished events
  const fetchAllTasks = useCallback(async () => {
    const contract = getContract();
    if (!contract) return;
    setLoading(true);
    try {
      const filter = contract.filters.TaskPublished();
      const logs = await contract.queryFilter(filter, 0);
      const taskList: Array<{ id: string; status: TaskStatus; blockNumber: number }> = [];

      for (const log of logs) {
        const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed) {
          const taskId = parsed.args.taskId;
          taskList.push({ id: taskId, status: TaskStatus.Open, blockNumber: log.blockNumber });
        }
      }

      // Batch hydrate statuses
      const hydrated = await Promise.all(
        taskList.map(async (task) => {
          try {
            const status = await contract.taskStatus(task.id);
            return { ...task, status: Number(status) as TaskStatus };
          } catch {
            return task;
          }
        })
      );

      hydrated.sort((a, b) => b.blockNumber - a.blockNumber);
      setTasks(hydrated);
      setTaskCount(hydrated.length);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [getContract]);

  const getTaskStatus = useCallback(async (taskId: string): Promise<TaskStatus> => {
    const contract = getContract();
    if (!contract) return TaskStatus.Open;
    const status = await contract.taskStatus(taskId);
    return Number(status) as TaskStatus;
  }, [getContract]);

  const publishTask = useCallback(async (
    codeHash: string,
    hardConstraints: string,
    challengePeriod: number,
    minStakingAmount: string,
    rewardEth: string
  ): Promise<{ hash: string; taskId: Promise<string | null> }> => {
    // Mock mode
    if (isMockMode) {
      const mockHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const mockTaskId = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const taskIdPromise = new Promise<string | null>(resolve => {
        setTimeout(() => {
          setTasks(prev => {
            const updated = [{ id: mockTaskId, status: TaskStatus.Open, blockNumber: Date.now() }, ...prev];
            saveMockTasks(updated);
            return updated;
          });
          setTaskCount(prev => prev + 1);
          resolve(mockTaskId);
        }, 500);
      });
      return { hash: mockHash, taskId: taskIdPromise };
    }

    const contract = getContract(true);
    if (!contract) throw new Error('Not connected');

    const tx = await contract.publishTask(
      codeHash,
      hardConstraints,
      challengePeriod,
      ethers.parseEther(minStakingAmount),
      { value: ethers.parseEther(rewardEth) }
    );

    const taskIdPromise = tx.wait().then((receipt: ethers.TransactionReceipt) => {
      const event = receipt.logs.find((log: ethers.Log) => {
        try {
          const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
          return parsed?.name === 'TaskPublished';
        } catch { return false; }
      });
      if (event) {
        const parsed = contract.interface.parseLog({ topics: [...event.topics], data: event.data });
        return parsed?.args.taskId as string;
      }
      return null;
    });

    return { hash: tx.hash, taskId: taskIdPromise };
  }, [getContract, isMockMode]);

  const submitProposal = useCallback(async (
    taskId: string,
    stateRoot: string,
    evidenceRoot: string,
    traceRoot: string,
    evidenceCID: string,
    stakeEth: string
  ): Promise<{ hash: string; wait: () => Promise<unknown> }> => {
    if (isMockMode) {
      const mockHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      return { hash: mockHash, wait: async () => {
        await new Promise(r => setTimeout(r, 500));
        setTasks(prev => {
          const updated = prev.map(t => t.id === taskId ? { ...t, status: TaskStatus.Proposed } : t);
          saveMockTasks(updated);
          return updated;
        });
      }};
    }
    const contract = getContract(true);
    if (!contract) throw new Error('Not connected');

    const tx = await contract.submitProposal(
      taskId, stateRoot, evidenceRoot, traceRoot, evidenceCID,
      { value: ethers.parseEther(stakeEth) }
    );
    return { hash: tx.hash, wait: () => tx.wait() };
  }, [getContract, isMockMode]);

  const raiseChallenge = useCallback(async (
    taskId: string,
    challengeType: number,
    pocCID: string,
    pocCodeHash: string,
    description: string,
    stakeEth: string
  ): Promise<{ hash: string; wait: () => Promise<unknown> }> => {
    if (isMockMode) {
      const mockHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      return { hash: mockHash, wait: async () => {
        await new Promise(r => setTimeout(r, 500));
        setTasks(prev => {
          const updated = prev.map(t => t.id === taskId ? { ...t, status: TaskStatus.Challenged } : t);
          saveMockTasks(updated);
          return updated;
        });
      }};
    }
    const contract = getContract(true);
    if (!contract) throw new Error('Not connected');

    const tx = await contract.raiseChallenge(
      taskId, challengeType, pocCID, pocCodeHash, description,
      { value: ethers.parseEther(stakeEth) }
    );
    return { hash: tx.hash, wait: () => tx.wait() };
  }, [getContract, isMockMode]);

  const commitScore = useCallback(async (taskId: string, commitHash: string): Promise<{ hash: string; wait: () => Promise<unknown> }> => {
    if (isMockMode) {
      const mockHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      return { hash: mockHash, wait: async () => { await new Promise(r => setTimeout(r, 300)); }};
    }
    const contract = getContract(true);
    if (!contract) throw new Error('Not connected');
    const tx = await contract.commitScore(taskId, commitHash);
    return { hash: tx.hash, wait: () => tx.wait() };
  }, [getContract, isMockMode]);

  const revealScore = useCallback(async (taskId: string, index: number, score: number, salt: string): Promise<{ hash: string; wait: () => Promise<unknown> }> => {
    if (isMockMode) {
      const mockHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      return { hash: mockHash, wait: async () => { await new Promise(r => setTimeout(r, 300)); }};
    }
    const contract = getContract(true);
    if (!contract) throw new Error('Not connected');
    const tx = await contract.revealScore(taskId, index, score, salt);
    return { hash: tx.hash, wait: () => tx.wait() };
  }, [getContract, isMockMode]);

  const finalizeOptimistic = useCallback(async (taskId: string): Promise<{ hash: string; wait: () => Promise<unknown> }> => {
    if (isMockMode) {
      const mockHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      return { hash: mockHash, wait: async () => {
        await new Promise(r => setTimeout(r, 500));
        setTasks(prev => {
          const updated = prev.map(t => t.id === taskId ? { ...t, status: TaskStatus.Finalized } : t);
          saveMockTasks(updated);
          return updated;
        });
      }};
    }
    const contract = getContract(true);
    if (!contract) throw new Error('Not connected');
    const tx = await contract.finalizeOptimistic(taskId);
    return { hash: tx.hash, wait: () => tx.wait() };
  }, [getContract, isMockMode]);

  const getProposal = useCallback(async (taskId: string): Promise<ProposalInfo | null> => {
    const contract = getContract();
    if (!contract) return null;
    try {
      const p = await contract.getProposal(taskId);
      return {
        proposer: p.proposer,
        stateRoot: p.stateRoot,
        evidenceRoot: p.evidenceRoot,
        traceRoot: p.traceRoot,
        evidenceCID: p.evidenceCID,
        stake: p.stake,
        timestamp: Number(p.timestamp),
        scoreCount: Number(p.scoreCount),
      };
    } catch { return null; }
  }, [getContract]);

  const getChallenge = useCallback(async (taskId: string): Promise<ChallengeInfo | null> => {
    const contract = getContract();
    if (!contract) return null;
    try {
      const c = await contract.getChallenge(taskId);
      return {
        challenger: c.challenger,
        challengeType: Number(c.challengeType),
        pocCID: c.pocCID,
        pocCodeHash: c.pocCodeHash,
        description: c.description,
        stake: c.stake,
        timestamp: Number(c.timestamp),
      };
    } catch { return null; }
  }, [getContract]);

  useEffect(() => { if (!isMockMode) fetchAllTasks(); }, [fetchAllTasks, isMockMode]);

  // Subscribe to real-time events
  useEffect(() => {
    const contract = getContract();
    if (!contract) return;

    const onTaskPublished = () => { fetchAllTasks(); };
    const onTaskFinalized = () => { fetchAllTasks(); };
    const onChallengeRaised = () => { fetchAllTasks(); };

    contract.on('TaskPublished', onTaskPublished);
    contract.on('TaskFinalized', onTaskFinalized);
    contract.on('ChallengeRaised', onChallengeRaised);

    return () => {
      contract.off('TaskPublished', onTaskPublished);
      contract.off('TaskFinalized', onTaskFinalized);
      contract.off('ChallengeRaised', onChallengeRaised);
    };
  }, [getContract, fetchAllTasks]);

  return {
    taskCount,
    tasks,
    loading,
    publishTask,
    submitProposal,
    raiseChallenge,
    commitScore,
    revealScore,
    finalizeOptimistic,
    getTaskStatus,
    getProposal,
    getChallenge,
    refresh: fetchAllTasks,
  };
}
