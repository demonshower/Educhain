#!/usr/bin/env bash
# EduChain One-Click Setup & Experiment Runner
# Usage:
#   ./setup.sh              — install deps and run full experiments
#   ./setup.sh --fast       — install deps and run fast-mode experiments (8 contracts, ~10min)
#   ./setup.sh --quick      — install deps and run quick-mode (4 contracts, ~5min)
#   ./setup.sh --skip-deps  — skip installation, just run experiments
#   ./setup.sh --api-key <KEY> --fast  — pass LLM API key inline

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
PYTHON=${PYTHON:-python3}
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$REPO_DIR/.venv"
RESULTS_DIR="$REPO_DIR/experiments/results"

RUN_MODE="full"      # full | fast | quick
SKIP_DEPS=false
API_KEY="${LLM_API_KEY:-}"
BASELINES=""
MAX_WORKERS=8
DATASET_PATH=""

# ── Argument Parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --fast)         RUN_MODE="fast";    shift ;;
        --quick)        RUN_MODE="quick";   shift ;;
        --skip-deps)    SKIP_DEPS=true;     shift ;;
        --api-key)      API_KEY="$2";       shift 2 ;;
        --baselines)    BASELINES="$2";     shift 2 ;;
        --max-workers)  MAX_WORKERS="$2";   shift 2 ;;
        --dataset)      DATASET_PATH="$2";  shift 2 ;;
        -h|--help)
            grep "^#" "$0" | head -8 | sed 's/^# *//'
            exit 0 ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo -e "\033[1;34m[EduChain]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[OK]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }
die()  { echo -e "\033[1;31m[ERR]\033[0m $*" >&2; exit 1; }

# ── Prerequisite Checks ───────────────────────────────────────────────────────
check_python() {
    log "Checking Python..."
    if ! command -v "$PYTHON" &>/dev/null; then
        die "Python3 not found. Install with: sudo apt install python3 python3-pip python3-venv"
    fi
    PY_VER=$("$PYTHON" -c "import sys; print(sys.version_info[:2])")
    log "Python version: $PY_VER"
}

install_foundry() {
    if command -v forge &>/dev/null; then
        ok "Foundry already installed: $(forge --version 2>/dev/null | head -1)"
        return
    fi
    log "Installing Foundry..."
    curl -L https://foundry.paradigm.xyz | bash
    # Add to PATH for this session
    export PATH="$HOME/.foundry/bin:$PATH"
    foundryup
    ok "Foundry installed."
}

setup_venv() {
    log "Setting up Python virtual environment..."
    if [[ ! -d "$VENV_DIR" ]]; then
        "$PYTHON" -m venv "$VENV_DIR"
    fi
    # shellcheck source=/dev/null
    source "$VENV_DIR/bin/activate"
    pip install --quiet --upgrade pip
    pip install --quiet -r "$REPO_DIR/backend/requirements.txt"
    # Install experiment extras if not already in requirements
    pip install --quiet matplotlib numpy 2>/dev/null || true
    ok "Python environment ready."
}

setup_forge_std() {
    local contracts_dir="$REPO_DIR/contracts"
    local forge_std="$contracts_dir/lib/forge-std"
    if [[ -d "$forge_std" ]]; then
        ok "forge-std already present."
        return
    fi
    log "Installing forge-std into contracts/lib/..."
    (cd "$contracts_dir" && forge install foundry-rs/forge-std --no-git --no-commit 2>/dev/null) || \
        warn "forge-std install failed — sandbox tests will be skipped if forge is unavailable."
}

configure_api_key() {
    if [[ -z "$API_KEY" ]]; then
        if [[ -f "$REPO_DIR/.env" ]]; then
            # shellcheck source=/dev/null
            source "$REPO_DIR/.env"
            API_KEY="${LLM_API_KEY:-}"
        fi
    fi
    if [[ -z "$API_KEY" ]]; then
        warn "No LLM_API_KEY set. Experiments will run with the key already in config.json."
        warn "To set it: export LLM_API_KEY=<your-key>  OR  pass --api-key <key>"
        return
    fi
    export LLM_API_KEY="$API_KEY"
    ok "LLM API key configured."
}

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  EduChain — 基于区块链的智慧教育学术诚信保障系统"
echo "  实验环境配置与运行"
echo "════════════════════════════════════════════════════════════"
echo ""

cd "$REPO_DIR"

if [[ "$SKIP_DEPS" == "false" ]]; then
    check_python
    install_foundry
    setup_venv
    setup_forge_std
else
    log "Skipping dependency installation (--skip-deps)."
    if [[ -d "$VENV_DIR" ]]; then
        source "$VENV_DIR/bin/activate"
    fi
    export PATH="$HOME/.foundry/bin:$PATH"
fi

configure_api_key

mkdir -p "$RESULTS_DIR"

# Build experiment command
CMD=("$PYTHON" "-m" "experiments.run_experiments")

case "$RUN_MODE" in
    fast)   CMD+=("--fast") ;;
    quick)  CMD+=("--quick") ;;
esac

CMD+=("--output" "results")
CMD+=("--max-workers" "$MAX_WORKERS")

if [[ -n "$BASELINES" ]]; then
    CMD+=("--baselines" "$BASELINES")
fi

if [[ -n "$DATASET_PATH" ]]; then
    CMD+=("--dataset-path" "$DATASET_PATH")
fi

echo ""
log "Running experiments (mode=$RUN_MODE, workers=$MAX_WORKERS)..."
log "Command: ${CMD[*]}"
echo ""

"${CMD[@]}"

echo ""
ok "Experiments complete. Results in: $RESULTS_DIR/"
echo ""
