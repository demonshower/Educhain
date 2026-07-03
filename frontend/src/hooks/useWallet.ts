import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

interface WalletState {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  address: string | null;
  chainId: number | null;
  balance: bigint | null;
  isConnecting: boolean;
  error: string | null;
}

const MOCK_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const MOCK_CHAIN_ID = 31337;
const MOCK_BALANCE = ethers.parseEther('100.0');

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    provider: null,
    signer: null,
    address: MOCK_ADDRESS,
    chainId: MOCK_CHAIN_ID,
    balance: MOCK_BALANCE,
    isConnecting: false,
    error: null,
  });

  const connect = useCallback(async () => {
    setState(s => ({ ...s, isConnecting: true, error: null }));

    // If MetaMask is available, try real connection
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const network = await provider.getNetwork();
        const balance = await provider.getBalance(address);

        setState({
          provider,
          signer,
          address,
          chainId: Number(network.chainId),
          balance,
          isConnecting: false,
          error: null,
        });
        return;
      } catch {
        // Fall through to mock
      }
    }

    // Mock wallet
    setState({
      provider: null,
      signer: null,
      address: MOCK_ADDRESS,
      chainId: MOCK_CHAIN_ID,
      balance: MOCK_BALANCE,
      isConnecting: false,
      error: null,
    });
  }, []);

  const disconnect = useCallback(() => {
    setState({
      provider: null,
      signer: null,
      address: null,
      chainId: null,
      balance: null,
      isConnecting: false,
      error: null,
    });
  }, []);

  const switchToAnvil = useCallback(async () => {
    setState(s => ({ ...s, chainId: MOCK_CHAIN_ID }));
  }, []);

  // Try real wallet on mount if ethereum is available
  useEffect(() => {
    if (!window.ethereum) return;
    const tryConnect = async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);
        const accounts: string[] = await provider.send('eth_accounts', []);
        if (accounts.length === 0) return; // Keep mock
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const network = await provider.getNetwork();
        const balance = await provider.getBalance(address);
        setState({
          provider, signer, address,
          chainId: Number(network.chainId),
          balance, isConnecting: false, error: null,
        });
      } catch { /* keep mock */ }
    };
    tryConnect();
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    switchToAnvil,
    isConnected: !!state.address,
  };
}
