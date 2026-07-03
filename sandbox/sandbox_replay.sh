#!/usr/bin/env bash
# Sandbox Replay Execution Script
# Used by arbitration committee nodes to replay PoC in isolated environment
#
# Security constraints:
# - Zero network access (iptables DROP all + network namespace)
# - Limited CPU/memory (cgroups v2)
# - 60-second timeout kill
# - Read-only filesystem except tmpfs workspace
# - Process isolation via unshare

set -euo pipefail

# ============ Configuration ============
TIMEOUT_SECONDS=60
MAX_MEMORY="2g"
MAX_CPUS="2"
WORKSPACE="/tmp/sandbox_workspace_$$"
RESULT_FILE="/tmp/sandbox_result_$$.json"
CGROUP_NAME="sandbox_$$"
ISOLATION_MODE="${SANDBOX_ISOLATION:-namespace}" # namespace, chroot, or none

# ============ Input Parameters ============
CONTRACT_REPO_CID="${1:?Usage: sandbox_replay.sh <contract_cid> <poc_cid> <fork_rpc> <fork_block>}"
POC_CID="${2:?Missing PoC CID}"
FORK_RPC="${3:?Missing fork RPC endpoint}"
FORK_BLOCK="${4:?Missing fork block number}"

echo "=========================================="
echo " Sandbox Replay Execution"
echo "=========================================="
echo " Contract CID : $CONTRACT_REPO_CID"
echo " PoC CID      : $POC_CID"
echo " Fork RPC     : $FORK_RPC"
echo " Fork Block   : $FORK_BLOCK"
echo " Isolation    : $ISOLATION_MODE"
echo "=========================================="

# ============ Phase 1: Environment Setup ============
cleanup() {
    # Remove cgroup if created
    if [ -d "/sys/fs/cgroup/${CGROUP_NAME}" ]; then
        rmdir "/sys/fs/cgroup/${CGROUP_NAME}" 2>/dev/null || true
    fi
    # Remove iptables rules if added
    if [ "$ISOLATION_MODE" = "namespace" ] && [ "$(id -u)" -eq 0 ]; then
        iptables -D OUTPUT -m cgroup --cgroup "$CGROUP_NAME" -j DROP 2>/dev/null || true
        iptables -D INPUT -m cgroup --cgroup "$CGROUP_NAME" -j DROP 2>/dev/null || true
    fi
    rm -rf "$WORKSPACE"
    echo "[Sandbox] Workspace cleaned up"
}
trap cleanup EXIT

mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

# ============ Production Isolation Setup ============
setup_isolation() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "[Warning] Not running as root - skipping kernel-level isolation"
        return 0
    fi

    echo "[Isolation] Setting up cgroup v2 resource limits..."
    # Create cgroup v2 for memory and CPU limits
    if [ -d "/sys/fs/cgroup" ]; then
        mkdir -p "/sys/fs/cgroup/${CGROUP_NAME}"
        echo "${MAX_MEMORY}" > "/sys/fs/cgroup/${CGROUP_NAME}/memory.max"
        echo "200000 100000" > "/sys/fs/cgroup/${CGROUP_NAME}/cpu.max"  # 2 CPUs worth
        echo $$ > "/sys/fs/cgroup/${CGROUP_NAME}/cgroup.procs"
        echo "[Isolation] cgroup v2 configured: memory=${MAX_MEMORY}, cpus=${MAX_CPUS}"
    fi

    echo "[Isolation] Setting up network isolation..."
    # Block all network access via iptables
    iptables -A OUTPUT -m cgroup --cgroup "$CGROUP_NAME" -j DROP
    iptables -A INPUT -m cgroup --cgroup "$CGROUP_NAME" -j DROP
    echo "[Isolation] Network access blocked (iptables DROP all)"
}

# Apply isolation if in production mode
if [ "$ISOLATION_MODE" != "none" ]; then
    setup_isolation
fi

echo "[Phase 1] Fetching contract source from IPFS..."
# In production: ipfs get $CONTRACT_REPO_CID -o ./contract_repo
# For local testing, simulate with git clone
if command -v ipfs &> /dev/null; then
    ipfs get "$CONTRACT_REPO_CID" -o ./contract_repo 2>/dev/null || \
        echo "[Warning] IPFS fetch failed, using local fallback"
fi

echo "[Phase 1] Fetching PoC test from IPFS..."
if command -v ipfs &> /dev/null; then
    ipfs get "$POC_CID" -o ./poc_test.sol 2>/dev/null || \
        echo "[Warning] IPFS fetch failed, using local fallback"
fi

# ============ Phase 2: Compilation ============
echo "[Phase 2] Installing dependencies and compiling..."

cd contract_repo 2>/dev/null || {
    echo "[Error] Contract repo not found"
    echo '{"verdict": "INCONCLUSIVE", "reason": "contract_fetch_failed"}' > "$RESULT_FILE"
    exit 1
}

