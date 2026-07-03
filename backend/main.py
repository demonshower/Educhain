"""
FastAPI backend for EduChain - Blockchain-based Smart Education System.

Wraps the AI Review Agent to expose assignment review, plagiarism detection,
arbitration evaluation, and peer review scoring via REST API.
"""

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers.audit import router as review_router

# Load .env from project root if present
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_PATH = _PROJECT_ROOT / ".env"
if _ENV_PATH.exists():
    load_dotenv(_ENV_PATH)

# ============ App Setup ============

app = FastAPI(
    title="EduChain - 智慧教育学术诚信保障系统",
    description=(
        "基于区块链数据管理的智慧教育系统 REST API，提供 AI 自动评审、"
        "代码查重验证、学术争议仲裁评估和同行互评评分等功能。"
    ),
    version="1.0.0",
)

# CORS - allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(review_router)


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": "EduChain - 智慧教育学术诚信保障系统 API",
        "version": "1.0.0",
        "description": "基于区块链的学术诚信保障与教育数据管理系统",
        "docs": "/docs",
        "health": "/api/health",
        "features": [
            "AI自动评审",
            "代码查重验证",
            "同行互评管理",
            "学术争议仲裁",
            "区块链学术存证",
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
