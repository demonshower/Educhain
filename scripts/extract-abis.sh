#!/usr/bin/env bash
set -euo pipefail

# Extract ABIs from forge compilation output to frontend
# Usage: ./scripts/extract-abis.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACTS_OUT="$PROJECT_ROOT/contracts/out"
ABI_DIR="$PROJECT_ROOT/frontend/src/contracts/abis"

# Contracts we need ABIs for
CONTRACTS=(
    "Registry"
    "DisputeResolution"
    "ArbitrationCommittee"
    "StakeOracle"
    "IRegistry"
)

echo "=== Extracting ABIs ==="
echo ""

# Ensure contracts are compiled
echo "Building contracts..."
cd "$PROJECT_ROOT/contracts"
forge build

echo ""
echo "Extracting ABIs to: $ABI_DIR"
mkdir -p "$ABI_DIR"

for contract in "${CONTRACTS[@]}"; do
    SRC_FILE="$CONTRACTS_OUT/${contract}.sol/${contract}.json"
    if [ -f "$SRC_FILE" ]; then
        # Extract just the ABI array from the full artifact
        python3 -c "
import json, sys
with open('$SRC_FILE') as f:
    data = json.load(f)
abi = data.get('abi', [])
print(json.dumps(abi, indent=2))
" > "$ABI_DIR/${contract}.json"
        echo "  ✓ ${contract}.json"
    else
        echo "  ✗ ${contract}.json (not found: $SRC_FILE)"
    fi
done

echo ""
echo "=== Done ==="
