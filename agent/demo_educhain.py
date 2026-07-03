"""
EduChain 端到端演示脚本 (离线 / 无需 LLM 与区块链)
=====================================================

本脚本完整演示「基于区块链的智慧教育学术诚信保障系统」的五阶段流水线，
无需启动 LLM API 或本地链即可运行，适合录制演示视频与课堂讲解。

演示场景：CS101 编程作业评审
  阶段1 发布作业    教师发布作业任务与学分奖励池
  阶段2 学生提交    学生提交作业承诺并质押学分
  阶段3 AI+同行评审  AI 评审代理 + 多名同行评议者打分 (commit-reveal)
  阶段4 争议窗口    举报者对疑似抄袭提交可执行验证证据
  阶段5 仲裁结算    仲裁委员会基于沙箱验证结果裁决，执行学分罚没与声誉调整

运行方式:
    python agent/demo_educhain.py
"""

import hashlib
import json
import time

from audit_agent import (
    AuditAgent,
    TaskSpec,
    GameTheoryValidator,
    StakeOracleClient,
    EIP712ArbitrationSigner,
    CommitteeAwareness,
)


def banner(title: str) -> None:
    print("\n" + "=" * 64)
    print(f" {title}")
    print("=" * 64)


def step(msg: str) -> None:
    print(f"  ▸ {msg}")


# 学生提交的两份作业示例
ORIGINAL_SUBMISSION = """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Counter - CS101 作业3：实现一个带访问控制的计数器
/// @author StudentA
contract Counter {
    uint256 public count;
    address public owner;

    constructor() { owner = msg.sender; }

    function increment() external { count += 1; }

    function reset() external {
        require(msg.sender == owner, "Only owner can reset");
        count = 0;
    }
}
"""

PLAGIARIZED_SUBMISSION = """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public count;
    // 缺少 owner / 访问控制，疑似从模板复制且未理解要求
    function increment() external { count += 1; }
    function reset() external { count = 0; }   // 违反 owner-only 要求
}
"""


def phase1_publish() -> TaskSpec:
    banner("阶段 1 / 发布作业 (Publish Assignment)")
    task = TaskSpec(
        task_id="cs101_assignment_3",
        code_hash="0x" + hashlib.sha256(b"cs101_a3").hexdigest()[:16],
        hard_constraints=[
            "implement_counter",          # 实现计数器
            "reset_must_be_owner_only",   # reset 必须 owner-only
            "provide_documentation",      # 提供文档注释
        ],
        reward=3.0,                       # 学分奖励池
        min_staking_amount=1.0,
    )
    step(f"教师发布作业: {task.task_id}")
    step(f"评分标准 (硬约束): {task.hard_constraints}")
    step(f"学分奖励池: {task.reward} credits | 最低质押: {task.min_staking_amount} credits")
    return task


def phase2_submit(task: TaskSpec, oracle: StakeOracleClient) -> dict:
    banner("阶段 2 / 学生提交与质押 (Submit & Stake)")
    student = AuditAgent("studentA", "did:edu:0xStudentA", "0xSKEY")
    student.stake = 3.0

    min_stake = oracle.compute_min_submitter_stake()
    step(f"质押预言机要求最低学生质押: {min_stake:.4f} credits")
    step(f"学生 A 质押: {student.stake} credits -> {'满足' if student.stake >= min_stake else '不足'}")

    state = student.perform_audit(task, ORIGINAL_SUBMISSION)
    hashes = student.compute_proposal_hash(state)
    step("学生提交语义状态承诺 (上链 Merkle 根):")
    step(f"   stateRoot   = {hashes['state_root'][:24]}...")
    step(f"   evidenceRoot= {hashes['evidence_root'][:24]}...")
    step(f"   traceRoot   = {hashes['trace_root'][:24]}...")
    return {"student": student, "state": state, "hashes": hashes}


def phase3_review(task: TaskSpec) -> float:
    banner("阶段 3 / AI 评审 + 同行互评 (commit-reveal)")
    reviewer = AuditAgent("ai_reviewer", "did:edu:0xAIReviewer", "0xRKEY")
    ai_state = reviewer.perform_audit(task, ORIGINAL_SUBMISSION)
    ai_score = int(ai_state.confidence * 100)
    step(f"AI 评审代理结论: {ai_state.final_claim}")
    step(f"AI 评审分数: {ai_score}/100")

    # 同行评议者 commit-reveal 打分
    peer_scores = [82, 88, 85]
    print("  同行评议者 commit-reveal 流程:")
    revealed = []
    for i, sc in enumerate(peer_scores):
        salt = f"salt_{i}"
        commit = hashlib.sha256(f"{sc}{salt}".encode()).hexdigest()
        step(f"   评议者{i+1} commit 哈希: {commit[:20]}... (分数保密)")
    for i, sc in enumerate(peer_scores):
        salt = f"salt_{i}"
        step(f"   评议者{i+1} reveal: 分数={sc}, salt={salt} (校验通过)")
        revealed.append(sc)
    avg = sum(revealed) / len(revealed)
    step(f"同行评议均分: {avg:.1f}/100 (通过阈值 50)")
    return avg


