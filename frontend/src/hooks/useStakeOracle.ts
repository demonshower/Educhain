import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import StakeOracleABI from '../contracts/abis/StakeOracle.json';
import { getAddresses } from '../contracts/addresses';

interface UseStakeOracleProps {
  provider: ethers.BrowserProvider | null;
  chainId: number | null;
}

export interface OracleParams {
  pDetect: number;
  pArbCorrect: number;
  auditCost: bigint;
  auditCostPrime: bigint;
  pocCost: bigint;
  alpha: number;
  minProposerStake: bigint;
  minChallengerStake: bigint;
}

export function useStakeOracle({ provider, chainId }: UseStakeOracleProps) {
  const [params, setParams] = useState<OracleParams | null>(null);
  const [loading, setLoading] = useState(false);

  const getContract = useCallback(() => {
    if (!provider || !chainId) return null;
    const { stakeOracle } = getAddresses(chainId);
    return new ethers.Contract(stakeOracle, StakeOracleABI, provider);
  }, [provider, chainId]);

  const fetchParams = useCallback(async () => {
    const contract = getContract();
    if (!contract) return;

    setLoading(true);
    try {
      const [pDetect, pArbCorrect, auditCost, auditCostPrime, pocCost, alpha, minProposer, minChallenger] =
        await Promise.all([
          contract.pDetect(),
          contract.pArbCorrect(),
          contract.auditCost(),
          contract.auditCostPrime(),
          contract.pocCost(),
          contract.alpha(),
          contract.computeMinProposerStake(),
          contract.computeMinChallengerStake(),
        ]);

      setParams({
        pDetect: Number(pDetect),
        pArbCorrect: Number(pArbCorrect),
        auditCost,
        auditCostPrime,
        pocCost,
        alpha: Number(alpha),
        minProposerStake: minProposer,
        minChallengerStake: minChallenger,
      });
    } catch (err) {
      console.error('Failed to fetch oracle params:', err);
    } finally {
      setLoading(false);
    }
  }, [getContract]);

  useEffect(() => { fetchParams(); }, [fetchParams]);

  return { params, loading, refresh: fetchParams };
}
