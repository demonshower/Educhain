"""API router for EduChain: AI review, plagiarism detection, arbitration, and peer scoring."""

from fastapi import APIRouter, HTTPException

from backend.schemas.audit import (
    AuditRequest,
    AuditResponse,
    PoCRequest,
    PoCResponse,
    ArbitrationRequest,
    ArbitrationResponse,
    ScoreRequest,
    ScoreResponse,
    SandboxReplayRequest,
    SandboxReplayResponse,
    TaskPickupRequest,
    TaskPickupResponse,
)
from backend.services.agent_service import get_agent_service
from backend.services.sandbox_service import SandboxService

router = APIRouter(prefix="/api")


@router.get("/health")
async def health_check():
    """健康检查端点，报告AI评审代理是否已加载。"""
    service = get_agent_service()
    return {
        "status": "ok",
        "agent_loaded": service.is_loaded,
        "system": "EduChain - 智慧教育学术诚信保障系统",
        "error": service.load_error if not service.is_loaded else None,
    }


@router.get("/config")
async def get_config():
    """返回系统公开配置参数（教育经济参数、仲裁配置、质押参数）。"""
    service = get_agent_service()
    config = service.config

    return {
        "economic": config.get("economic_parameters", {}),
        "arbitration": config.get("arbitration_config", {}),
        "stake_oracle": config.get("stake_oracle_parameters", {}),
        "education": config.get("education_config", {}),
    }


@router.post("/audit/perform", response_model=AuditResponse)
async def perform_review(request: AuditRequest):
    """
    AI自动评审接口。
    对学生提交的作业代码进行智能评审，返回质量评分和问题列表。
    评审维度包括：功能正确性、代码规范、文档完整性、创新性等。
    """
    service = get_agent_service()
    if not service.is_loaded:
        raise HTTPException(
            status_code=503,
            detail=service.load_error or "AI评审代理不可用",
        )

    result = service.run_audit(request)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return AuditResponse(**result)


@router.post("/poc/generate", response_model=PoCResponse)
async def generate_evidence(request: PoCRequest):
    """
    生成抄袭/问题验证代码。
    根据问题描述生成可执行的验证测试代码，用于在沙箱中验证
    学术争议（如代码抄袭、功能不符合声明等）。
    """
    service = get_agent_service()
    if not service.is_loaded:
        raise HTTPException(
            status_code=503,
            detail=service.load_error or "AI评审代理不可用",
        )

    result = service.generate_poc(request)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return PoCResponse(**result)


@router.post("/arbitration/evaluate", response_model=ArbitrationResponse)
async def evaluate_arbitration(request: ArbitrationRequest):
    """
    学术仲裁评估接口。
    作为仲裁委员会成员评估学术争议，返回投票结果和推理过程。
    基于沙箱验证结果、争议描述和原始作业内容进行裁决。
    """
    service = get_agent_service()
    if not service.is_loaded:
        raise HTTPException(
            status_code=503,
            detail=service.load_error or "AI评审代理不可用",
        )

    result = service.evaluate_arbitration(request)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return ArbitrationResponse(**result)


@router.post("/audit/score", response_model=ScoreResponse)
async def compute_peer_score(request: ScoreRequest):
    """
    同行评议评分接口。
    对学生作业进行多维度评分，支持完整性、正确性、代码风格和创新性等维度。
    评分结果将通过commit-reveal机制上链，防止评审者串通。
    """
    service = get_agent_service()
    if not service.is_loaded:
        raise HTTPException(
            status_code=503,
            detail=service.load_error or "AI评审代理不可用",
        )

    result = service.compute_score(request)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return ScoreResponse(**result)


# ============ Sandbox Verification (沙箱验证) ============

_sandbox_service = SandboxService()


@router.post("/sandbox/replay", response_model=SandboxReplayResponse)
async def sandbox_verify(request: SandboxReplayRequest):
    """
    沙箱验证接口。
    在隔离的Foundry环境中运行查重/功能验证测试代码，返回验证裁决。
    用于学术争议的客观证据验证——代码相似度检测或功能正确性验证。
    """
    result = await _sandbox_service.replay_poc(
        poc_code=request.poc_code,
        contract_source=request.contract_source,
        fork_rpc=request.fork_rpc,
        fork_block=request.fork_block,
    )

    return SandboxReplayResponse(
        verdict=result.verdict,
        reason=result.reason,
        replay_trace_hash=result.replay_trace_hash,
        output=result.output,
        exit_code=result.exit_code,
    )


# ============ AI Agent Auto-Review (AI代理自动评审) ============


@router.post("/agent/pickup-task", response_model=TaskPickupResponse)
async def pickup_assignment(request: TaskPickupRequest):
    """
    AI代理自动承接评审任务接口。
    代理自动评审学生作业，运行完整评审流水线，
    返回评审结果（状态根、质量评分和改进建议）。
    """
    service = get_agent_service()
    if not service.is_loaded:
        raise HTTPException(
            status_code=503,
            detail=service.load_error or "AI评审代理不可用",
        )

    from backend.schemas.audit import AuditRequest

    audit_req = AuditRequest(
        code_hash=f"assignment_{request.task_id}",
        source_code=request.source_code,
    )
    result = service.run_audit(audit_req)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    # Determine recommendation based on quality score
    severity = result.get("severity_score", 0)
    if severity >= 50:
        recommendation = "approve"
        confidence = min(severity / 100.0, 0.95)
    else:
        recommendation = "flag"
        confidence = 1.0 - (severity / 100.0)

    return TaskPickupResponse(
        state_root=result["state_root"],
        evidence_root=result["evidence_root"],
        trace_root=result["trace_root"],
        recommendation=recommendation,
        confidence=confidence,
        severity_score=severity,
        vulnerabilities=result.get("vulnerabilities", []),
    )
