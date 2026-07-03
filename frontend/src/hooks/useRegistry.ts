import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import RegistryABI from '../contracts/abis/Registry.json';
import { getAddresses } from '../contracts/addresses';
import type { Agent } from '../types';

interface UseRegistryProps {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  chainId: number | null;
}

const MOCK_AGENTS_KEY = 'educhain-mock-agents';

function loadMockAgents(): Agent[] {
  try {
    const stored = localStorage.getItem(MOCK_AGENTS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return parsed.map((a: Record<string, unknown>) => ({
      ...a,
      stake: BigInt(a.stake as string),
    }));
  } catch { return []; }
}

function saveMockAgents(agents: Agent[]) {
  const serializable = agents.map(a => ({
    ...a,
    stake: a.stake.toString(),
  }));
  localStorage.setItem(MOCK_AGENTS_KEY, JSON.stringify(serializable));
}

export function useRegistry({ provider, signer, chainId }: UseRegistryProps) {
  const [agents, setAgents] = useState<Agent[]>(() => loadMockAgents());
  const [agentCount, setAgentCount] = useState(() => loadMockAgents().length);
  const [loading, setLoading] = useState(false);

  const isMockMode = !provider;

  const getContract = useCallback((useSigner = false) => {
    if (!provider || !chainId) return null;
    const { registry } = getAddresses(chainId);
    const runner = useSigner && signer ? signer : provider;
    return new ethers.Contract(registry, RegistryABI, runner);
  }, [provider, signer, chainId]);

  const fetchAgents = useCallback(async () => {
    const contract = getContract();
    if (!contract) return;

    setLoading(true);
    try {
      const count = await contract.agentCount();
      setAgentCount(Number(count));

      const agentList: Agent[] = [];
      for (let i = 0; i < Number(count); i++) {
        const addr = await contract.registeredAgents(i);
        const info = await contract.getAgent(addr);
        const weight = await contract.getWeight(addr);
        agentList.push({
          address: addr,
          did: info.did,
          stake: info.stake,
          reputation: Number(info.reputation),
          weight: Number(weight),
          registered: info.active,
        });
      }
      setAgents(agentList);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, [getContract]);

  const register = useCallback(async (did: string, stakeEth: string, model?: string): Promise<{ hash: string; wait: () => Promise<unknown> }> => {
    // Mock mode: simulate registration and persist to localStorage
    if (isMockMode) {
      const mockHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const mockAddress = '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

      return {
        hash: mockHash,
        wait: async () => {
          await new Promise(r => setTimeout(r, 500));
          const newAgent: Agent = {
            address: mockAddress,
            did,
            stake: ethers.parseEther(stakeEth),
            reputation: 100,
            weight: 1,
            registered: true,
            model: model || undefined,
          };
          setAgents(prev => {
            const updated = [...prev, newAgent];
            saveMockAgents(updated);
            return updated;
          });
          setAgentCount(prev => prev + 1);
        },
      };
    }

    // Real mode: call contract
    const contract = getContract(true);
    if (!contract) throw new Error('Not connected');

    const didBytes = ethers.encodeBytes32String(did.slice(0, 31));
    const vcPayload = model ? JSON.stringify({ model }) : 'vc-proof-placeholder';
    const vcProof = ethers.toUtf8Bytes(vcPayload);
    const tx = await contract.register(didBytes, vcProof, {
      value: ethers.parseEther(stakeEth),
    });
    return {
      hash: tx.hash,
      wait: async () => {
        await tx.wait();
        await fetchAgents();
      },
    };
  }, [getContract, fetchAgents, isMockMode]);

  const getAgentInfo = useCallback(async (address: string) => {
    if (isMockMode) {
      return agents.find(a => a.address === address) || null;
    }
    const contract = getContract();
    if (!contract) return null;
    const info = await contract.getAgent(address);
    const weight = await contract.getWeight(address);
    return {
      address,
      did: info.did,
      stake: info.stake,
      reputation: Number(info.reputation),
      weight: Number(weight),
      registered: info.active,
    } as Agent;
  }, [getContract, isMockMode, agents]);

  useEffect(() => {
    if (!isMockMode) fetchAgents();
  }, [fetchAgents, isMockMode]);

  // Listen for AgentRegistered events (real mode only)
  useEffect(() => {
    const contract = getContract();
    if (!contract) return;

    const handler = () => { fetchAgents(); };
    contract.on('AgentRegistered', handler);

    return () => { contract.off('AgentRegistered', handler); };
  }, [getContract, fetchAgents]);

  return { agents, agentCount, loading, register, getAgentInfo, refresh: fetchAgents };
}
