"""
EduChain Experiment Orchestrator (Smart Education academic-integrity review).

Runs all baselines + EduChain on the student-submission dataset, collects metrics,
and generates comparison tables and analysis. The benchmark measures how well
each method flags problematic student code submissions (plagiarism, logic
errors, style issues) versus clean submissions.

Usage:
    python -m experiments.run_experiments [--quick] [--baselines b1,b2,b3,b4] [--output results/]
"""

import sys
import json
import time
import datetime
import argparse
import platform
from pathlib import Path
from dataclasses import asdict

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))


def run_experiments(quick: bool = False, fast: bool = False, selected_baselines: list = None, output_dir: str = "results",
                    dataset_path: str = None, n_samples: int = 16, max_workers: int = 8):
    """Run all experiments and output results."""
    from experiments.datasets import get_full_dataset, get_dataset_stats, load_from_test_public_json
    from experiments.datasets.jsonl_loader import load_from_jsonl
    from experiments.baselines.base import ExperimentMetrics
    from experiments.baselines.single_agent import SingleAgentBaseline
    from experiments.baselines.multi_agent_vote import MultiAgentVoteBaseline
    from experiments.baselines.traditional_tools import TraditionalToolsBaseline
    from experiments.baselines.full_verification import FullVerificationBaseline
    from experiments.baselines.osdf_runner import EduChainRunner

    run_start_time = time.time()
    run_timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    # Load LLM config for metadata
    try:
        with open(_PROJECT_ROOT / "config.json") as _f:
            _cfg = json.load(_f)
        _llm = _cfg.get("llm_config", {})
        llm_model = _llm.get("model", "unknown")
        llm_base_url = _llm.get("base_url", "unknown")
    except Exception:
        llm_model, llm_base_url = "unknown", "unknown"

    # Setup
    if dataset_path:
        n_vuln = n_samples // 2
        n_safe = n_samples - n_vuln
        if dataset_path.endswith(".jsonl"):
            dataset = load_from_jsonl(dataset_path, n_vuln=n_vuln, n_safe=n_safe)
        else:
            dataset = load_from_test_public_json(dataset_path, n_vuln=n_vuln, n_safe=n_safe)
        stats = {
            "total": len(dataset),
            "vulnerable": sum(1 for c in dataset if c["has_vulnerability"]),
            "safe": sum(1 for c in dataset if not c["has_vulnerability"]),
            "vulnerability_types": {"real_world": sum(1 for c in dataset if c["has_vulnerability"])},
        }
    else:
        dataset = get_full_dataset()
        stats = get_dataset_stats()

    # Create timestamped output directory: results/run_20240614_210337/
    base_output = Path(__file__).parent / output_dir
    output_path = base_output / f"run_{run_timestamp}"
    output_path.mkdir(parents=True, exist_ok=True)
    # Also keep a symlink/copy at results/latest for convenience
    latest_path = base_output / "latest"
    if latest_path.exists() or latest_path.is_symlink():
        try:
            latest_path.unlink()
        except Exception:
            pass
    try:
        latest_path.symlink_to(output_path.resolve(), target_is_directory=True)
    except Exception:
        pass  # Windows may require elevated privileges for symlinks

    if quick:
        dataset = dataset[:2] + dataset[-2:]

    if fast:
        # Fast mode: skip ablation variants and boost workers, keep full dataset
        max_workers = max(max_workers, 16)
        if not selected_baselines:
            selected_baselines = ["b1", "b2", "b3", "b4", "educhain"]

    print("=" * 70)
    print("EduChain Experiment: Comparative Evaluation")
    print("=" * 70)
    print(f"\nDataset: {stats['total']} submissions ({stats['vulnerable']} problematic, {stats['safe']} clean)")
    print(f"Issue types: {stats['vulnerability_types']}")
    print(f"Quick mode: {quick}")
    print(f"Fast mode:  {fast}")
    print()

    # Define runners
    all_runners = {
        "b1": ("B1: Single Agent LLM", SingleAgentBaseline),
        "b2": ("B2: Multi-Agent Vote (2)", lambda: MultiAgentVoteBaseline(num_agents=2)),
        "b3": ("B3: Traditional Tools", TraditionalToolsBaseline),
        "b4": ("B4: Full Verification", FullVerificationBaseline),
        "educhain": ("EduChain (Ours)", lambda: EduChainRunner(proposer_strength="normal", challenger_enabled=True)),
        "educhain_weak": ("EduChain (Weak Submitter)", lambda: EduChainRunner(proposer_strength="weak", challenger_enabled=True)),
        "educhain_no_chal": ("EduChain (No Reporter)", lambda: EduChainRunner(proposer_strength="normal", challenger_enabled=False)),
    }

    if selected_baselines:
        runners_to_run = {k: v for k, v in all_runners.items() if k in selected_baselines}
    else:
        runners_to_run = all_runners

    # Run experiments
    all_metrics: dict[str, ExperimentMetrics] = {}

    for key, (label, runner_factory) in runners_to_run.items():
        print(f"\n{'─' * 50}")
        print(f"Running: {label}")
        print(f"{'─' * 50}")

        try:
            runner = runner_factory() if callable(runner_factory) and not isinstance(runner_factory, type) else runner_factory()
            start = time.time()
            metrics = runner.run_dataset(dataset, max_workers=max_workers)
            elapsed = time.time() - start

            all_metrics[key] = metrics
            print(f"  Completed in {elapsed:.1f}s")
            print(f"  Precision: {metrics.precision:.3f}")
            print(f"  Recall:    {metrics.recall:.3f}")
            print(f"  F1:        {metrics.f1:.3f}")
            print(f"  FPR:       {metrics.fpr:.3f}")
        except Exception as e:
            print(f"  ERROR: {e}")
            import traceback
            traceback.print_exc()

    # Generate comparison table
    print("\n\n")
    print_comparison_table(all_metrics)

    # Generate detailed analysis
    print("\n")
    print_detailed_analysis(all_metrics, dataset)

    # Build run metadata
    run_meta = {
        "run_id": run_timestamp,
        "run_date": datetime.datetime.now().isoformat(),
        "total_wall_time_seconds": round(time.time() - run_start_time, 1),
        "mode": "fast" if fast else ("quick" if quick else "full"),
        "dataset": {
            "source": dataset_path or "builtin",
            "total": stats["total"],
            "vulnerable": stats["vulnerable"],
            "safe": stats["safe"],
        },
        "baselines_run": list(runners_to_run.keys()),
        "max_workers": max_workers,
        "llm": {
            "model": llm_model,
            "base_url": llm_base_url,
        },
        "python": platform.python_version(),
        "platform": platform.system(),
    }

    # Save results to JSON + Markdown report
    save_results(all_metrics, output_path, dataset, run_meta)

    # Auto-generate plots
    try:
        import subprocess as _sp
        import sys as _sys
        _script = Path(__file__).parent / "scripts" / "plot_latest.py"
        _sp.run([_sys.executable, str(_script), "--run", output_path.name],
                cwd=str(_PROJECT_ROOT), check=True)
        print(f"Plots saved to: {output_path}/plots/")
    except Exception as _e:
        print(f"[plot] Auto-plot skipped: {_e}")

    print(f"\nResults saved to: {output_path}/")
    return all_metrics


