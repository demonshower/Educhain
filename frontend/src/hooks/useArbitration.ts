import { useCallback } from 'react';
import { ethers } from 'ethers';
import ArbitrationCommitteeABI from '../contracts/abis/ArbitrationCommittee.json';
import DisputeResolutionABI from '../contracts/abis/DisputeResolution.json';
import { getAddresses } from '../contracts/addresses';

interface UseArbitrationProps {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  chainId: number | null;
}

export function useArbitration({ provider, signer, chainId }: UseArbitrationProps) {
  const getArbitrationContract = useCallback((useSigner = false) => {
    if (!provider || !chainId) return null;
    const { arbitrationCommittee } = getAddresses(chainId);
    const runner = useSigner && signer ? signer : provider;
    return new ethers.Contract(arbitrationCommittee, ArbitrationCommitteeABI, runner);
  }, [provider, signer, chainId]);

  const getDisputeContract = useCallback((useSigner = false) => {
    if (!provider || !chainId) return null;
    const { disputeResolution } = getAddresses(chainId);
    const runner = useSigner && signer ? signer : provider;
    return new ethers.Contract(disputeResolution, DisputeResolutionABI, runner);
  }, [provider, signer, chainId]);

  const getCommittee = useCallback(async (taskId: string): Promise<string[]> => {
    const contract = getArbitrationContract();
    if (!contract) return [];
    try {
      return await contract.getCommittee(taskId);
    } catch { return []; }
  }, [getArbitrationContract]);

  const isCommitteeMember = useCallback(async (taskId: string, address: string): Promise<boolean> => {
    const contract = getArbitrationContract();
    if (!contract) return false;
    try {
      return await contract.isCommitteeMember(taskId, address);
    } catch { return false; }
  }, [getArbitrationContract]);

  const getCommitteeSize = useCallback(async (): Promise<number> => {
    const contract = getArbitrationContract();
    if (!contract) return 0;
    const size = await contract.committeeSize();
    return Number(size);
  }, [getArbitrationContract]);

  const getQuorumBps = useCallback(async (): Promise<number> => {
    const contract = getArbitrationContract();
    if (!contract) return 0;
    const bps = await contract.quorumBps();
    return Number(bps);
  }, [getArbitrationContract]);

  // Route through DisputeResolution to satisfy onlyDispute modifier
  const selectCommittee = useCallback(async (taskId: string) => {
    const contract = getDisputeContract(true);
    if (!contract) throw new Error('Not connected');
    const tx = await contract.selectArbitrationCommittee(taskId);
    return { hash: tx.hash, wait: () => tx.wait() };
  }, [getDisputeContract]);

  const signVote = useCallback(async (
    taskId: string,
    challengeUpheld: boolean,
    replayTraceHash: string
  ): Promise<string> => {
    const contract = getArbitrationContract();
    if (!contract || !signer) throw new Error('Not connected');

    const domainSeparator = await contract.DOMAIN_SEPARATOR();
    const typeHash = await contract.ARBITRATION_TYPEHASH();

    // EIP-712 structured data
    const structHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bool', 'bytes32'],
        [typeHash, taskId, challengeUpheld, replayTraceHash]
      )
    );

    const digest = ethers.keccak256(
      ethers.solidityPacked(
        ['string', 'bytes32', 'bytes32'],
        ['\x19\x01', domainSeparator, structHash]
      )
    );

    return await signer.signMessage(ethers.getBytes(digest));
  }, [getArbitrationContract, signer]);

  // Route through DisputeResolution for on-chain submission
  const submitResult = useCallback(async (
    taskId: string,
    challengeUpheld: boolean,
    replayTraceHash: string,
    signatures: string[]
  ) => {
    const contract = getDisputeContract(true);
    if (!contract) throw new Error('Not connected');
    const tx = await contract.submitArbitrationResult(
      taskId, challengeUpheld, replayTraceHash, signatures
    );
    return { hash: tx.hash, wait: () => tx.wait() };
  }, [getDisputeContract]);

  return {
    getCommittee,
    isCommitteeMember,
    getCommitteeSize,
    getQuorumBps,
    selectCommittee,
    signVote,
    submitResult,
  };
}
