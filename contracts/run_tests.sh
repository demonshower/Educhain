#!/bin/bash
# Setup script for EduChain Smart Education System tests
# Run this script to install dependencies and execute all tests

set -e

echo "=== Installing Foundry Dependencies ==="

# Install forge-std
if [ ! -d "lib/forge-std" ]; then
    forge install foundry-rs/forge-std --no-commit
fi

echo "=== Compiling Contracts ==="
forge build

echo "=== Running All Tests ==="
echo ""
echo "--- Registry Anti-Sybil Tests ---"
forge test --match-contract RegistryAntiSybilTest -vv

echo ""
echo "--- Proposer Agent Tests ---"
forge test --match-contract ProposerAgentTest -vv

echo ""
echo "--- Challenger Agent Tests ---"
forge test --match-contract ChallengerAgentTest -vv

echo ""
echo "--- Verifier Agent Tests ---"
forge test --match-contract VerifierAgentTest -vv

echo ""
echo "--- Arbitrator Agent Tests ---"
forge test --match-contract ArbitratorAgentTest -vv

echo ""
echo "--- Sandbox Replay Tests ---"
forge test --match-contract SandboxReplayTest -vv

echo ""
echo "--- Game Theory Economics Tests ---"
forge test --match-contract GameTheoryEconomicsTest -vv

echo ""
echo "--- E2E Agent Interaction Tests ---"
forge test --match-contract E2EAgentInteractionTest -vv

echo ""
echo "--- Full Pipeline Tests ---"
forge test --match-contract FullPipelineTest -vvv

echo ""
echo "=== All Tests Complete ==="
forge test --summary
