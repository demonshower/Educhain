// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IRegistry.sol";

/// @title Registry - EduChain Participant Registration
/// @notice Implements anti-Sybil registration with dual-asset (credit stake + academic reputation)
/// @dev Students and teachers register with DID credentials; reputation tracks academic integrity
contract Registry is IRegistry {
    uint256 public constant MIN_STAKE = 1 ether; // Minimum credit stake (1 credit token)
    uint256 public constant INITIAL_REPUTATION = 100;
    uint256 public constant MAX_REPUTATION = 10000;

    mapping(address => AgentInfo) private agents;
    address[] public registeredAgents;

    address public owner;
    address public disputeContract; // Only dispute contract can slash/update reputation

    modifier onlyOwner() {
        require(msg.sender == owner, "Registry: not owner");
        _;
    }

    modifier onlyDispute() {
        require(msg.sender == disputeContract, "Registry: caller is not dispute contract");
        _;
    }

    modifier onlyRegistered(address participant) {
        require(agents[participant].active, "Registry: participant not registered");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setDisputeContract(address _dispute) external onlyOwner {
        require(disputeContract == address(0), "Registry: dispute contract already set");
        disputeContract = _dispute;
    }

    /// @notice Register a participant (student/teacher) with DID and verifiable credential
    /// @param did The W3C DID hash (e.g., student number hash)
    /// @param vcProof Verifiable credential proof bytes (e.g., enrollment verification)
    function register(bytes32 did, bytes calldata vcProof) external payable override {
        require(!agents[msg.sender].active, "Registry: already registered");
        require(msg.value >= MIN_STAKE, "Registry: insufficient credit stake");
        require(did != bytes32(0), "Registry: invalid DID");
        require(vcProof.length > 0, "Registry: empty VC proof");

        agents[msg.sender] = AgentInfo({
            did: did,
            owner: msg.sender,
            stake: msg.value,
            reputation: INITIAL_REPUTATION,
            registeredAt: block.timestamp,
            active: true
        });

        registeredAgents.push(msg.sender);
        emit AgentRegistered(msg.sender, did, msg.value);
    }

    /// @notice Deregister and withdraw remaining credit stake
    function deregister() external override onlyRegistered(msg.sender) {
        AgentInfo storage info = agents[msg.sender];
        uint256 refund = info.stake;
        info.active = false;
        info.stake = 0;

        (bool success, ) = msg.sender.call{value: refund}("");
        require(success, "Registry: refund failed");
    }

    /// @notice Get participant info
    function getAgent(address participant) external view override returns (AgentInfo memory) {
        return agents[participant];
    }

    /// @notice Calculate participant weight = credit_stake × academic_reputation
    /// @dev Used for review assignment priority and voting weight
    function getWeight(address participant) external view override returns (uint256) {
        AgentInfo storage info = agents[participant];
        if (!info.active) return 0;
        return info.stake * info.reputation;
    }

    /// @notice Slash participant credit stake (called by dispute contract only)
    /// @dev Triggered when academic dishonesty is confirmed
    function slash(address participant, uint256 amount, string calldata reason)
        external
        override
        onlyDispute
        onlyRegistered(participant)
    {
        AgentInfo storage info = agents[participant];
        uint256 slashAmount = amount > info.stake ? info.stake : amount;
        info.stake -= slashAmount;

        // If stake drops below minimum, deactivate
        if (info.stake < MIN_STAKE) {
            info.active = false;
        }

        emit AgentSlashed(participant, slashAmount, reason);
    }

    /// @notice Update participant academic reputation (called by dispute contract only)
    function updateReputation(address participant, int256 delta)
        external
        override
        onlyDispute
        onlyRegistered(participant)
    {
        AgentInfo storage info = agents[participant];
        uint256 oldRep = info.reputation;

        if (delta < 0 && uint256(-delta) > info.reputation) {
            info.reputation = 0;
        } else if (delta > 0 && info.reputation + uint256(delta) > MAX_REPUTATION) {
            info.reputation = MAX_REPUTATION;
        } else {
            info.reputation = uint256(int256(info.reputation) + delta);
        }

        emit ReputationUpdated(participant, oldRep, info.reputation);
    }

    /// @notice Get total registered participant count
    function agentCount() external view returns (uint256) {
        return registeredAgents.length;
    }

    receive() external payable {}
}
