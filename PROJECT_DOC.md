# EduChain 项目完整文档

> Blockchain-based Smart Education Academic Integrity Assurance System  
> 基于区块链数据管理的智慧教育学术诚信保障系统

---

## 一、项目概述

EduChain 是一个面向智慧教育场景的区块链数据管理系统。它将乐观争议解决机制引入学术评价流程，通过 AI 自动评审、同行互评与区块链存证的有机结合，实现教育数据的不可篡改、可追溯和可验证，同时利用博弈论经济激励确保学术诚信成为所有参与方的占优策略。

**核心设计思想：乐观执行**  
默认信任学生提交的作业是原创的、AI评审结果是准确的。只有当出现学术争议（如抄袭举报、评分异议）时，才触发代价较高的仲裁流程。这大幅降低了日常教学管理的验证开销。

**系统由四个部分组成：**

| 部分 | 技术栈 | 职责 |
|---|---|---|
| 智能合约 | Solidity 0.8.24 + Foundry | 链上学术记录、学分质押、仲裁裁决 |
| Python 后端 | FastAPI + LLM | AI评审代理、代码查重、沙箱验证 |
| AI代理 | Python + DeepSeek/Kimi | 自动评审、抄袭检测、仲裁推理 |
| 区块链存储 | IPFS + 链上承诺 | 学术证据的去中心化不可篡改存储 |

---

## 二、整体架构

```
┌────────────────────────────────────────────────────────────────┐
│                    教育管理前端界面                              │
│  作业管理 / 成绩查看 / 评审面板 / 学术争议处理                    │
└──────────────────────────┬─────────────────────────────────────┘
                           │ /api/*
┌──────────────────────────▼─────────────────────────────────────┐
│               FastAPI 后端 (port 8000)                         │
│  /api/audit/perform (AI评审)  /api/poc/generate (查重验证)      │
│  /api/arbitration/evaluate (仲裁评估)                           │
│  /api/sandbox/replay (沙箱重放)  /api/agent/pickup-task         │
└──────┬───────────────────────────────┬───────────────────────┘
       │                               │
       │  LLM API (AI评审)             │  forge test (代码验证)
┌──────▼──────────────┐        ┌───────▼──────────────────┐
│  AI评审代理          │        │  沙箱验证服务             │
│  (autonomous_agent) │        │  (sandbox_workspace)     │
└─────────────────────┘        └──────────────────────────┘
                                           │
┌──────────────────────────────────────────▼───────────────────┐
│              Foundry + 本地链 (port 8545)                     │
│   Registry  DisputeResolution  ArbitrationCommittee  StakeOracle│
└──────────────────────────────────────────────────────────────┘
```

---

## 三、教育场景映射

| 原始安全审计概念 | 智慧教育场景 |
|---|---|
| 审计任务（Task） | 作业任务（Assignment） |
| 提案者（Proposer） | 学生/作业提交者（Student） |
| 验证者（Verifier） | 同行评议者（Peer Reviewer） |
| 挑战者（Challenger） | 抄袭举报者/异议提出者 |
| 仲裁委员会 | 学术诚信仲裁委员会（教师+资深学生） |
| Agent注册（DID+质押） | 教育身份注册（学生证+学分质押） |
| 声誉系统 | 学术信誉积分 |
| 沙箱重放 | 代码查重/功能验证沙箱 |
| StakeOracle | 动态学分激励计算 |
| IPFS证据 | 不可篡改的学术档案存储 |
| PoC（漏洞验证代码） | 抄袭证据（相似代码对比+测试） |

---

## 四、五阶段学术评审流水线

### 阶段一：教师发布作业

教师调用链上合约发布作业任务，包含：
- 作业要求哈希（评分标准、代码要求等）
- 挑战窗口时长（默认48小时）
- 学分奖励池
- 最低提交质押要求

### 阶段二：学生提交作业

学生完成作业后提交：
- 作业内容的Merkle根承诺（stateRoot: 代码逻辑, evidenceRoot: 测试证据, traceRoot: 开发轨迹）
- IPFS CID（完整作业包存储地址）
- 学分质押（经济担保原创性）