def print_comparison_table(metrics: dict):
    """Print a formatted comparison table."""
    print("=" * 90)
    print("COMPARISON TABLE: Review Metrics")
    print("=" * 90)
    header = f"{'Method':<25} {'Precision':>9} {'Recall':>8} {'F1':>8} {'FPR':>8} {'Test Rate':>9} {'Sandbox%':>9}"
    print(header)
    print("─" * 90)

    for key, m in metrics.items():
        poc_rate = f"{m.poc_success_rate:.3f}" if m.poc_success_rate > 0 else "N/A"
        sandbox_pct = f"{m.sandbox_invocation_rate * 100:.1f}%"
        row = f"{m.name:<25} {m.precision:>9.3f} {m.recall:>8.3f} {m.f1:>8.3f} {m.fpr:>8.3f} {poc_rate:>9} {sandbox_pct:>9}"
        print(row)

    print("─" * 90)

    # Efficiency table
    print("\n")
    print("=" * 70)
    print("COMPARISON TABLE: Efficiency Metrics")
    print("=" * 70)
    header = f"{'Method':<25} {'Avg Time(s)':>11} {'Total Gas':>12} {'Agents':>7}"
    print(header)
    print("─" * 70)

    for key, m in metrics.items():
        avg_agents = sum(r.num_agents_involved for r in m.results) / len(m.results) if m.results else 0
        row = f"{m.name:<25} {m.avg_time_per_contract:>11.2f} {m.total_gas:>12,} {avg_agents:>7.1f}"
        print(row)

    print("─" * 70)


