// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRegistry - Education Participant Registration Interface
/// @notice Defines the registration, credit staking, and academic reputation management
///         for students, peer reviewers, and arbitrators in the EduChain system.
interface IRegistry {
    struct AgentInfo {
        bytes32 did;              // W3C Decentralized Identifier hash (student/teacher ID)
        address owner;            // Participant wallet address
        uint256 stake;            // Locked credit stake (学分质押)
        uint256 reputation;       // Dynamic academic reputation score (学术声誉)
        uint256 registeredAt;     // Registration timestamp
        bool active;              // Whether the participant is currently active
    }

    event AgentRegistered(address indexed agent, bytes32 did, uint256 stake);
    event AgentSlashed(address indexed agent, uint256 amount, string reason);
    event ReputationUpdated(address indexed agent, uint256 oldRep, uint256 newRep);

    function register(bytes32 did, bytes calldata vcProof) external payable;
    function deregister() external;
    function getAgent(address agent) external view returns (AgentInfo memory);
    function getWeight(address agent) external view returns (uint256);
    function slash(address agent, uint256 amount, string calldata reason) external;
    function updateReputation(address agent, int256 delta) external;
    function agentCount() external view returns (uint256);
    function registeredAgents(uint256 index) external view returns (address);
}