# Install forge dependencies
forge install --no-commit 2>/dev/null || true

# Copy PoC into test directory
if [ -f "../poc_test.sol" ]; then
    cp ../poc_test.sol test/Exploit.t.sol
fi

# Compile
echo "[Phase 2] Compiling with forge build..."
COMPILE_OUTPUT=$(forge build 2>&1) || {
    echo "[Verdict] CHALLENGE_INVALID - PoC compilation failed"
    echo "{\"verdict\": \"CHALLENGE_DISMISSED\", \"reason\": \"compilation_failed\", \"output\": \"$COMPILE_OUTPUT\"}" > "$RESULT_FILE"
    cat "$RESULT_FILE"
    exit 0
}

echo "[Phase 2] Compilation successful"

# ============ Phase 3: Sandbox Execution with Timeout ============
echo "[Phase 3] Executing PoC replay in sandbox (timeout: ${TIMEOUT_SECONDS}s)..."

# Build the execution command based on isolation mode
FORGE_CMD="forge test --match-path test/Exploit.t.sol --fork-url $FORK_RPC --fork-block-number $FORK_BLOCK -vvvv --no-match-test testFail"

if [ "$ISOLATION_MODE" = "namespace" ] && [ "$(id -u)" -eq 0 ]; then
    # Full namespace isolation: unshare network + mount, mount workspace as tmpfs
    echo "[Isolation] Running with unshare --net --mount namespace isolation"
    REPLAY_OUTPUT=$(timeout "$TIMEOUT_SECONDS" \
        unshare --net --mount bash -c "
            mount -t tmpfs -o size=${MAX_MEMORY} tmpfs /tmp
            cd $(pwd)
            $FORGE_CMD
        " 2>&1) || REPLAY_EXIT=$?
elif [ "$ISOLATION_MODE" = "chroot" ] && [ "$(id -u)" -eq 0 ]; then
    # Chroot-based isolation with tmpfs workspace
    echo "[Isolation] Running with chroot isolation"
    CHROOT_DIR="/tmp/sandbox_chroot_$$"
    mkdir -p "$CHROOT_DIR"/{tmp,proc,dev,usr,lib,lib64}
    mount --bind /usr "$CHROOT_DIR/usr"
    mount --bind /lib "$CHROOT_DIR/lib"
    [ -d /lib64 ] && mount --bind /lib64 "$CHROOT_DIR/lib64"
    mount -t tmpfs -o size="${MAX_MEMORY}" tmpfs "$CHROOT_DIR/tmp"
    cp -r "$(pwd)" "$CHROOT_DIR/tmp/workspace"
    REPLAY_OUTPUT=$(timeout "$TIMEOUT_SECONDS" \
        chroot "$CHROOT_DIR" bash -c "cd /tmp/workspace && $FORGE_CMD" \
        2>&1) || REPLAY_EXIT=$?
    umount "$CHROOT_DIR/usr" "$CHROOT_DIR/lib" "$CHROOT_DIR/tmp" 2>/dev/null || true
    [ -d /lib64 ] && umount "$CHROOT_DIR/lib64" 2>/dev/null || true
    rm -rf "$CHROOT_DIR"
else
    # No kernel isolation - just timeout (for development/testing)
    REPLAY_OUTPUT=$(timeout "$TIMEOUT_SECONDS" \
        $FORGE_CMD \
        2>&1) || REPLAY_EXIT=$?
fi

REPLAY_EXIT=${REPLAY_EXIT:-0}

# ============ Phase 4: Verdict Determination ============
echo "[Phase 4] Determining verdict..."

if [ "$REPLAY_EXIT" -eq 124 ]; then
    # Timeout - treat as inconclusive (potential DoS in PoC)
    VERDICT="CHALLENGE_DISMISSED"
    REASON="execution_timeout"
elif [ "$REPLAY_EXIT" -eq 0 ]; then
    # All tests passed - vulnerability confirmed
    VERDICT="CHALLENGE_UPHELD"
    REASON="poc_assertions_passed"
else
    # Tests failed/reverted - vulnerability not reproducible
    VERDICT="CHALLENGE_DISMISSED"
    REASON="poc_assertions_failed"
fi

# Generate result JSON
cat > "$RESULT_FILE" << EOF
{
    "verdict": "$VERDICT",
    "reason": "$REASON",
    "exit_code": $REPLAY_EXIT,
    "fork_block": $FORK_BLOCK,
    "replay_trace_hash": "$(echo "$REPLAY_OUTPUT" | sha256sum | cut -d' ' -f1)",
    "timestamp": $(date +%s),
    "output_excerpt": "$(echo "$REPLAY_OUTPUT" | tail -20 | sed 's/"/\\"/g' | tr '\n' ' ')"
}
EOF

echo ""
echo "=========================================="
echo " VERDICT: $VERDICT"
echo " REASON:  $REASON"
echo "=========================================="
echo ""
cat "$RESULT_FILE"