def print_detailed_analysis(metrics: dict, dataset: list = None):
    """Print per-issue-type breakdown."""
    print("=" * 70)
    print("DETAILED ANALYSIS: Per-Issue-Type Detection")
    print("=" * 70)

    if dataset is None:
        from experiments.datasets import get_full_dataset
        dataset = get_full_dataset()

    # Group by issue type
    vuln_types = set()
    for c in dataset:
        if c["has_vulnerability"]:
            vuln_types.add(c["vulnerability_type"])

    for vtype in sorted(vuln_types):
        print(f"\n  [{vtype}]")
        vuln_contracts = [c for c in dataset if c.get("vulnerability_type") == vtype]
        contract_ids = {c["id"] for c in vuln_contracts}

        for key, m in metrics.items():
            detected = sum(
                1 for r in m.results
                if r.contract_id in contract_ids and r.detected_vulnerability
            )
            total = len(contract_ids)
            rate = detected / total if total > 0 else 0
            print(f"    {m.name:<25} {detected}/{total} ({rate*100:.0f}%)")

    # Ablation analysis for EduChain variants
    educhain_keys = [k for k in metrics if k.startswith("educhain")]
    if len(educhain_keys) > 1:
        print(f"\n\n{'=' * 70}")
        print("ABLATION STUDY: EduChain Component Contribution")        print("=" * 70)
        print(f"{'Variant':<30} {'Recall':>8} {'F1':>8} {'Sandbox%':>9} {'Gas':>12}")
        print("─" * 70)
        for key in educhain_keys:
            m = metrics[key]
            sandbox_pct = f"{m.sandbox_invocation_rate * 100:.1f}%"
            print(f"{m.name:<30} {m.recall:>8.3f} {m.f1:>8.3f} {sandbox_pct:>9} {m.total_gas:>12,}")


def compute_game_theory_metrics(metrics: dict) -> dict:
    """Compute game-theoretic metrics for EduChain."""
    # Economic parameters from config
    import json
    config_path = _PROJECT_ROOT / "config.json"
    with open(config_path) as f:
        config = json.load(f)

    econ = config["economic_parameters"]
    oracle = config["stake_oracle_parameters"]

    alpha = econ["alpha"]
    p_detect = oracle["p_detect"]
    p_arb = oracle["p_arb_correct"]
    c_a = oracle["audit_cost_eth"]
    c_a_prime = oracle["audit_cost_prime_eth"]
    c_poc = oracle["poc_cost_eth"]
    min_stake = econ["min_proposer_stake_eth"]

    # Honest proposer EV: reward - audit_cost
    # If honest: gets reward R with probability 1 (no challenge or challenge dismissed)
    reward = 2.0  # Assume 2 ETH reward per task
    honest_ev = reward - c_a

    # Shirker EV: reward * (1 - p_detect) - stake * p_detect * p_arb
    shirk_ev = reward * (1 - p_detect) - min_stake * p_detect * p_arb

    # False challenger EV: -stake * p_arb (always loses if challenge is invalid)
    false_challenge_ev = -min_stake * p_arb

    # Sybil cost: need to control quorum (67% of committee of 3 = 2 members)
    min_rep = 200
    committee_size = 3
    quorum_needed = 2
    sybil_cost = min_stake * quorum_needed  # Minimum stake to get 2 sybil agents on committee

    return {
        "honest_proposer_ev": honest_ev,
        "shirker_ev": shirk_ev,
        "false_challenger_ev": false_challenge_ev,
        "honesty_dominates": honest_ev > shirk_ev,
        "sybil_cost_eth": sybil_cost,
        "parameters": {
            "alpha": alpha,
            "p_detect": p_detect,
            "p_arb_correct": p_arb,
            "audit_cost": c_a,
            "min_stake": min_stake,
        },
    }


