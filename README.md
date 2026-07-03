# EduChain: 基于区块链的智慧教育学术诚信保障系统

Blockchain-based Smart Education Academic Integrity Assurance System

## 概述

EduChain 是一个基于区块链数据管理的智慧教育系统，利用乐观争议解决机制保障学术诚信。系统将学生作业提交、AI自动评审、同行互评、学术争议仲裁的全流程记录在区块链上，实现教育数据的不可篡改、可追溯和可验证。

### 核心理念

将"乐观执行"思想引入教育评价：默认信任学生提交的作业是原创的、AI评审结果是准确的，仅在出现争议（如抄袭举报、评分异议）时才触发代价昂贵的仲裁流程。这大幅降低了正常情况下的验证开销，同时通过经济激励（学分质押与声誉）确保各方诚实参与。

### 系统流程

```
教师发布作业任务 → 学生提交作业承诺 → AI自动评审+同行互评
        ↓ (无争议，乐观路径)                    ↓ (有争议，仲裁路径)
    自动确认成绩，发放学分               代码查重沙箱验证 → 仲裁委员会投票 → 裁决
```

### 5阶段流水线

| 阶段 | 说明 |
|------|------|
| **Publish** | 教师发布作业任务，设定评分标准与学分奖励 |
| **Submit** | 学生提交作业的语义哈希承诺（代码+报告） |
| **Review** | AI自动评审 + 多位同行评议者 commit-reveal 打分 |
| **Challenge** | 争议窗口：任何参与者可提交抄袭证据或评分异议 |
| **Finalize / Arbitrate** | 无争议则确认成绩；有争议则仲裁委员会裁决 |

## 项目结构

```
educhain/
├── contracts/                          # Solidity 智能合约 (Foundry)
│   ├── src/
│   │   ├── IRegistry.sol              # 参与者注册接口
│   │   ├── Registry.sol               # 学生/教师身份注册 + 学术声誉系统
│   │   ├── DisputeResolution.sol      # 核心：5阶段学术争议流水线
│   │   ├── ArbitrationCommittee.sol   # VRF仲裁委员会选举 + EIP-712签名
│   │   └── StakeOracle.sol            # 动态学分质押计算
│   ├── test/                          # 完整测试套件
│   └── script/
│       └── Deploy.s.sol               # 部署脚本
├── agent/                             # Python AI评审代理
│   ├── audit_agent.py                 # 基础评审框架 + 博弈论验证
│   ├── autonomous_agent.py            # LLM驱动的自主评审代理
│   └── test_e2e.py                    # 端到端测试
├── backend/                           # FastAPI 后端服务
│   ├── main.py                        # 应用入口
│   ├── routers/audit.py               # API路由
│   ├── schemas/audit.py               # 数据模型
│   └── services/
│       ├── agent_service.py           # AI评审服务
│       └── sandbox_service.py         # 代码查重/执行沙箱
├── config.json                        # 系统配置
└── README.md
```

## 核心组件

### 1. Registry — 教育身份注册与学术声誉系统

- 学生/教师使用 W3C DID（去中心化身份）注册
- **双资产模型**：学分质押（Credit Stake）+ 学术声誉（Academic Reputation）
- 参与者权重 = `credit_stake × reputation`，用于评审资格和投票权重
- 最低质押：1 学分 | 初始声誉：100 | 声誉上限：10,000
- 仅争议合约有权执行学分罚没和声誉更新

### 2. DisputeResolution — 学术争议流水线

管理作业评审的完整5阶段生命周期：

**教育场景映射：**
- `TaskSpec` → 作业任务规范（代码哈希、评分标准、截止时间、学分池）
- `Proposal` → 学生作业提交（内容哈希承诺 + 学分质押）
- `Challenge` → 学术争议（抄袭举报/评分异议 + 举证代码）
- `VerifierScore` → 同行评议分数（commit-reveal防串通）
- `ArbitrationResult` → 仲裁委员会裁决

**争议类型枚举：**

