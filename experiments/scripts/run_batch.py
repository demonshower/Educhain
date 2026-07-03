#!/usr/bin/env python
"""
Batch experiment runner for EduChain evaluation.

Runs all baselines sequentially with proper error handling and progress tracking.
Saves intermediate results so experiments can be resumed.

Usage:
    python experiments/scripts/run_batch.py --all
    python experiments/scripts/run_batch.py --baseline b3
    python experiments/scripts/run_batch.py --baseline educhain --quick
"""

import sys
import io
import json
import time
import argparse
from pathlib import Path

# Fix Windows encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))


def run_single_baseline(key: str, quick: bool = False):
    """Run a single baseline and save results."""
    from experiments.datasets import get_full_dataset, get_dataset_stats
    from experiments.baselines.single_agent import SingleAgentBaseline
    from experiments.baselines.multi_agent_vote import MultiAgentVoteBaseline
    from experiments.baselines.traditional_tools import TraditionalToolsBaseline
    from experiments.baselines.full_verification import FullVerificationBaseline
    from experiments.baselines.osdf_runner import EduChainRunner

    runners = {
        "b1": lambda: SingleAgentBaseline(),
        "b2": lambda: MultiAgentVoteBaseline(num_agents=3),
        "b3": lambda: TraditionalToolsBaseline(),
        "b4": lambda: FullVerificationBaseline(),
        "educhain": lambda: EduChainRunner(proposer_strength="normal", challenger_enabled=True),
        "educhain_weak": lambda: EduChainRunner(proposer_strength="weak", challenger_enabled=True),
        "educhain_no_chal": lambda: EduChainRunner(proposer_strength="normal", challenger_enabled=False),
    }

    if key not in runners:
        print(f"Unknown baseline: {key}. Available: {list(runners.keys())}")
        return

    dataset = get_full_dataset()
    if quick:
        dataset = dataset[:2] + dataset[-2:]

    print(f"Running {key} on {len(dataset)} contracts...")
    runner = runners[key]()

    results = []
    for i, contract in enumerate(dataset):
        print(f"  [{i+1}/{len(dataset)}] {contract['id']} ({contract['name']})...", end=" ", flush=True)
        start = time.time()
        try:
            result = runner.audit_contract(contract)
            result.time_seconds = time.time() - start
            results.append(result)

            gt = contract["has_vulnerability"]
            correct = result.detected_vulnerability == gt
            print(f"{'OK' if correct else 'WRONG'} (det={result.detected_vulnerability}, {result.time_seconds:.1f}s)")
        except Exception as e:
            print(f"ERROR: {e}")
            from experiments.baselines.base import AuditResult
            results.append(AuditResult(
                contract_id=contract["id"],
                detected_vulnerability=False,
                reasoning=f"Error: {e}",
                time_seconds=time.time() - start,
            ))

    # Compute metrics
    from experiments.baselines.base import ExperimentMetrics
    metrics = ExperimentMetrics(name=runner.name)
    for result, contract in zip(results, dataset):
        gt = contract["has_vulnerability"]
        if result.detected_vulnerability and gt:
            metrics.true_positives += 1
        elif result.detected_vulnerability and not gt:
            metrics.false_positives += 1
        elif not result.detected_vulnerability and not gt:
            metrics.true_negatives += 1
        else:
            metrics.false_negatives += 1
        metrics.total_time_seconds += result.time_seconds
        metrics.total_gas += result.gas_cost
        metrics.results.append(result)

    metrics.avg_time_per_contract = metrics.total_time_seconds / len(dataset)

    # Print summary
    print(f"\n{'=' * 50}")
    print(f"Results for {runner.name}:")
    print(f"  Precision: {metrics.precision:.3f}")
    print(f"  Recall:    {metrics.recall:.3f}")
    print(f"  F1:        {metrics.f1:.3f}")
    print(f"  FPR:       {metrics.fpr:.3f}")
    print(f"  Accuracy:  {metrics.accuracy:.3f}")
    print(f"  Avg time:  {metrics.avg_time_per_contract:.2f}s")
    print(f"  Total gas: {metrics.total_gas:,}")
    print(f"{'=' * 50}")

    # Save to file
    output_dir = _PROJECT_ROOT / "experiments" / "results"
    output_dir.mkdir(parents=True, exist_ok=True)

    result_data = {
        "baseline": key,
        "name": runner.name,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "dataset_size": len(dataset),
        "quick_mode": quick,
        "metrics": {
            "precision": round(metrics.precision, 4),
            "recall": round(metrics.recall, 4),
            "f1": round(metrics.f1, 4),
            "fpr": round(metrics.fpr, 4),
            "accuracy": round(metrics.accuracy, 4),
            "tp": metrics.true_positives,
            "fp": metrics.false_positives,
            "tn": metrics.true_negatives,
            "fn": metrics.false_negatives,
            "avg_time_seconds": round(metrics.avg_time_per_contract, 3),
            "total_gas": metrics.total_gas,
            "sandbox_invocation_rate": round(metrics.sandbox_invocation_rate, 4),
        },
        "per_contract": [
            {
                "id": r.contract_id,
                "detected": r.detected_vulnerability,
                "vuln_type": r.vulnerability_type,
                "confidence": round(r.confidence, 3),
                "poc_generated": r.poc_generated,
                "poc_valid": r.poc_valid,
                "sandbox_invoked": r.sandbox_invoked,
                "challenge_raised": r.challenge_raised,
                "time_seconds": round(r.time_seconds, 3),
                "gas_cost": r.gas_cost,
                "reasoning": r.reasoning[:200],
            }
            for r in results
        ],
    }

    output_file = output_dir / f"{key}_results.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result_data, f, indent=2, ensure_ascii=False)

    print(f"\nSaved to: {output_file}")
    return metrics


def main():
    parser = argparse.ArgumentParser(description="EduChain Batch Experiment Runner")
    parser.add_argument("--baseline", type=str, help="Single baseline to run")
    parser.add_argument("--all", action="store_true", help="Run all baselines")
    parser.add_argument("--quick", action="store_true", help="Quick mode (4 contracts)")
    args = parser.parse_args()

    if args.all:
        for key in ["b3", "b1", "b2", "educhain", "educhain_weak", "educhain_no_chal", "b4"]:
            print(f"\n{'#' * 60}")
            print(f"# BASELINE: {key}")
            print(f"{'#' * 60}\n")
            try:
                run_single_baseline(key, quick=args.quick)
            except Exception as e:
                print(f"FAILED: {e}")
            print()
    elif args.baseline:
        run_single_baseline(args.baseline, quick=args.quick)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