def save_results(metrics: dict, output_path: Path, dataset: list = None, run_meta: dict = None):
    """Save experiment results to JSON files and generate Markdown report."""
    # ── run_meta.json ──────────────────────────────────────────────────────
    if run_meta:
        with open(output_path / "run_meta.json", "w", encoding="utf-8") as f:
            json.dump(run_meta, f, indent=2, ensure_ascii=False)

    # ── summary.json ──────────────────────────────────────────────────────
    summary = {}
    for key, m in metrics.items():
        summary[key] = {
            "name": m.name,
            "precision": round(m.precision, 4),
            "recall": round(m.recall, 4),
            "f1": round(m.f1, 4),
            "fpr": round(m.fpr, 4),
            "accuracy": round(m.accuracy, 4),
            "true_positives": m.true_positives,
            "false_positives": m.false_positives,
            "true_negatives": m.true_negatives,
            "false_negatives": m.false_negatives,
            "poc_success_rate": round(m.poc_success_rate, 4),
            "sandbox_invocation_rate": round(m.sandbox_invocation_rate, 4),
            "avg_time_per_contract": round(m.avg_time_per_contract, 3),
            "total_gas": m.total_gas,
        }

    with open(output_path / "summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    # ── detailed.json ─────────────────────────────────────────────────────
    detailed = {}
    for key, m in metrics.items():
        detailed[key] = [
            {
                "contract_id": r.contract_id,
                "detected": r.detected_vulnerability,
                "vuln_type": r.vulnerability_type,
                "confidence": round(r.confidence, 3),
                "poc_generated": r.poc_generated,
                "poc_valid": r.poc_valid,
                "sandbox_invoked": r.sandbox_invoked,
                "challenge_raised": r.challenge_raised,
                "time_seconds": round(r.time_seconds, 3),
                "gas_cost": r.gas_cost,
            }
            for r in m.results
        ]

    with open(output_path / "detailed.json", "w", encoding="utf-8") as f:
        json.dump(detailed, f, indent=2, ensure_ascii=False)

    # ── game_theory.json ──────────────────────────────────────────────────
    gt_metrics = compute_game_theory_metrics(metrics)
    with open(output_path / "game_theory.json", "w", encoding="utf-8") as f:
        json.dump(gt_metrics, f, indent=2, ensure_ascii=False)

    print(f"\n  Game Theory Analysis:")
    print(f"    Honest Proposer EV:  {gt_metrics['honest_proposer_ev']:.3f} ETH")
    print(f"    Shirker EV:          {gt_metrics['shirker_ev']:.3f} ETH")
    print(f"    Honesty Dominates:   {gt_metrics['honesty_dominates']}")
    print(f"    Sybil Attack Cost:   {gt_metrics['sybil_cost_eth']:.1f} ETH")

    # ── report.md ─────────────────────────────────────────────────────────
    _write_markdown_report(metrics, output_path, dataset, run_meta, gt_metrics)


def _write_markdown_report(metrics: dict, output_path: Path, dataset: list,
                            run_meta: dict, gt_metrics: dict):
    """Write a self-contained Markdown experiment report."""
    now = run_meta.get("run_date", "") if run_meta else ""
    mode = run_meta.get("mode", "full") if run_meta else "full"
    model = run_meta.get("llm", {}).get("model", "unknown") if run_meta else "unknown"
    ds = run_meta.get("dataset", {}) if run_meta else {}
    wall_time = run_meta.get("total_wall_time_seconds", 0) if run_meta else 0

    lines = []
    lines.append("# EduChain Experiment Report\n")
    lines.append(f"**Run date:** {now}  ")
    lines.append(f"**Mode:** {mode}  ")
    lines.append(f"**LLM model:** `{model}`  ")
    lines.append(f"**Dataset:** {ds.get('source', 'builtin')} "
                 f"({ds.get('total', '?')} contracts: "
                 f"{ds.get('vulnerable', '?')} vuln + {ds.get('safe', '?')} safe)  ")
    lines.append(f"**Total wall time:** {wall_time:.0f}s\n")

    # Security metrics table
    lines.append("## Review Metrics\n")
    lines.append("| Method | Precision | Recall | F1 | FPR | Accuracy | TP | FP | TN | FN |")
    lines.append("|--------|----------:|-------:|---:|----:|---------:|---:|---:|---:|---:|")
    for key, m in metrics.items():
        lines.append(
            f"| {m.name} "
            f"| {m.precision:.3f} | {m.recall:.3f} | {m.f1:.3f} "
            f"| {m.fpr:.3f} | {m.accuracy:.3f} "
            f"| {m.true_positives} | {m.false_positives} "
            f"| {m.true_negatives} | {m.false_negatives} |"
        )

    # Efficiency metrics table
    lines.append("\n## Efficiency Metrics\n")
    lines.append("| Method | Avg Time (s) | Total Gas | PoC Rate | Sandbox% | Agents |")
    lines.append("|--------|-------------:|----------:|---------:|---------:|-------:|")
    for key, m in metrics.items():
        avg_agents = (sum(r.num_agents_involved for r in m.results) / len(m.results)
                      if m.results else 0)
        poc = f"{m.poc_success_rate:.3f}" if m.poc_success_rate > 0 else "N/A"
        lines.append(
            f"| {m.name} "
            f"| {m.avg_time_per_contract:.2f} "
            f"| {m.total_gas:,} "
            f"| {poc} "
            f"| {m.sandbox_invocation_rate * 100:.1f}% "
            f"| {avg_agents:.1f} |"
        )

    # Per-issue-type breakdown
    if dataset:
        vuln_types = sorted({c["vulnerability_type"] for c in dataset
                             if c.get("has_vulnerability") and c.get("vulnerability_type")})
        if vuln_types:
            lines.append("\n## Per-Issue-Type Detection\n")
            header = "| Issue Type | " + " | ".join(m.name for m in metrics.values()) + " |"
            sep = "|-----------|" + "|".join("------:" for _ in metrics) + "|"
            lines.append(header)
            lines.append(sep)
            contract_ids_by_type = {
                vt: {c["id"] for c in dataset if c.get("vulnerability_type") == vt}
                for vt in vuln_types
            }
            for vt in vuln_types:
                cids = contract_ids_by_type[vt]
                row = f"| {vt} |"
                for m in metrics.values():
                    det = sum(1 for r in m.results
                              if r.contract_id in cids and r.detected_vulnerability)
                    total = len(cids)
                    row += f" {det}/{total} ({det/total*100:.0f}%) |" if total else " N/A |"
                lines.append(row)

    # Game theory
    lines.append("\n## Game Theory Analysis\n")
    lines.append(f"| Parameter | Value |")
    lines.append(f"|-----------|------:|")
    lines.append(f"| Honest Proposer EV | {gt_metrics['honest_proposer_ev']:.4f} ETH |")
    lines.append(f"| Shirker EV | {gt_metrics['shirker_ev']:.4f} ETH |")
    lines.append(f"| False Challenger EV | {gt_metrics['false_challenger_ev']:.4f} ETH |")
    lines.append(f"| Honesty Dominates | {gt_metrics['honesty_dominates']} |")
    lines.append(f"| Sybil Attack Cost | {gt_metrics['sybil_cost_eth']:.1f} ETH |")

    lines.append(f"\n---\n*Generated by EduChain experiment runner on {now}*\n")

    with open(output_path / "report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ===== CLI Entry Point =====

def main():
    parser = argparse.ArgumentParser(description="EduChain Experiment Runner")
    parser.add_argument("--quick", action="store_true", help="Quick mode (subset of dataset)")
    parser.add_argument("--fast", action="store_true",
                        help="Fast mode: 8 contracts, no ablation variants, 16 workers")
    parser.add_argument("--baselines", type=str, default=None,
                        help="Comma-separated list of baselines to run (b1,b2,b3,b4,educhain,educhain_weak,educhain_no_chal)")
    parser.add_argument("--output", type=str, default="results", help="Output directory")
    parser.add_argument("--dataset-path", type=str, default=None,
                        help="Path to dataset file (.jsonl or test_public.json)")
    parser.add_argument("--n-samples", type=int, default=16,
                        help="Number of samples to select from external dataset (split evenly vuln/safe)")
    parser.add_argument("--max-workers", type=int, default=8,
                        help="Max parallel workers for reviewing submissions concurrently")
    args = parser.parse_args()

    selected = args.baselines.split(",") if args.baselines else None
    run_experiments(
        quick=args.quick,
        fast=args.fast,
        selected_baselines=selected,
        output_dir=args.output,
        dataset_path=args.dataset_path,
        n_samples=args.n_samples,
        max_workers=args.max_workers,
    )


if __name__ == "__main__":
    main()
