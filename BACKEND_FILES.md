# EduChain 后端文件说明

## 后端架构 (FastAPI)

```
backend/
├── __init__.py
├── main.py                    # FastAPI应用入口（EduChain教育系统API）
├── requirements.txt           # Python依赖
├── routers/
│   ├── __init__.py
│   └── audit.py              # API路由：AI评审、查重验证、仲裁评估、同行互评
├── schemas/
│   ├── __init__.py
│   └── audit.py              # Pydantic数据模型（请求/响应Schema）
└── services/
    ├── __init__.py
    ├── agent_service.py      # AI评审服务单例（封装AutonomousAuditAgent）
    └── sandbox_service.py    # 沙箱验证服务（代码查重/功能验证执行）
```

## API端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/health` | GET | 健康检查，报告AI代理状态 |
| `/api/config` | GET | 返回系统公开配置参数 |
| `/api/audit/perform` | POST | AI自动评审学生代码 |
| `/api/poc/generate` | POST | 生成抄袭/问题验证代码 |
| `/api/arbitration/evaluate` | POST | 仲裁委员会评估学术争议 |
| `/api/audit/score` | POST | 同行评议多维度评分 |
| `/api/sandbox/replay` | POST | 沙箱中运行验证测试 |
| `/api/agent/pickup-task` | POST | AI代理自动承接评审任务 |

## 启动方式

```bash
# 安装依赖
pip install -r backend/requirements.txt

# 设置LLM API Key
export LLM_API_KEY=your_api_key

# 启动服务
python -m backend.main

# 访问API文档
open http://localhost:8000/docs
```
