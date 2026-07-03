#!/usr/bin/env python
"""
Results analysis and comparison table generator.

Reads saved experiment results and generates:
1. Comparison tables (LaTeX + ASCII)
2. Per-vulnerability-type breakdown
3. Ablation study summary
4. Game theory analysis

Usage:
    python experiments/scripts/analyze_results.py
"""

import sys
import io
import json
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

_RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"


def load_results():
    """Load all available result files."""
    results = {}
    if not _RESULTS_DIR.exists():
        print("No results directory found.")
        return results

    for f in sorted(_RESULTS_DIR.glob("*_results.json")):
        key = f.stem.replace("_results", "")
        with open(f, encoding="utf-8") as fp:
            results[key] = json.load(fp)

    return results


def print_main_table(results: dict):
    """Print the main comparison table."""
    print("\n" + "=" * 95)
    print("TABLE 1: Security Performance Comparison")
    print("=" * 95)
    print(f"{'Method':<28} {'Precision':>9} {'Recall':>8} {'F1':>8} {'FPR':>8} {'Accuracy':>9} {'Sandbox%':>9}")
    print("-" * 95)

    for key, data in results.items():
        m = data["metrics"]
        sandbox = f"{m.get('sandbox_invocation_rate', 0) * 100:.1f}%"
        print(f"{data['name']:<28} {m['precision']:>9.3f} {m['recall']:>8.3f} {m['f1']:>8.3f} {m['fpr']:>8.3f} {m['accuracy']:>9.3f} {sandbox:>9}")

    print("-" * 95)


def print_efficiency_table(results: dict):
    """Print efficiency comparison."""
    print("\n" + "=" * 80)
    print("TABLE 2: Efficiency Metrics")
    print("=" * 80)
    print(f"{'Method':<28} {'Avg Time(s)':>11} {'Total Gas':>12} {'Challenge%':>11}")
    print("-" * 80)

    for key, data in results.items():
        m = data["metrics"]
        per_contract = data.get("per_contract", [])
        challenge_rate = sum(1 for c in per_contract if c.get("challenge_raised")) / len(per_contract) if per_contract else 0
        print(f"{data['name']:<28} {m['avg_time_seconds']:>11.2f} {m['total_gas']:>12,} {challenge_rate*100:>10.1f}%")

    print("-" * 80)


def print_vuln_type_breakdown(results: dict):
    """Print per-vulnerability-type detection rates."""
    print("\n" + "=" * 90)
    print("TABLE 3: Per-Vulnerability-Type Detection Rate")
    print("=" * 90)

    # Collect vulnerability types from results
    vuln_types = {}
    for key, data in results.items():
        for c in data.get("per_contract", []):
            cid = c["id"]
            if cid.startswith("vuln_"):
                # Map contract IDs to types
                type_map = {
                    "vuln_001": "reentrancy", "vuln_002": "reentrancy",
                    "vuln_003": "access_control", "vuln_004": "access_control",
                    "vuln_005": "integer_overflow", "vuln_006": "oracle_manipulation",
                    "vuln_007": "frontrunning", "vuln_008": "delegatecall",
                    "vuln_009": "signature_replay", "vuln_010": "flash_loan",
                }
                vtype = type_map.get(cid, "unknown")
                if vtype not in vuln_types:
                    vuln_types[vtype] = {}
                if key not in vuln_types[vtype]:
                    vuln_types[vtype][key] = {"detected": 0, "total": 0}
                vuln_types[vtype][key]["total"] += 1
                if c["detected"]:
                    vuln_types[vtype][key]["detected"] += 1

    # Print header
    methods = list(results.keys())
    header = f"{'Vuln Type':<20}"
    for key in methods:
        header += f" {results[key]['name'][:12]:>12}"
    print(header)
    print("-" * 90)

    for vtype in sorted(vuln_types.keys()):
        row = f"{vtype:<20}"
        for key in methods:
            if key in vuln_types[vtype]:
                d = vuln_types[vtype][key]
                rate = d["detected"] / d["total"] if d["total"] > 0 else 0
                row += f" {rate*100:>10.0f}%"
            else:
                row += f" {'N/A':>12}"
        print(row)

    print("-" * 90)


def print_latex_table(results: dict):
    """Generate LaTeX table for paper."""
    print("\n" + "=" * 70)
    print("LaTeX Table (copy to paper):")
    print("=" * 70)
    print(r"""
\begin{table}[h]
\centering
\caption{Comparative Evaluation of EduChain vs. Baselines}
\label{tab:comparison}
\begin{tabular}{lcccccc}
\toprule
\textbf{Method} & \textbf{Precision} & \textbf{Recall} & \textbf{F1} & \textbf{FPR} & \textbf{Gas} & \textbf{Sandbox\%} \\
\midrule""")

    for key, data in results.items():
        m = data["metrics"]
        name = data["name"].replace("_", r"\_")
        sandbox = f"{m.get('sandbox_invocation_rate', 0) * 100:.1f}\\%"
        gas = f"{m['total_gas']:,}" if m['total_gas'] > 0 else "0"
        print(f"{name} & {m['precision']:.3f} & {m['recall']:.3f} & {m['f1']:.3f} & {m['fpr']:.3f} & {gas} & {sandbox} \\\\")

    print(r"""\bottomrule
\end{tabular}
\end{table}""")


def print_game_theory_analysis():
    """Print game theory metrics."""
    gt_file = _RESULTS_DIR / "game_theory.json"
    if not gt_file.exists():
        # Compute it
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
        from experiments.run_experiments import compute_game_theory_metrics
        gt = compute_game_theory_metrics({})
        with open(gt_file, "w") as f:
            json.dump(gt, f, indent=2)
    else:
        with open(gt_file) as f:
            gt = json.load(f)

    print("\n" + "=" * 60)
    print("TABLE 4: Game-Theoretic Analysis")
    print("=" * 60)
    print(f"  {'Metric':<30} {'Value':>15}")
    print(f"  {'-'*45}")
    print(f"  {'Honest Proposer EV':<30} {gt['honest_proposer_ev']:>12.3f} ETH")
    print(f"  {'Shirker EV':<30} {gt['shirker_ev']:>12.3f} ETH")
    print(f"  {'False Challenger EV':<30} {gt['false_challenger_ev']:>12.3f} ETH")
    print(f"  {'Honesty Dominates':<30} {'Yes' if gt['honesty_dominates'] else 'No':>15}")
    print(f"  {'Sybil Attack Cost':<30} {gt['sybil_cost_eth']:>12.1f} ETH")
    print(f"\n  Parameters: p_detect={gt['parameters']['p_detect']}, "
          f"p_arb={gt['parameters']['p_arb_correct']}, "
          f"alpha={gt['parameters']['alpha']}")
    print(f"  Conclusion: {'Honest strategy is dominant (EV_honest > EV_shirk)' if gt['honesty_dominates'] else 'WARNING: Shirking may be profitable!'}")


def main():
    results = load_results()

    if not results:
        print("No experiment results found. Run experiments first:")
        print("  python experiments/scripts/run_batch.py --baseline b3")
        print("  python experiments/scripts/run_batch.py --baseline b1")
        print("  python experiments/scripts/run_batch.py --baseline educhain")
        return

    print(f"\nLoaded results for: {list(results.keys())}")

    print_main_table(results)
    print_efficiency_table(results)
    print_vuln_type_breakdown(results)
    print_game_theory_analysis()
    print_latex_table(results)


if __name__ == "__main__":
    main()