### 阶段三：AI评审 + 同行互评

- AI代理自动评审：代码质量、逻辑正确性、文档完整性
- 同行评议者独立打分（0-100），采用commit-reveal防串通
- 评分维度：完整性、正确性、代码风格、创新性

### 阶段四：学术争议窗口

48小时内，任何注册参与者可发起争议：
- 提交抄袭证据（相似代码片段对比）
- 提交可执行的测试证明（证明代码功能不符合声明）
- 质押学分作为争议担保

### 阶段五：结算

**乐观路径（无争议）：**
- 确认成绩，学生获得学分奖励
- 同行评议者按Shapley值获得评审奖励
- 学生学术声誉+10

**仲裁路径（有争议）：**
- VRF随机选出3人仲裁委员会
- 沙箱中运行代码查重/功能验证
- 委员会EIP-712签名投票
- 抄袭成立：学生学分罚没，声誉-50
- 争议驳回：举报者学分罚没，声誉-30

---

## 五、API接口文档

### POST /api/audit/perform — AI自动评审

```json
请求：{
  "code_hash": "作业代码哈希",
  "source_code": "学生提交的代码",
  "constraints": ["功能正确性", "代码规范", "文档完整"]
}

响应：{
  "state_root": "评审状态根",
  "evidence_root": "证据根",
  "trace_root": "追踪根",
  "vulnerabilities": [{"type": "代码质量问题", "severity": "low"}],
  "severity_score": 85
}
```

### POST /api/poc/generate — 生成抄袭验证代码

```json
请求：{
  "vulnerability_type": "plagiarism",
  "target_contract": "学生提交代码",
  "description": "与某公开项目代码高度相似"
}

响应：{
  "poc_code": "查重验证测试代码",
  "compilation_success": true,
  "exploit_type": "code_similarity"
}
```

### POST /api/sandbox/replay — 沙箱验证

```json
请求：{
  "poc_code": "查重/功能验证测试代码",
  "contract_source": "学生提交的目标代码"
}

响应：{
  "verdict": "CHALLENGE_UPHELD",
  "reason": "代码相似度超过阈值，抄袭证据成立",
  "replay_trace_hash": "0x...",
  "exit_code": 0
}
```

---

## 六、配置参数说明

### 教育经济参数

| 参数 | 值 | 说明 |
|---|---|---|
| alpha | 60% | 罚没学分中分配给举报者的比例 |
| challenge_period | 48h | 争议窗口时长 |
| min_stake | 1 学分 | 最低提交质押 |
| score_threshold | 50 | 同行评议最低通过分 |
| slash_threshold | 30 | 低于此分数触发自动不及格 |
| verifier_reward | 10% | 同行评议者从学分池获得的比例 |

### AI评审参数

| 参数 | 说明 |
|---|---|
| model | LLM模型（DeepSeek/Kimi） |
| temperature | 0.3（偏保守确定性评审） |
| max_tokens | 2048 |

---

## 七、运行指南

### 前置条件

```bash
- Python 3.10+
- Foundry (forge, anvil)
- Node.js 18+ (可选，用于前端)
```

### 启动步骤

```bash
# 1. 启动本地区块链
anvil

# 2. 编译部署合约
cd contracts
forge build
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# 3. 启动后端服务
pip install -r backend/requirements.txt
python -m backend.main
# 访问 http://localhost:8000/docs 查看API文档

# 4. 运行合约测试
cd contracts
forge test -vvv
```

---

## 八、创新点总结

1. **区块链数据管理**：学术记录上链，不可篡改、可追溯、可独立验证
2. **乐观执行机制**：默认信任，按需仲裁，显著降低教育管理开销
3. **AI+人工混合评审**：LLM自动评审与同行互评结合，提高公平性
4. **博弈论激励设计**：通过学分质押和声誉机制使学术诚信成为理性选择
5. **去中心化身份**：W3C DID + 可验证凭证，支持跨校学术互认
6. **隐私保护**：链上仅存哈希承诺，完整数据加密存储于IPFS
