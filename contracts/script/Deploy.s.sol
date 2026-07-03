// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Registry.sol";
import "../src/DisputeResolution.sol";
import "../src/ArbitrationCommittee.sol";
import "../src/StakeOracle.sol";

/// @title Deploy - Deployment script for the EduChain Academic Integrity System
/// @notice Deploys Registry -> DisputeResolution -> ArbitrationCommittee -> StakeOracle
///         and wires them together
contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address governance = vm.envOr("GOVERNANCE_ADDRESS", vm.addr(deployerPrivateKey));

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Registry
        Registry registry = new Registry();
        console.log("Registry deployed at:", address(registry));

        // 2. Deploy DisputeResolution
        DisputeResolution dispute = new DisputeResolution(address(registry));
        console.log("DisputeResolution deployed at:", address(dispute));

        // 3. Deploy ArbitrationCommittee
        //    committeeSize=3, minReputation=200, quorum=6700 (67%)
        ArbitrationCommittee committee = new ArbitrationCommittee(
            address(registry),
            3,      // min committee size
            200,    // min reputation threshold
            6700    // 67% quorum in basis points
        );
        console.log("ArbitrationCommittee deployed at:", address(committee));

        // 4. Deploy StakeOracle
        //    Default params: pDetect=7000 (70%), pArbCorrect=9500 (95%),
        //    auditCost=2 ETH, auditCostPrime=0.1 ETH, pocCost=1 ETH, alpha=6000 (60%)
        StakeOracle oracle = new StakeOracle(
            7000,               // pDetect (70%)
            9500,               // pArbCorrect (95%)
            2 ether,            // auditCost (Ca)
            0.1 ether,          // auditCostPrime (Ca')
            1 ether,            // pocCost (Cpoc)
            6000,               // alpha (60%)
            governance
        );
        console.log("StakeOracle deployed at:", address(oracle));

        // 5. Wire contracts together
        registry.setDisputeContract(address(dispute));
        dispute.setArbitrationCommittee(address(committee));
        dispute.setStakeOracle(address(oracle));
        committee.setDisputeContract(address(dispute));

        console.log("All contracts wired successfully");

        vm.stopBroadcast();
    }
}
