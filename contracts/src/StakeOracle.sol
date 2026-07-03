// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StakeOracle - Dynamic Credit Stake Calculation for Academic Integrity
/// @notice Computes minimum credit stakes using game-theoretic formula to ensure
///         academic honesty is the dominant strategy for all participants.
/// @dev Formula: minSubmitterStake = (E_honest - E_cheat) / (P_detect × P_arb_correct)
///      Where E_honest = effort for honest work, E_cheat = effort for cheating
contract StakeOracle {
    // Parameters stored as basis points (1e4 = 100%) for precision
    uint256 public pDetect;         // Plagiarism detection probability (basis points)
    uint256 public pArbCorrect;     // Arbitration accuracy (basis points)
    uint256 public auditCost;       // E_honest: honest effort cost in wei
    uint256 public auditCostPrime;  // E_cheat: cheating effort cost in wei
    uint256 public pocCost;         // Evidence generation cost in wei
    uint256 public alpha;           // Reward distribution coefficient (basis points)

    address public governance;

    event ParametersUpdated(
        uint256 pDetect,
        uint256 pArbCorrect,
        uint256 auditCost,
        uint256 auditCostPrime,
        uint256 pocCost,
        uint256 alpha
    );

    modifier onlyGovernance() {
        require(msg.sender == governance, "StakeOracle: not governance");
        _;
    }

    constructor(
        uint256 _pDetect,
        uint256 _pArbCorrect,
        uint256 _auditCost,
        uint256 _auditCostPrime,
        uint256 _pocCost,
        uint256 _alpha,
        address _governance
    ) {
        require(_pDetect > 0 && _pDetect <= 10000, "StakeOracle: invalid pDetect");
        require(_pArbCorrect > 0 && _pArbCorrect <= 10000, "StakeOracle: invalid pArbCorrect");
        require(_auditCost > _auditCostPrime, "StakeOracle: honest effort must exceed cheat effort");
        require(_alpha > 0 && _alpha <= 10000, "StakeOracle: invalid alpha");
        pDetect = _pDetect;
        pArbCorrect = _pArbCorrect;
        auditCost = _auditCost;
        auditCostPrime = _auditCostPrime;
        pocCost = _pocCost;
        alpha = _alpha;
        governance = _governance;
    }

    /// @notice Compute minimum submitter (student) stake
    /// @dev Formula: (E_honest - E_cheat) / (P_detect × P_arb_correct)
    /// @return Minimum credit stake in wei
    function computeMinProposerStake() external view returns (uint256) {
        uint256 numerator = (auditCost - auditCostPrime) * 1e8;
        uint256 denominator = pDetect * pArbCorrect;
        return numerator / denominator;
    }

    /// @notice Compute minimum challenger (reporter) stake threshold
    /// @dev Ensures reporting plagiarism is economically viable only for genuine cases
    function computeMinChallengerStake() external view returns (uint256) {
        uint256 pocPerDetect = (pocCost * 10000) / pDetect;
        uint256 denominator = alpha * pArbCorrect;
        uint256 numerator = pocPerDetect * 1e4;
        return (numerator * 1e4) / denominator;
    }

    /// @notice Update economic parameters (governance only)
    /// @dev Called when educational environment parameters change
    function updateParameters(
        uint256 _pDetect,
        uint256 _pArbCorrect,
        uint256 _auditCost,
        uint256 _auditCostPrime,
        uint256 _pocCost,
        uint256 _alpha
    ) external onlyGovernance {
        require(_pDetect > 0 && _pDetect <= 10000, "StakeOracle: invalid pDetect");
        require(_pArbCorrect > 0 && _pArbCorrect <= 10000, "StakeOracle: invalid pArbCorrect");
        require(_auditCost > _auditCostPrime, "StakeOracle: honest effort must exceed cheat effort");
        require(_alpha > 0 && _alpha <= 10000, "StakeOracle: invalid alpha");

        pDetect = _pDetect;
        pArbCorrect = _pArbCorrect;
        auditCost = _auditCost;
        auditCostPrime = _auditCostPrime;
        pocCost = _pocCost;
        alpha = _alpha;

        emit ParametersUpdated(_pDetect, _pArbCorrect, _auditCost, _auditCostPrime, _pocCost, _alpha);
    }
}
