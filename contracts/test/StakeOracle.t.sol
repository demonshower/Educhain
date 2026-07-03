// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/StakeOracle.sol";

/// @title StakeOracleTest - Tests for dynamic parameter updates and min stake computation
contract StakeOracleTest is Test {
    StakeOracle public oracle;
    address public governance = makeAddr("governance");
    address public nonGovernance = makeAddr("nonGovernance");

    function setUp() public {
        // Deploy with default params:
        // pDetect=7000 (70%), pArbCorrect=9500 (95%)
        // auditCost=2 ETH, auditCostPrime=0.1 ETH
        // pocCost=1 ETH, alpha=6000 (60%)
        oracle = new StakeOracle(
            7000,
            9500,
            2 ether,
            0.1 ether,
            1 ether,
            6000,
            governance
        );
    }

    // ============ Min Stake Computation Tests ============

    function test_computeMinProposerStake() public view {
        // Formula: (Ca - Ca') / (Pdetect * Parb_correct)
        // = (2e18 - 0.1e18) / (0.7 * 0.95)
        // = 1.9e18 / 0.665
        // In basis points: (1.9e18 * 1e8) / (7000 * 9500)
        // = 1.9e26 / 66500000 = ~2.857e18
        uint256 minStake = oracle.computeMinProposerStake();
        // Should be approximately 2.857 ETH
        assertGt(minStake, 2.8 ether);
        assertLt(minStake, 2.9 ether);
    }

    function test_computeMinChallengerStake() public view {
        uint256 minStake = oracle.computeMinChallengerStake();
        // Should be a reasonable value > 0
        assertGt(minStake, 0);
    }

    // ============ Parameter Update Tests ============

    function test_updateParameters_governance() public {
        vm.prank(governance);
        oracle.updateParameters(8000, 9000, 3 ether, 0.2 ether, 1.5 ether, 5000);

        assertEq(oracle.pDetect(), 8000);
        assertEq(oracle.pArbCorrect(), 9000);
        assertEq(oracle.auditCost(), 3 ether);
        assertEq(oracle.auditCostPrime(), 0.2 ether);
        assertEq(oracle.pocCost(), 1.5 ether);
        assertEq(oracle.alpha(), 5000);
    }

    function test_updateParameters_revert_nonGovernance() public {
        vm.prank(nonGovernance);
        vm.expectRevert("StakeOracle: not governance");
        oracle.updateParameters(8000, 9000, 3 ether, 0.2 ether, 1.5 ether, 5000);
    }

    function test_updateParameters_revert_invalidPDetect() public {
        vm.prank(governance);
        vm.expectRevert("StakeOracle: invalid pDetect");
        oracle.updateParameters(0, 9500, 2 ether, 0.1 ether, 1 ether, 6000);
    }

    function test_updateParameters_revert_caLessThanCaPrime() public {
        vm.prank(governance);
        vm.expectRevert("StakeOracle: Ca must exceed Ca'");
        oracle.updateParameters(7000, 9500, 0.1 ether, 2 ether, 1 ether, 6000);
    }

    // ============ Stake Changes After Parameter Update ============

    function test_minStakeIncreasesWithHigherAuditCost() public {
        uint256 stakeBefore = oracle.computeMinProposerStake();

        vm.prank(governance);
        oracle.updateParameters(7000, 9500, 4 ether, 0.1 ether, 1 ether, 6000);

        uint256 stakeAfter = oracle.computeMinProposerStake();
        assertGt(stakeAfter, stakeBefore);
    }

    function test_minStakeDecreasesWithHigherDetection() public {
        uint256 stakeBefore = oracle.computeMinProposerStake();

        vm.prank(governance);
        oracle.updateParameters(9000, 9500, 2 ether, 0.1 ether, 1 ether, 6000);

        uint256 stakeAfter = oracle.computeMinProposerStake();
        assertLt(stakeAfter, stakeBefore);
    }

    // ============ Constructor Validation ============

    function test_revert_constructorInvalidParams() public {
        vm.expectRevert("StakeOracle: invalid pDetect");
        new StakeOracle(0, 9500, 2 ether, 0.1 ether, 1 ether, 6000, governance);

        vm.expectRevert("StakeOracle: invalid pArbCorrect");
        new StakeOracle(7000, 0, 2 ether, 0.1 ether, 1 ether, 6000, governance);

        vm.expectRevert("StakeOracle: Ca must exceed Ca'");
        new StakeOracle(7000, 9500, 0.1 ether, 2 ether, 1 ether, 6000, governance);

        vm.expectRevert("StakeOracle: invalid alpha");
        new StakeOracle(7000, 9500, 2 ether, 0.1 ether, 1 ether, 0, governance);
    }
}
