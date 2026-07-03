// Contract addresses per chain
// Update these after running: scripts/deploy-local.sh

export const CHAIN_ID = 31337;

export const ADDRESSES: Record<number, {
  registry: string;
  disputeResolution: string;
  arbitrationCommittee: string;
  stakeOracle: string;
}> = {
  // Anvil local (populated by deploy-local.sh)
  31337: {
    registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    disputeResolution: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    arbitrationCommittee: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    stakeOracle: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  },
};

export function getAddresses(chainId: number) {
  const addrs = ADDRESSES[chainId];
  if (!addrs) {
    throw new Error(`No contract addresses configured for chain ${chainId}`);
  }
  return addrs;
}

export type ContractName = keyof (typeof ADDRESSES)[typeof CHAIN_ID];