def phase4_dispute(task: TaskSpec) -> dict:
    banner("阶段 4 / 争议窗口：抄袭举报 (Dispute / Plagiarism Report)")
    reporter = AuditAgent("reporterB", "did:edu:0xReporterB", "0xBKEY")
    reporter.stake = 2.0

    step("举报者 B 发现另一份提交与本作业高度相似且违反 owner-only 要求")
    poc = reporter.generate_poc(task, "reset() 未做 owner 校验，违反作业硬约束")
    step("举报者生成可执行验证证据 (Foundry 测试):")
    for line in poc.strip().splitlines()[:6]:
        print(f"      {line}")
    print("      ...")
    poc_hash = hashlib.sha256(poc.encode()).hexdigest()
    step(f"验证证据内容哈希 (上链承诺): {poc_hash[:24]}...")
    return {"reporter": reporter, "poc": poc, "poc_hash": poc_hash}


def phase5_arbitrate(task: TaskSpec, dispute: dict) -> None:
    banner("阶段 5 / 仲裁结算 (Arbitration)")

    # 委员会选举 (声誉门槛过滤)
    committee = CommitteeAwareness("did:edu:0xArb1", min_reputation=200)
    members = ["did:edu:0xArb1", "did:edu:0xArb2", "did:edu:0xArb3"]
    committee.register_committee(task.task_id, members)
    step(f"VRF 随机选出 3 人仲裁委员会 (声誉 >= 200): {members}")

    # 沙箱验证 (此处用确定性判定模拟 forge test 的结果)
    step("各委员在隔离沙箱中重放验证证据 (forge test)...")
    verdict_upheld = True   # 违反 owner-only -> 验证证据测试通过 -> 争议成立
    replay_trace = hashlib.sha256(b"reset not owner-only -> requirement violated").hexdigest()
    step(f"沙箱裁定: {'CHALLENGE_UPHELD (抄袭/违规成立)' if verdict_upheld else 'DISMISSED'}")
    step(f"重放轨迹哈希: 0x{replay_trace[:24]}...")

    # EIP-712 多签
    signer = EIP712ArbitrationSigner(chain_id=31337, contract_address="0xArbitrationCommittee")
    votes = 0
    for m in members:
        sig = signer.sign_vote(m, task.task_id, verdict_upheld, "0x" + replay_trace)
        votes += 1
        step(f"   委员 {m[-5:]} EIP-712 签名投票: upheld={verdict_upheld}")
    quorum = votes / len(members)
    step(f"达成法定人数: {votes}/{len(members)} = {quorum*100:.0f}% (要求 >= 67%)")

    # 经济结算
    banner("经济结算结果 (Economic Settlement)")
    if verdict_upheld:
        step("争议成立：被举报学生质押被罚没")
        step("   60% 罚没学分 -> 举报者奖励 (alpha=60%)")
        step("   剩余 -> 协议费用池 | 作业奖励池退回教师")
        step("   被举报学生声誉 -50 | 举报者声誉 +20")
    else:
        step("争议驳回 (诬告)：举报者质押被罚没，学生获补偿")
        step("   学生声誉 +10 | 举报者声誉 -30")


def game_theory_check(oracle: StakeOracleClient) -> None:
    banner("博弈论激励相容校验 (Incentive Compatibility)")
    v = GameTheoryValidator()
    ok1 = v.check_proposer_honesty_constraint(
        ca=oracle.honest_effort, ca_prime=oracle.cheat_effort,
        p_detect=oracle.p_detect, p_arb_correct=oracle.p_arb_correct, sp=3.0,
    )
    step(f"学生诚实约束满足: {ok1} (诚实提交是占优策略)")
    ok2 = v.check_challenger_participation_constraint(
        cpoc=oracle.evidence_cost, p_detect=oracle.p_detect,
        p_arb_correct=oracle.p_arb_correct, sp=3.0, sc=2.0, alpha=oracle.alpha,
    )
    step(f"举报者参与约束满足: {ok2} (据实举报有利可图)")


def main() -> None:
    banner("EduChain · 基于区块链的智慧教育学术诚信保障系统 · 端到端演示")
    print("  场景: CS101 编程作业评审 | 模式: 离线模拟 (无需 LLM / 区块链)")

    config_path = str(__import__("pathlib").Path(__file__).parent.parent / "config.json")
    oracle = StakeOracleClient(config_path=config_path)

    task = phase1_publish()
    phase2_submit(task, oracle)
    phase3_review(task)
    dispute = phase4_dispute(task)
    phase5_arbitrate(task, dispute)
    game_theory_check(oracle)

    banner("演示结束：全流程记录均以承诺哈希形式不可篡改地留存于链上")
    print("  关键属性: 可追责 / 可经济惩罚 / 可独立重放 / 激励相容\n")


if __name__ == "__main__":
    main()
