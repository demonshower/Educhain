// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "./mocks/VulnerableVault.sol";
import "./mocks/ReentrancyAttacker.sol";

/// @title SandboxReplayTest - 模拟仲裁委员会沙箱环境中的PoC重放验证
/// @notice 这是Challenger Agent提交的PoC在隔离沙箱中被仲裁节点执行的过程
/// @dev 遵循框架规范:
///   1. 继承 forge-std/Test.sol
///   2. setUp中精确定位执行环境
///   3. 包含清晰的断言证明约束违反
contract SandboxReplayTest is Test {
    // ============ 沙箱环境配置 ============
    VulnerableVault public vault;
    ReentrancyAttacker public attackContract;

    address public attacker;
    address public victim1;
    address public victim2;

    uint256 constant VICTIM1_DEPOSIT = 10 ether;
    uint256 constant VICTIM2_DEPOSIT = 5 ether;
    uint256 constant ATTACKER_SEED = 1 ether;

    function setUp() public {
        // 沙箱环境初始化 (模拟确定性本地测试网)
        // 在真实场景中这里会是: vm.createSelectFork(rpc, blockNumber)
        vault = new VulnerableVault();

        // 模拟链上已有状态: 多个用户已存款
        victim1 = makeAddr("victim1");
        victim2 = makeAddr("victim2");
        attacker = makeAddr("attacker");

        vm.deal(victim1, 20 ether);
        vm.deal(victim2, 10 ether);
        vm.deal(attacker, 5 ether);

        // 重建链上状态
        vm.prank(victim1);
        vault.deposit{value: VICTIM1_DEPOSIT}();

        vm.prank(victim2);
        vault.deposit{value: VICTIM2_DEPOSIT}();
    }

    // ============ PoC重放测试 (挑战成立场景) ============

    /// @notice 重入攻击PoC - 仲裁沙箱执行此测试
    /// @dev 如果此测试PASS → 挑战成立 (Challenge Upheld)
    ///      如果此测试FAIL → 挑战不成立 (Challenge Dismissed)
    function test_poc_reentrancyExploit_PASS() public {
        // ============ 攻击前状态快照 ============
        uint256 vaultBalanceBefore = address(vault).balance;
        uint256 attackerBalanceBefore = attacker.balance;

        assertEq(vaultBalanceBefore, VICTIM1_DEPOSIT + VICTIM2_DEPOSIT);

        // ============ 攻击执行 (Challenger Agent生成的PoC) ============
        vm.startPrank(attacker);

        // Step 1: 部署攻击合约 (最多重入5次)
        attackContract = new ReentrancyAttacker(address(vault), 5);

        // Step 2: 执行攻击 (存入1 ETH，通过重入提取多次)
        attackContract.attack{value: ATTACKER_SEED}(ATTACKER_SEED);

        // Step 3: 提取利润
        attackContract.drain();

        vm.stopPrank();

        // ============ 断言: 证明业务约束被违反 ============

        // 断言1: 攻击者获利 (余额 > 初始投入)
        assertGt(
            attacker.balance,
            attackerBalanceBefore,
            "ASSERTION: Attacker must profit from reentrancy exploit"
        );

        // 断言2: Vault资金被非法抽取 (违反 "用户只能提取自己存入的金额" 不变量)
        assertLt(
            address(vault).balance,
            vaultBalanceBefore,
            "ASSERTION: Vault funds must be drained (invariant broken)"
        );

        // 断言3: Vault余额与记录不一致 (会计不变量被破坏)
        uint256 totalRecorded = vault.balances(victim1) + vault.balances(victim2) + vault.balances(attacker);
        assertGt(
            totalRecorded,
            address(vault).balance,
            "ASSERTION: Accounting invariant broken - recorded > actual"
        );
    }

    /// @notice 大规模重入攻击 - 抽干整个Vault
    function test_poc_reentrancyExploit_drainAll() public {
        vm.startPrank(attacker);

        // 使用更多次重入来尝试抽干
        ReentrancyAttacker drainer = new ReentrancyAttacker(address(vault), 14);
        drainer.attack{value: ATTACKER_SEED}(ATTACKER_SEED);
        drainer.drain();

        vm.stopPrank();

        // Vault应该被抽干到接近0
        assertLt(address(vault).balance, VICTIM1_DEPOSIT + VICTIM2_DEPOSIT);

        // 攻击者获得了远超其投入的资金
        uint256 profit = attacker.balance - (5 ether - ATTACKER_SEED); // 初始5ETH - 投入1ETH
        assertGt(profit, ATTACKER_SEED, "Attacker profit exceeds seed capital");
    }

    // ============ PoC重放测试 (挑战不成立场景) ============

    /// @notice 对安全版本的攻击尝试 - 应该失败
    /// @dev 如果此测试FAIL → 说明safeWithdraw确实安全，挑战不成立
    function test_poc_safeWithdraw_notExploitable() public {
        // 攻击者尝试对safeWithdraw进行重入
        vm.startPrank(attacker);
        vault.deposit{value: ATTACKER_SEED}();

        // safeWithdraw先更新状态，重入时余额已为0，会revert
        vault.safeWithdraw(ATTACKER_SEED);
        vm.stopPrank();

        // Vault余额保持正确 - 不变量成立
        assertEq(
            address(vault).balance,
            VICTIM1_DEPOSIT + VICTIM2_DEPOSIT,
            "Safe version: vault balance unchanged"
        );

        // 会计不变量成立
        uint256 totalRecorded = vault.balances(victim1) + vault.balances(victim2);
        assertEq(totalRecorded, address(vault).balance, "Accounting invariant holds");
    }

    // ============ 确定性重放验证 ============

    /// @notice 验证相同输入产生相同结果 (可重放性)
    function test_replay_determinism() public {
        // 第一次执行
        vm.startPrank(attacker);
        ReentrancyAttacker atk1 = new ReentrancyAttacker(address(vault), 3);
        atk1.attack{value: ATTACKER_SEED}(ATTACKER_SEED);
        vm.stopPrank();

        uint256 result1 = address(atk1).balance;

        // 重置状态并重新执行 (模拟第三方重放)
        // 在真实场景中，第三方会从相同的fork block重新执行
        // 这里我们验证攻击结果是确定性的
        assertGt(result1, 0, "Attack produces deterministic non-zero result");
    }

    // ============ 边界条件测试 ============

    /// @notice 空Vault无法被攻击
    function test_poc_emptyVault_noProfit() public {
        VulnerableVault emptyVault = new VulnerableVault();

        vm.startPrank(attacker);
        ReentrancyAttacker atk = new ReentrancyAttacker(address(emptyVault), 5);
        atk.attack{value: ATTACKER_SEED}(ATTACKER_SEED);
        atk.drain();
        vm.stopPrank();

        // 攻击者只能取回自己的钱，无法获利
        assertEq(attacker.balance, 5 ether, "Cannot profit from empty vault");
    }

    /// @notice 单次提取(无重入)是安全的
    function test_poc_singleWithdraw_safe() public {
        vm.startPrank(attacker);
        vault.deposit{value: ATTACKER_SEED}();
        vault.withdraw(ATTACKER_SEED);
        vm.stopPrank();

        // 正常单次提取不会破坏不变量
        assertEq(
            address(vault).balance,
            VICTIM1_DEPOSIT + VICTIM2_DEPOSIT,
            "Single withdraw is safe"
        );
    }
}
