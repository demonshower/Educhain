// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

/// @title PoC Template - Foundry-compliant Counter-case for Dispute Challenges
/// @notice Challengers must follow this template structure for valid PoC submission
/// @dev All PoCs must:
///   1. Inherit from forge-std/Test.sol
///   2. Specify exact fork block in setUp()
///   3. Include clear assertion proving constraint violation
abstract contract PoCTemplate is Test {
    // ============ Fork Configuration ============
    // Challenger MUST set these in setUp()
    uint256 internal forkBlock;
    string internal forkRPC;

    // ============ Target Contract ============
    address internal pocTarget;
    address internal attacker;

    // ============ Setup ============
    function setUp() public virtual {
        // Step 1: Create fork at exact block height for deterministic replay
        // vm.createSelectFork(forkRPC, forkBlock);

        // Step 2: Label addresses for trace readability
        vm.label(pocTarget, "TargetContract");
        vm.label(attacker, "Attacker");

        // Step 3: Setup attacker with initial funds if needed
        // vm.deal(attacker, 100 ether);
    }

    // ============ Exploit Execution ============
    /// @notice Main exploit function - must demonstrate the vulnerability
    /// @dev Must end with assertions proving constraint violation
    function testExploit() public virtual;

    // ============ Helper: Assert Profit ============
    function _assertProfit(address who, uint256 minProfit) internal view {
        assertGt(
            who.balance,
            minProfit,
            "PoC: attacker did not achieve expected profit"
        );
    }

    // ============ Helper: Assert Invariant Broken ============
    function _assertInvariantBroken(bool condition, string memory desc) internal pure {
        assertTrue(condition, string.concat("PoC: invariant still holds - ", desc));
    }
}

/// @title ExampleExploit - Sample PoC demonstrating price manipulation via flash loan
/// @notice This is an EXAMPLE. Challengers should replace with actual exploit logic.
/// @dev This contract is an EXAMPLE only. It requires a real RPC endpoint to run.
///      Mark as abstract to prevent Foundry from executing it in CI.
abstract contract ExampleExploit is PoCTemplate {
    // Example: Vulnerable DeFi pool
    // IVulnerablePool public pool = IVulnerablePool(0x...);
    // IERC20 public token = IERC20(0x...);

    function setUp() public override {
        // Fork mainnet at specific block where vulnerability exists
        forkBlock = 18_500_000; // Example block
        forkRPC = "https://eth-mainnet.alchemyapi.io/v2/KEY";
        pocTarget = address(0xdead); // Replace with actual target

        attacker = makeAddr("attacker");

        // Create fork
        vm.createSelectFork(forkRPC, forkBlock);

        // Fund attacker
        vm.deal(attacker, 100 ether);

        super.setUp();
    }

    function testExploit() public override {
        uint256 attackerBalanceBefore = attacker.balance;

        // ============ Attack Sequence ============
        vm.startPrank(attacker);

        // Step 1: Flash loan to get large capital
        // flashLender.flashLoan(1000 ether);

        // Step 2: Manipulate price oracle
        // pool.swap(largeAmount, ...);

        // Step 3: Exploit mispriced assets
        // vulnerableVault.borrow(inflatedCollateral);

        // Step 4: Repay flash loan, keep profit
        // flashLender.repay(1000 ether + fee);

        vm.stopPrank();

        // ============ Assertions ============
        // Prove the attack was profitable (constraint violated)
        uint256 attackerBalanceAfter = attacker.balance;
        assertGt(
            attackerBalanceAfter,
            attackerBalanceBefore,
            "PoC: Attack must be profitable to prove vulnerability"
        );

        // Prove specific business invariant was broken
        // Example: pool reserves should never drop below minimum
        // assertLt(pool.totalReserves(), pool.MIN_RESERVES(), "PoC: Reserve invariant broken");
    }
}