| 类型 | 说明 |
|------|------|
| FalseNegative | 评审遗漏了抄袭内容 |
| FalsePositive | 错误标记原创作品为抄袭 |
| IncompleteAnalysis | 评审未覆盖所有评分标准 |
| ConstraintViolation | 违反作业硬性要求 |

### 3. ArbitrationCommittee — 学术仲裁委员会

- **VRF随机选举**：从学术声誉 ≥ 200 的教师/高年级学生中选出
- **Fisher-Yates洗牌**：确保选举公平不可预测
- **EIP-712签名投票**：委员对验证结果签名投票
- **67%法定人数**：多数共识确保裁决公正

### 4. StakeOracle — 动态学分质押计算

基于博弈论确保学术诚信是占优策略：

```
minSubmitterStake = (Effort_honest - Effort_cheat) / (P_detect × P_arb_correct)
```

### 5. 沙箱验证环境

在隔离环境中运行代码相似度检测和功能验证：
- 代码查重（AST比对、token序列相似度）
- 功能正确性测试（自动化测试执行）
- 抄袭证据可重放验证

### 6. AI评审代理

- LLM驱动的自动评审（代码质量、逻辑正确性、文档完整性）
- 基于编译器反馈的代码验证
- 动态评审深度（根据作业分值调整）

## 快速开始

### 方式一：离线端到端演示（推荐，无需任何依赖）

最快体验完整流程的方式，无需 LLM API、区块链或安装依赖，适合录制演示视频：

```bash
python agent/demo_educhain.py
```

该脚本完整演示五阶段学术评审流水线（发布作业 → 学生提交 → AI+同行评审 → 抄袭举报 → 仲裁结算），
并打印博弈论激励相容校验结果。

### 方式二：启动完整系统

```bash
# 安装 Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 构建并测试合约
cd contracts
forge install
forge build
forge test -vvv

# 启动后端（AI 评审 API）
cd ..
pip install -r backend/requirements.txt
export LLM_API_KEY=your_api_key      # 配置 LLM 密钥
python -m backend.main
# 访问 http://localhost:8000/docs 查看交互式 API 文档

# 启动前端可视化界面
cd frontend
npm install
npm run dev
# 访问 http://localhost:3000
```

### 运行 AI 评审代理测试

```bash
cd agent
python test_e2e.py
```

## 经济模型（博弈论保障学术诚信）

### 学生诚实约束

```
Credit_stake > (Effort_honest - Effort_cheat) / (P_detect × P_arb_correct)
```

含义：学生的学分质押必须足够高，使得作弊被发现后的学分罚没损失大于作弊节省的努力。

### 举报者参与约束

```
Credit_stake > (1 / (α × P_arb)) × (C_evidence/P_detect + (1-P_arb)×S_challenger)
```

含义：当真实抄袭存在时，举报者的期望学分收益必须大于举证成本和误判风险。

### 声誉激励

| 事件 | 声誉变化 |
|------|----------|
| 作业顺利通过 | +10 |
| 被判定抄袭 | -50 |
| 成功举报抄袭 | +20 |
| 举报失败（诬告） | -30 |

## 技术栈

- **智能合约**: Solidity 0.8.24 + Foundry
- **后端服务**: Python 3.10+ / FastAPI
- **AI评审**: LLM (DeepSeek/Kimi) 驱动
- **存储**: IPFS（学术证据存储）
- **沙箱**: 隔离执行环境（代码查重+功能验证）
- **密码学**: EIP-712签名、Merkle树、SHA-256承诺

## 创新点

1. **乐观执行机制**：默认信任，仅争议时触发仲裁，显著降低教育管理开销
2. **区块链数据管理**：学术记录不可篡改、可追溯、可独立验证
3. **AI+人工混合评审**：LLM自动评审与同行互评结合，提高评价公平性
4. **博弈论激励设计**：通过经济约束使学术诚信成为理性选择
5. **去中心化学术身份**：W3C DID + 可验证凭证，跨校互认

## License

MIT
