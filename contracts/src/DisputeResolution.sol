// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IRegistry.sol";
import "./ArbitrationCommittee.sol";
import "./StakeOracle.sol";

/// @title DisputeResolution - EduChain Academic Integrity Dispute Framework
/// @notice Implements the 5-phase academic review pipeline:
///         Publish Assignment -> Submit Work -> Peer Review -> Challenge (Plagiarism Report) -> Finalize/Arbitrate
/// @dev Core contract managing the complete lifecycle of assignment submissions and academic disputes
contract DisputeResolution {
    // ============ Enums ============

    enum TaskStatus { Open, Proposed, InReview, Challenged, Finalized, Slashed }
    enum ChallengeType { FalseNegative, FalsePositive, IncompleteAnalysis, ConstraintViolation }
    // FalseNegative: Reviewer missed plagiarism
    // FalsePositive: Incorrectly flagged original work as plagiarism
    // IncompleteAnalysis: Review didn't cover all grading criteria
    // ConstraintViolation: Submission violates assignment requirements

    // ============ Structs ============

    /// @notice TaskSpec - defines the assignment task parameters
    struct TaskSpec {
        bytes32 taskId;
        bytes32 codeHash;           // Hash of the assignment requirements
        string hardConstraints;     // Grading criteria and requirements
        uint256 challengePeriod;    // Dispute window duration (default 48h)
        uint256 minStakingAmount;   // Minimum credit stake for submission
        uint256 reward;             // Credit reward pool
        address publisher;          // Task publisher (teacher)
        uint256 publishedAt;
    }

    /// @notice SemanticState - student's submission commitment
    struct SemanticState {
        string intent;
        string subtasks;
        string finalClaim;
        bytes32 stateRoot;          // Merkle root of submission content
        bytes32 evidenceRoot;       // Merkle root of supporting evidence
        bytes32 traceRoot;          // Merkle root of development traces
    }

    /// @notice Proposal - student assignment submission
    struct Proposal {
        address proposer;           // Student who submitted
        bytes32 stateRoot;
        bytes32 evidenceRoot;
        bytes32 traceRoot;
        string evidenceCID;         // IPFS CID for full submission package
        uint256 stake;              // Student's credit stake
        uint256 submittedAt;
        uint256 challengeDeadline;
    }

    /// @notice Challenge - academic dispute (e.g., plagiarism report)
    struct Challenge {
        address challenger;         // Reporter
        ChallengeType challengeType;
        string pocCID;              // IPFS CID of plagiarism evidence
        bytes32 pocCodeHash;        // Hash of verification test code
        string description;
        uint256 stake;              // Reporter's credit stake
        uint256 submittedAt;
    }

    /// @notice VerifierScore - peer review score (commit-reveal)
    struct VerifierScore {
        address verifier;           // Peer reviewer
        bytes32 commitHash;         // keccak256(score || salt)
        uint256 score;              // Revealed score (0-100)
        bool revealed;
    }

    /// @notice ArbitrationResult - committee decision
    struct ArbitrationResult {
        bool challengeUpheld;       // true = plagiarism confirmed
        bytes32 replayTraceHash;    // Hash of sandbox verification output
        uint256 decidedAt;
        address[] arbitrators;
    }

    // ============ State ============

    IRegistry public registry;
    ArbitrationCommittee public arbitrationCommittee;
    StakeOracle public stakeOracle;
    address public owner;
    uint256 public taskCounter;
    uint256 public accumulatedProtocolFees;

    // Task lifecycle mappings
    mapping(bytes32 => TaskSpec) public tasks;
    mapping(bytes32 => TaskStatus) public taskStatus;
    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => Challenge) public challenges;
    mapping(bytes32 => ArbitrationResult) public arbitrationResults;
    mapping(bytes32 => VerifierScore[]) public verifierScores;
    mapping(bytes32 => mapping(address => uint256)) public verifierRewardsClaimed;

    // Economic parameters
    uint256 public constant ALPHA = 60;  // 60% of slashed credits go to reporter
    uint256 public constant SCORE_THRESHOLD = 50; // Minimum passing peer review score
    uint256 public constant SLASH_THRESHOLD = 30; // Auto-fail threshold
    uint256 public constant VERIFIER_REWARD_PERCENT = 10; // 10% of reward to peer reviewers
    uint256 public constant DEFAULT_CHALLENGE_PERIOD = 48 hours;

    // ============ Events ============

    event TaskPublished(bytes32 indexed taskId, address publisher, uint256 reward);
    event ProposalSubmitted(bytes32 indexed taskId, address student, bytes32 stateRoot);
    event ChallengeRaised(bytes32 indexed taskId, address challenger, ChallengeType cType);
    event TaskFinalized(bytes32 indexed taskId, address student, uint256 reward);
    event ArbitrationCompleted(bytes32 indexed taskId, bool challengeUpheld);
    event SlashExecuted(bytes32 indexed taskId, address slashed, uint256 amount);
    event ScoreBasedSlash(bytes32 indexed taskId, uint256 avgScore);
    event VerifierRewardDistributed(bytes32 indexed taskId, address reviewer, uint256 amount);

    // ============ Constructor ============

    constructor(address _registry) {
        registry = IRegistry(_registry);
        owner = msg.sender;
    }

    /// @notice Set the arbitration committee contract (one-time setup)
    function setArbitrationCommittee(address _committee) external {
        require(msg.sender == owner, "Dispute: not owner");
        require(address(arbitrationCommittee) == address(0), "Dispute: committee already set");
        arbitrationCommittee = ArbitrationCommittee(_committee);
    }

    /// @notice Set the stake oracle contract (one-time setup)
    function setStakeOracle(address _oracle) external {
        require(msg.sender == owner, "Dispute: not owner");
        require(address(stakeOracle) == address(0), "Dispute: oracle already set");
        stakeOracle = StakeOracle(_oracle);
    }

    // ============ Phase 1: Assignment Publication ============

    /// @notice Teacher publishes an assignment task with credit reward pool
    function publishTask(
        bytes32 codeHash,
        string calldata hardConstraints,
        uint256 challengePeriod,
        uint256 minStakingAmount
    ) external payable returns (bytes32 taskId) {
        require(msg.value > 0, "Dispute: credit reward pool required");
        require(codeHash != bytes32(0), "Dispute: invalid assignment hash");

        taskCounter++;
        taskId = keccak256(abi.encodePacked(msg.sender, codeHash, block.timestamp, taskCounter));

        uint256 period = challengePeriod > 0 ? challengePeriod : DEFAULT_CHALLENGE_PERIOD;

        tasks[taskId] = TaskSpec({
            taskId: taskId,
            codeHash: codeHash,
            hardConstraints: hardConstraints,
            challengePeriod: period,
            minStakingAmount: minStakingAmount > 0 ? minStakingAmount : 1 ether,
            reward: msg.value,
            publisher: msg.sender,
            publishedAt: block.timestamp
        });

        taskStatus[taskId] = TaskStatus.Open;
        emit TaskPublished(taskId, msg.sender, msg.value);
    }

    // ============ Phase 2: Student Submission ============

    /// @notice Student submits assignment with content commitment and credit stake
    function submitProposal(
        bytes32 taskId,
        bytes32 stateRoot,
        bytes32 evidenceRoot,
        bytes32 traceRoot,
        string calldata evidenceCID
    ) external payable {
        require(taskStatus[taskId] == TaskStatus.Open, "Dispute: assignment not open");
        TaskSpec storage task = tasks[taskId];

        // Use dynamic min stake from oracle if available
        uint256 minStake = task.minStakingAmount;
        if (address(stakeOracle) != address(0)) {
            uint256 oracleMin = stakeOracle.computeMinProposerStake();
            if (oracleMin > minStake) minStake = oracleMin;
        }
        require(msg.value >= minStake, "Dispute: insufficient credit stake");

        // Verify student is registered
        IRegistry.AgentInfo memory participant = registry.getAgent(msg.sender);
        require(participant.active, "Dispute: student not registered");

        proposals[taskId] = Proposal({
            proposer: msg.sender,
            stateRoot: stateRoot,
            evidenceRoot: evidenceRoot,
            traceRoot: traceRoot,
            evidenceCID: evidenceCID,
            stake: msg.value,
            submittedAt: block.timestamp,
            challengeDeadline: block.timestamp + task.challengePeriod
        });

        taskStatus[taskId] = TaskStatus.Proposed;
        emit ProposalSubmitted(taskId, msg.sender, stateRoot);
    }

    // ============ Phase 3: Peer Review (Commit-Reveal) ============

    /// @notice Peer reviewer commits a hashed score
    function commitScore(bytes32 taskId, bytes32 commitHash) external {
        require(taskStatus[taskId] == TaskStatus.Proposed, "Dispute: not in review phase");
        IRegistry.AgentInfo memory participant = registry.getAgent(msg.sender);
        require(participant.active, "Dispute: reviewer not registered");

        verifierScores[taskId].push(VerifierScore({
            verifier: msg.sender,
            commitHash: commitHash,
            score: 0,
            revealed: false
        }));
    }

    /// @notice Peer reviewer reveals their score
    function revealScore(bytes32 taskId, uint256 index, uint256 score, bytes32 salt) external {
        require(taskStatus[taskId] == TaskStatus.Proposed, "Dispute: not in review phase");
        VerifierScore storage vs = verifierScores[taskId][index];
        require(vs.verifier == msg.sender, "Dispute: not your score");
        require(!vs.revealed, "Dispute: already revealed");
        require(keccak256(abi.encodePacked(score, salt)) == vs.commitHash, "Dispute: invalid reveal");
        require(score <= 100, "Dispute: score out of range");

        vs.score = score;
        vs.revealed = true;
    }

    // ============ Phase 4: Dispute Window ============

    /// @notice Reporter raises an academic dispute (e.g., plagiarism report)
    function raiseChallenge(
        bytes32 taskId,
        ChallengeType challengeType,
        string calldata pocCID,
        bytes32 pocCodeHash,
        string calldata description
    ) external payable {
        require(taskStatus[taskId] == TaskStatus.Proposed, "Dispute: submission not in dispute window");
        Proposal storage prop = proposals[taskId];
        require(block.timestamp <= prop.challengeDeadline, "Dispute: challenge period expired");

        TaskSpec storage task = tasks[taskId];
        require(msg.value >= task.minStakingAmount, "Dispute: insufficient reporter stake");

        // Verify reporter is registered
        IRegistry.AgentInfo memory participant = registry.getAgent(msg.sender);
        require(participant.active, "Dispute: reporter not registered");
        require(msg.sender != prop.proposer, "Dispute: cannot challenge own submission");

        challenges[taskId] = Challenge({
            challenger: msg.sender,
            challengeType: challengeType,
            pocCID: pocCID,
            pocCodeHash: pocCodeHash,
            description: description,
            stake: msg.value,
            submittedAt: block.timestamp
        });

        taskStatus[taskId] = TaskStatus.Challenged;
        emit ChallengeRaised(taskId, msg.sender, challengeType);
    }

    // ============ Phase 5a: Optimistic Finalization ============

    /// @notice Finalize assignment if dispute period passed without challenge
    /// @dev Includes Shapley-value based peer reviewer reward distribution
    function finalizeOptimistic(bytes32 taskId) external {
        require(taskStatus[taskId] == TaskStatus.Proposed, "Dispute: cannot finalize");
        Proposal storage prop = proposals[taskId];
        require(block.timestamp > prop.challengeDeadline, "Dispute: challenge period active");

        // Check peer review scores meet threshold
        uint256 totalScore;
        uint256 revealedCount;
        VerifierScore[] storage scores = verifierScores[taskId];
        for (uint256 i = 0; i < scores.length; i++) {
            if (scores[i].revealed) {
                totalScore += scores[i].score;
                revealedCount++;
            }
        }

        if (revealedCount > 0) {
            uint256 avgScore = totalScore / revealedCount;
            require(avgScore >= SCORE_THRESHOLD, "Dispute: peer review scores below threshold");
        }

        // Finalize: calculate payouts
        taskStatus[taskId] = TaskStatus.Finalized;
        TaskSpec storage task = tasks[taskId];

        // Calculate peer reviewer reward pool (10% of task reward)
        uint256 verifierPool = 0;
        if (revealedCount > 0) {
            verifierPool = (task.reward * VERIFIER_REWARD_PERCENT) / 100;
            _distributeVerifierRewards(taskId, scores, verifierPool, totalScore, revealedCount);
        }

        // Student gets credit stake back + remaining reward
        uint256 studentPayout = prop.stake + task.reward - verifierPool;
        (bool success, ) = prop.proposer.call{value: studentPayout}("");
        require(success, "Dispute: payout failed");

        // Update student academic reputation positively
        registry.updateReputation(prop.proposer, int256(10));

        emit TaskFinalized(taskId, prop.proposer, task.reward);
    }

    /// @notice Distribute peer reviewer rewards based on Shapley value contribution
    /// @dev Reviewers closer to consensus get higher rewards (incentivizes honest independent review)
    function _distributeVerifierRewards(
        bytes32 taskId,
        VerifierScore[] storage scores,
        uint256 rewardPool,
        uint256 totalScore,
        uint256 revealedCount
    ) internal {
        uint256 meanScore = totalScore / revealedCount;

        uint256[] memory weights = new uint256[](scores.length);
        uint256 totalWeight = 0;

        for (uint256 i = 0; i < scores.length; i++) {
            if (!scores[i].revealed) continue;
            uint256 deviation = scores[i].score > meanScore
                ? scores[i].score - meanScore
                : meanScore - scores[i].score;
            weights[i] = 101 - deviation;
            totalWeight += weights[i];
        }

        // Distribute proportionally
        for (uint256 i = 0; i < scores.length; i++) {
            if (!scores[i].revealed || totalWeight == 0) continue;
            uint256 reward = (rewardPool * weights[i]) / totalWeight;
            if (reward > 0) {
                verifierRewardsClaimed[taskId][scores[i].verifier] = reward;
                (bool s, ) = scores[i].verifier.call{value: reward}("");
                require(s, "Dispute: reviewer reward failed");
                emit VerifierRewardDistributed(taskId, scores[i].verifier, reward);
            }
        }
    }

    // ============ Phase 5b: Arbitration Resolution ============

    /// @notice Trigger auto-fail if average peer review score is below SLASH_THRESHOLD
    function triggerScoreBasedSlash(bytes32 taskId) external {
        require(taskStatus[taskId] == TaskStatus.Proposed, "Dispute: not in proposed state");
        Proposal storage prop = proposals[taskId];
        require(block.timestamp > prop.challengeDeadline, "Dispute: challenge period active");

        VerifierScore[] storage scores = verifierScores[taskId];
        uint256 totalScore;
        uint256 revealedCount;

        for (uint256 i = 0; i < scores.length; i++) {
            if (scores[i].revealed) {
                totalScore += scores[i].score;
                revealedCount++;
            }
        }

        require(revealedCount > 0, "Dispute: no revealed scores");
        uint256 avgScore = totalScore / revealedCount;
        require(avgScore < SLASH_THRESHOLD, "Dispute: score above slash threshold");

        // Slash student credits
        taskStatus[taskId] = TaskStatus.Slashed;
        TaskSpec storage task = tasks[taskId];

        uint256 slashAmount = prop.stake;
        uint256 reviewerShare = slashAmount / revealedCount;

        // Distribute slashed credits to peer reviewers
        for (uint256 i = 0; i < scores.length; i++) {
            if (scores[i].revealed && reviewerShare > 0) {
                (bool s, ) = scores[i].verifier.call{value: reviewerShare}("");
                require(s, "Dispute: reviewer slash reward failed");
            }
        }

        // Return task reward to teacher
        (bool s2, ) = task.publisher.call{value: task.reward}("");
        require(s2, "Dispute: teacher refund failed");

        // Slash student reputation
        registry.updateReputation(prop.proposer, -50);
        registry.slash(prop.proposer, 0, "Auto-failed: low peer review scores");

        emit ScoreBasedSlash(taskId, avgScore);
        emit SlashExecuted(taskId, prop.proposer, slashAmount);
    }

    /// @notice Submit arbitration result with multi-sig verification from committee
    function submitArbitrationResult(
        bytes32 taskId,
        bool challengeUpheld,
        bytes32 replayTraceHash,
        bytes[] calldata signatures
    ) external {
        require(taskStatus[taskId] == TaskStatus.Challenged, "Dispute: not challenged");

        address[] memory arbitrators;
        if (address(arbitrationCommittee) != address(0)) {
            bool valid;
            (valid, arbitrators) = arbitrationCommittee.verifyArbitrationSignatures(
                taskId, challengeUpheld, replayTraceHash, signatures
            );
            require(valid, "Dispute: invalid arbitration signatures");
        } else {
            arbitrators = new address[](1);
            arbitrators[0] = msg.sender;
        }

        arbitrationResults[taskId] = ArbitrationResult({
            challengeUpheld: challengeUpheld,
            replayTraceHash: replayTraceHash,
            decidedAt: block.timestamp,
            arbitrators: arbitrators
        });

        _executeArbitrationOutcome(taskId, challengeUpheld);
    }

    /// @notice Internal: execute the economic outcome of arbitration
    function _executeArbitrationOutcome(bytes32 taskId, bool challengeUpheld) internal {
        Proposal storage prop = proposals[taskId];
        Challenge storage chal = challenges[taskId];
        TaskSpec storage task = tasks[taskId];

        if (challengeUpheld) {
            // Plagiarism confirmed: slash student, reward reporter
            taskStatus[taskId] = TaskStatus.Slashed;

            uint256 slashAmount = prop.stake;
            uint256 reporterReward = (slashAmount * ALPHA) / 100;
            uint256 protocolFee = slashAmount - reporterReward;
            accumulatedProtocolFees += protocolFee;

            // Return reporter stake + reward
            (bool s1, ) = chal.challenger.call{value: chal.stake + reporterReward + task.reward}("");
            require(s1, "Dispute: reporter payout failed");

            // Slash student reputation, reward reporter
            registry.updateReputation(prop.proposer, -50);
            registry.updateReputation(chal.challenger, int256(20));
            registry.slash(prop.proposer, protocolFee, "Academic dishonesty confirmed");

            emit SlashExecuted(taskId, prop.proposer, slashAmount);
        } else {
            // False report: slash reporter, reward student
            taskStatus[taskId] = TaskStatus.Finalized;

            uint256 slashAmount = chal.stake;
            uint256 studentBonus = (slashAmount * ALPHA) / 100;

            // Return student stake + reward + bonus
            (bool s2, ) = prop.proposer.call{value: prop.stake + task.reward + studentBonus}("");
            require(s2, "Dispute: student payout failed");

            // Update reputations
            registry.updateReputation(prop.proposer, int256(10));
            registry.updateReputation(chal.challenger, -30);
            registry.slash(chal.challenger, slashAmount - studentBonus, "False accusation dismissed");

            emit SlashExecuted(taskId, chal.challenger, slashAmount);
        }

        emit ArbitrationCompleted(taskId, challengeUpheld);
    }

    // ============ View Functions ============

    function getProposal(bytes32 taskId) external view returns (Proposal memory) {
        return proposals[taskId];
    }

    function getChallenge(bytes32 taskId) external view returns (Challenge memory) {
        return challenges[taskId];
    }

    function getVerifierScoreCount(bytes32 taskId) external view returns (uint256) {
        return verifierScores[taskId].length;
    }

    // ============ Committee Integration ============

    /// @notice Select arbitration committee for a disputed assignment
    function selectArbitrationCommittee(bytes32 taskId) external {
        require(taskStatus[taskId] == TaskStatus.Challenged, "Dispute: not challenged");
        require(address(arbitrationCommittee) != address(0), "Dispute: no committee contract");

        address caller = msg.sender;
        require(
            caller == challenges[taskId].challenger ||
            caller == proposals[taskId].proposer ||
            caller == tasks[taskId].publisher,
            "Dispute: not authorized to select committee"
        );

        arbitrationCommittee.selectCommittee(taskId);
    }

    /// @notice Legacy submitArbitrationResult for backward compatibility (testing only)
    function submitArbitrationResult(
        bytes32 taskId,
        bool challengeUpheld,
        bytes32 replayTraceHash,
        address[] calldata arbitrators
    ) external {
        require(taskStatus[taskId] == TaskStatus.Challenged, "Dispute: not challenged");
        require(address(arbitrationCommittee) == address(0), "Dispute: use multi-sig version");

        arbitrationResults[taskId] = ArbitrationResult({
            challengeUpheld: challengeUpheld,
            replayTraceHash: replayTraceHash,
            decidedAt: block.timestamp,
            arbitrators: arbitrators
        });

        _executeArbitrationOutcome(taskId, challengeUpheld);
    }

    // ============ Protocol Fee Withdrawal ============

    /// @notice Withdraw accumulated protocol fees (owner/institution only)
    function withdrawProtocolFees(address to) external {
        require(msg.sender == owner, "Dispute: not owner");
        require(accumulatedProtocolFees > 0, "Dispute: no fees to withdraw");

        uint256 amount = accumulatedProtocolFees;
        accumulatedProtocolFees = 0;

        (bool success, ) = to.call{value: amount}("");
        require(success, "Dispute: withdrawal failed");
    }

    receive() external payable {}
}
