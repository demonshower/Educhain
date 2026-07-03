"""Pydantic models for the EduChain Smart Education System API."""

from typing import Optional

from pydantic import BaseModel, Field


# ============ Assignment Review (AI评审) ============


class AuditRequest(BaseModel):
    """AI自动评审请求 - 对学生提交的作业进行智能评审"""
    code_hash: str = Field(..., description="学生作业代码的SHA-256哈希")
    constraints: Optional[list[str]] = Field(
        default=None, description="作业硬性要求（如功能正确性、代码规范等）"
    )
    source_code: Optional[str] = Field(
        default=None, description="学生提交的源代码"
    )


class AuditResponse(BaseModel):
    """AI评审结果"""
    state_root: str = Field(..., description="评审状态的Merkle根")
    evidence_root: str = Field(..., description="评审证据的Merkle根")
    trace_root: str = Field(..., description="评审过程追踪的Merkle根")
    vulnerabilities: list = Field(
        default_factory=list, description="发现的问题列表（代码缺陷、逻辑错误等）"
    )
    severity_score: int = Field(
        ..., ge=0, le=100, description="作业质量评分 0-100"
    )
    ipfs_cid: Optional[str] = Field(
        default=None, description="完整评审报告的IPFS CID"
    )


# ============ Plagiarism Evidence Generation (查重验证代码生成) ============


class PoCRequest(BaseModel):
    """抄袭验证请求 - 生成可执行的查重验证代码"""
    vulnerability_type: str = Field(
        ..., description="问题类型（如 plagiarism, logic_error, spec_violation）"
    )
    target_contract: str = Field(
        ..., description="学生提交的目标代码"
    )
    description: str = Field(
        ..., description="问题描述（如抄袭来源、错误说明等）"
    )


class PoCResponse(BaseModel):
    """查重验证代码生成结果"""
    poc_code: str = Field(..., description="生成的验证测试代码")
    compilation_success: bool = Field(
        ..., description="验证代码是否编译成功"
    )
    exploit_type: str = Field(..., description="问题分类")
    ipfs_cid: Optional[str] = Field(
        default=None, description="验证代码的IPFS CID"
    )


# ============ Arbitration (学术仲裁评估) ============


class ArbitrationRequest(BaseModel):
    """学术仲裁请求 - 仲裁委员会评估争议"""
    task_id: int = Field(..., description="链上作业任务ID")
    proposal_state_root: str = Field(
        ..., description="原始作业提交的状态根"
    )
    challenge_description: str = Field(
        ..., description="争议描述（如抄袭论证、评分异议理由）"
    )
    poc_cid: Optional[str] = Field(
        default=None, description="争议证据的IPFS CID"
    )


class ArbitrationResponse(BaseModel):
    """仲裁评估结果"""
    vote: str = Field(
        ..., pattern="^(uphold|dismiss)$",
        description="仲裁投票：'uphold'（争议成立）或 'dismiss'（驳回）"
    )
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="裁决置信度"
    )
    reasoning: str = Field(..., description="裁决推理过程说明")


# ============ Peer Review Scoring (同行评议评分) ============


class ScoreRequest(BaseModel):
    """同行评议评分请求"""
    task_id: int = Field(..., description="链上作业任务ID")
    proposal_state_root: str = Field(
        ..., description="待评分作业的状态根"
    )
    evidence_cids: list[str] = Field(
        default_factory=list, description="评审证据的IPFS CID列表"
    )


class ScoreResponse(BaseModel):
    """同行评议评分结果"""
    score: int = Field(
        ..., ge=0, le=100, description="评审质量评分 0-100"
    )
    dimensions: dict = Field(
        default_factory=dict,
        description="多维度评分（completeness完整性, correctness正确性, code_style代码风格, innovation创新性）"
    )
    reasoning: str = Field(..., description="评分理由说明")


# ============ Sandbox Verification (沙箱验证) ============


class SandboxReplayRequest(BaseModel):
    """沙箱验证请求 - 在隔离环境中运行查重/功能验证"""
    poc_code: str = Field(..., description="验证测试代码（如查重对比、功能测试）")
    contract_source: str = Field(
        ..., description="学生提交的目标代码"
    )
    fork_rpc: Optional[str] = Field(
        default=None, description="状态分叉RPC URL"
    )
    fork_block: Optional[int] = Field(
        default=None, description="状态分叉区块号"
    )


class SandboxReplayResponse(BaseModel):
    """沙箱验证结果"""
    verdict: str = Field(
        ..., description="裁决：CHALLENGE_UPHELD（争议成立）或 DISMISSED（驳回）"
    )
    reason: str = Field(..., description="裁决理由")
    replay_trace_hash: str = Field(
        ..., description="验证执行轨迹的SHA-256哈希"
    )
    output: str = Field(..., description="验证执行输出（截断）")
    exit_code: int = Field(..., description="进程退出码")


# ============ Assignment Pickup (作业自动承接) ============


class TaskPickupRequest(BaseModel):
    """AI代理自动评审作业请求"""
    task_id: int = Field(..., description="链上作业任务ID")
    source_code: str = Field(..., description="学生提交的代码")


class TaskPickupResponse(BaseModel):
    """AI代理自动评审结果"""
    state_root: str = Field(..., description="评审状态根")
    evidence_root: str = Field(..., description="评审证据根")
    trace_root: str = Field(..., description="评审追踪根")
    recommendation: str = Field(
        ..., description="评审建议：'approve'（通过）或 'flag'（标记问题）"
    )
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="评审置信度"
    )
    severity_score: int = Field(
        ..., ge=0, le=100, description="作业质量评分"
    )
    vulnerabilities: list = Field(
        default_factory=list, description="发现的问题列表"
    )
