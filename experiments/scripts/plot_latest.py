"""
Plot results from the latest experiment run.
Usage: python experiments/scripts/plot_latest.py [--run run_20260614_174758]
"""

import sys
import json
import argparse
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from pathlib import Path

_RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def load_run(run_id: str = None) -> tuple[dict, dict, Path]:
    if run_id:
        run_dir = _RESULTS_DIR / run_id
    else:
        # Find latest run_* directory
        runs = sorted(_RESULTS_DIR.glob("run_*"), reverse=True)
        if not runs:
            raise FileNotFoundError(f"No run directories in {_RESULTS_DIR}")
        run_dir = runs[0]

    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    gt = json.loads((run_dir / "game_theory.json").read_text(encoding="utf-8"))
    print(f"Loaded: {run_dir.name}")
    return summary, gt, run_dir


def setup_style():
    plt.rcParams.update({
        'font.size': 11,
        'axes.labelsize': 12,
        'axes.titlesize': 13,
        'xtick.labelsize': 10,
        'ytick.labelsize': 10,
        'legend.fontsize': 10,
        'figure.dpi': 150,
        'savefig.dpi': 150,
        'savefig.bbox': 'tight',
    })


# ── Fig 1: Security Metrics ───────────────────────────────────────────────────

def plot_security_metrics(summary: dict, out_dir: Path):
    methods, precision, recall, f1, fpr = [], [], [], [], []
    for m in summary.values():
        methods.append(m["name"].replace("B1_", "B1\n").replace("B2_", "B2\n")
                       .replace("B3_", "B3\n").replace("B4_", "B4\n"))
        precision.append(m["precision"])
        recall.append(m["recall"])
        f1.append(m["f1"])
        fpr.append(m["fpr"])

    x = np.arange(len(methods))
    w = 0.18
    fig, ax = plt.subplots(figsize=(11, 5))

    b1 = ax.bar(x - 1.5*w, precision, w, label='Precision', color='#2196F3', alpha=0.88)
    b2 = ax.bar(x - 0.5*w, recall,    w, label='Recall',    color='#4CAF50', alpha=0.88)
    b3 = ax.bar(x + 0.5*w, f1,        w, label='F1 Score',  color='#FF9800', alpha=0.88)
    b4 = ax.bar(x + 1.5*w, fpr,       w, label='FPR ↓',     color='#F44336', alpha=0.88)

    for bars in [b1, b2, b3, b4]:
        for bar in bars:
            h = bar.get_height()
            if h > 0.01:
                ax.text(bar.get_x() + bar.get_width()/2, h + 0.02,
                        f'{h:.2f}', ha='center', va='bottom', fontsize=7.5)

    ax.set_xticks(x)
    ax.set_xticklabels(methods)
    ax.set_ylabel('Score')
    ax.set_title('Security Performance Comparison (Precision / Recall / F1 / FPR)')
    ax.set_ylim(0, 1.22)
    ax.axhline(1.0, color='gray', linestyle='--', alpha=0.3)
    ax.legend(loc='upper right')
    ax.grid(axis='y', alpha=0.3)
    plt.tight_layout()
    path = out_dir / "fig1_security_metrics.png"
    plt.savefig(path); plt.close()
    print(f"  Saved: {path.name}")


# ── Fig 2: Efficiency ─────────────────────────────────────────────────────────

def plot_efficiency(summary: dict, out_dir: Path):
    methods = [m["name"] for m in summary.values()]
    times   = [m["avg_time_per_contract"] for m in summary.values()]
    gas     = [m["total_gas"] for m in summary.values()]

    colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336',
              '#00BCD4', '#795548'][:len(methods)]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    bars = ax1.bar(methods, times, color=colors, alpha=0.85, edgecolor='white')
    for bar, t in zip(bars, times):
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                 f'{t:.1f}s', ha='center', fontsize=9)
    ax1.set_ylabel('Avg Time per Contract (s)')
    ax1.set_title('(a) Computational Cost')
    ax1.set_xticks(range(len(methods)))
    ax1.set_xticklabels(methods, rotation=20, ha='right')
    ax1.grid(axis='y', alpha=0.3)

    gas_k = [g / 1000 for g in gas]
    bars = ax2.bar(methods, gas_k, color=colors, alpha=0.85, edgecolor='white')
    for bar, g in zip(bars, gas):
        label = f'{g/1000:.0f}K' if g > 0 else '0'
        ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                 label, ha='center', fontsize=9)
    ax2.set_ylabel('Total Gas Cost (×1000)')
    ax2.set_title('(b) On-chain Gas Cost')
    ax2.set_xticks(range(len(methods)))
    ax2.set_xticklabels(methods, rotation=20, ha='right')
    ax2.grid(axis='y', alpha=0.3)

    plt.tight_layout()
    path = out_dir / "fig2_efficiency.png"
    plt.savefig(path); plt.close()
    print(f"  Saved: {path.name}")


# ── Fig 3: Radar ──────────────────────────────────────────────────────────────

def plot_radar(summary: dict, out_dir: Path):
    categories = ['Precision', 'Recall', 'F1', 'Specificity\n(1-FPR)', 'Speed\n(norm)', 'Gas Eff\n(norm)']
    N = len(categories)
    angles = [n / N * 2 * np.pi for n in range(N)] + [0]

    fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))
    colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336', '#00BCD4']

    max_t = max(m["avg_time_per_contract"] for m in summary.values()) or 1
    max_g = max(m["total_gas"] for m in summary.values()) or 1

    for idx, m in enumerate(summary.values()):
        vals = [
            m["precision"],
            m["recall"],
            m["f1"],
            1 - m["fpr"],
            1 - m["avg_time_per_contract"] / max_t,
            1 - m["total_gas"] / max_g,
        ] + [m["precision"]]   # close loop

        c = colors[idx % len(colors)]
        ax.plot(angles, vals, 'o-', linewidth=2, color=c, label=m["name"])
        ax.fill(angles, vals, alpha=0.08, color=c)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories)
    ax.set_ylim(0, 1.1)
    ax.set_title('Multi-Dimensional Comparison', y=1.1, fontsize=14)
    ax.legend(loc='upper right', bbox_to_anchor=(1.35, 1.15))
    ax.grid(True)

    plt.tight_layout()
    path = out_dir / "fig3_radar.png"
    plt.savefig(path); plt.close()
    print(f"  Saved: {path.name}")


# ── Fig 4: Confusion Matrix ───────────────────────────────────────────────────

def plot_confusion(summary: dict, out_dir: Path):
    n = len(summary)
    cols = min(3, n)
    rows = (n + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 4, rows * 3.5))
    axes = np.array(axes).flatten()

    for idx, (key, m) in enumerate(summary.items()):
        ax = axes[idx]
        tp, fp = m["true_positives"],  m["false_positives"]
        tn, fn = m["true_negatives"],  m["false_negatives"]
        matrix = np.array([[tn, fp], [fn, tp]])
        labels = [['TN', 'FP'], ['FN', 'TP']]
        colors_cm = [['#E8F5E9', '#FFCDD2'], ['#FFCDD2', '#E8F5E9']]

        for r in range(2):
            for c in range(2):
                ax.add_patch(plt.Rectangle((c, 1-r), 1, 1,
                             facecolor=colors_cm[r][c], edgecolor='white', linewidth=2))
                ax.text(c + 0.5, 1.5 - r,
                        f'{labels[r][c]}\n{matrix[r, c]}',
                        ha='center', va='center', fontsize=13, fontweight='bold')

        ax.set_xlim(0, 2); ax.set_ylim(0, 2)
        ax.set_xticks([0.5, 1.5]); ax.set_yticks([0.5, 1.5])
        ax.set_xticklabels(['Pred Safe', 'Pred Vuln'])
        ax.set_yticklabels(['Actual Vuln', 'Actual Safe'])
        ax.set_title(m["name"], fontsize=11)
        total = tp + fp + tn + fn
        acc = (tp + tn) / total if total else 0
        ax.set_xlabel(f'Acc={acc:.2f}  F1={m["f1"]:.2f}', fontsize=9)

    for idx in range(n, len(axes)):
        axes[idx].set_visible(False)

    fig.suptitle('Confusion Matrices', fontsize=14, y=1.02)
    plt.tight_layout()
    path = out_dir / "fig4_confusion_matrices.png"
    plt.savefig(path); plt.close()
    print(f"  Saved: {path.name}")


# ── Fig 5: Game Theory ────────────────────────────────────────────────────────

def plot_game_theory(gt: dict, out_dir: Path):
    try:
        cfg = json.loads((_PROJECT_ROOT / "config.json").read_text(encoding="utf-8"))
    except Exception:
        cfg = {}

    econ   = cfg.get("economic_parameters", {})
    oracle = cfg.get("stake_oracle_parameters", {})
    p_det  = oracle.get("p_detect", 0.7)
    p_arb  = oracle.get("p_arb_correct", 0.95)
    stake  = econ.get("min_proposer_stake_eth", 1.0)
    c_a    = oracle.get("audit_cost_eth", 2.0)
    alpha  = econ.get("alpha", 1.5)
    poc_c  = oracle.get("poc_cost_eth", 0.5)
    reward = 2.0

    p_vals = np.linspace(0.1, 0.99, 80)
    honest_ev  = np.full_like(p_vals, reward - c_a)
    shirk_ev   = reward * (1 - p_vals) - stake * p_vals * p_arb
    false_c_ev = np.full_like(p_vals, -stake * p_arb)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5))

    ax1.plot(p_vals, honest_ev,  'g-',  lw=2, label='Honest Proposer')
    ax1.plot(p_vals, shirk_ev,   'r--', lw=2, label='Shirking Proposer')
    ax1.plot(p_vals, false_c_ev, 'b:',  lw=2, label='False Challenger')
    ax1.axhline(0, color='black', lw=0.8, alpha=0.4)
    ax1.axvline(p_det, color='gray', ls='--', alpha=0.6,
                label=f'Current p_detect={p_det}')
    ax1.fill_between(p_vals, shirk_ev, honest_ev, alpha=0.08, color='green',
                     where=(honest_ev > shirk_ev))
    ax1.set_xlabel('Detection Probability (p_detect)')
    ax1.set_ylabel('Expected Value (ETH)')
    ax1.set_title('(a) Strategy Payoffs vs Detection Probability')
    ax1.legend(); ax1.grid(alpha=0.3); ax1.set_xlim(0.1, 1.0)

    strats = ['Honest\nPropose', 'Shirk\nPropose', 'False\nChallenge', 'Valid\nChallenge']
    evs = [
        reward - c_a,
        reward * (1 - p_det) - stake * p_det * p_arb,
        -stake * p_arb,
        alpha * stake * p_arb - poc_c,
    ]
    bar_colors = ['#4CAF50' if e >= 0 else '#F44336' for e in evs]
    bars = ax2.bar(strats, evs, color=bar_colors, alpha=0.85, edgecolor='black', lw=0.5)
    ax2.axhline(0, color='black', lw=1)
    for bar, ev in zip(bars, evs):
        va = 'bottom' if ev >= 0 else 'top'
        y_pos = ev + (0.02 if ev >= 0 else -0.02)
        ax2.text(bar.get_x() + bar.get_width()/2, y_pos,
                 f'{ev:.3f}', ha='center', va=va,
                 fontsize=10, fontweight='bold')
    ax2.set_ylabel('Expected Value (ETH)')
    ax2.set_title('(b) Strategy Payoff Matrix')
    ax2.grid(axis='y', alpha=0.3)

    plt.tight_layout()
    path = out_dir / "fig5_game_theory.png"
    plt.savefig(path); plt.close()
    print(f"  Saved: {path.name}")


# ── Fig 6: Sandbox / Challenge Rate ──────────────────────────────────────────

def plot_sandbox(summary: dict, out_dir: Path):
    methods  = [m["name"] for m in summary.values()]
    sandbox  = [m["sandbox_invocation_rate"] * 100 for m in summary.values()]
    colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336',
              '#00BCD4', '#795548'][:len(methods)]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    # Sandbox rate
    bars = ax1.bar(methods, sandbox, color=colors, alpha=0.85)
    for bar, v in zip(bars, sandbox):
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                 f'{v:.1f}%', ha='center', fontsize=9)
    ax1.set_ylabel('Sandbox Invocation Rate (%)')
    ax1.set_title('(a) Sandbox Usage (Optimistic Efficiency)')
    ax1.set_xticklabels(methods, rotation=20, ha='right')
    ax1.set_ylim(0, 115)
    ax1.grid(axis='y', alpha=0.3)

    # Gas breakdown — optimistic vs dispute path
    paths = ['Optimistic Path\n(no dispute)', 'Dispute Path\n(full challenge)']
    base_g    = [350_000, 350_000]
    chal_g    = [0, 180_000]
    arb_g     = [0, 550_000]
    fin_g     = [100_000, 100_000]

    ax2.bar(paths, base_g, label='Publish+Propose', color='#4CAF50', alpha=0.85)
    ax2.bar(paths, chal_g, bottom=base_g, label='Challenge', color='#FF9800', alpha=0.85)
    b2 = [a+b for a, b in zip(base_g, chal_g)]
    ax2.bar(paths, arb_g, bottom=b2, label='Committee+Arbitration', color='#F44336', alpha=0.85)
    b3 = [a+b for a, b in zip(b2, arb_g)]
    ax2.bar(paths, fin_g, bottom=b3, label='Finalize', color='#2196F3', alpha=0.85)

    totals = [450_000, 1_180_000]
    for i, (p, t) in enumerate(zip(paths, totals)):
        ax2.text(i, t + 10_000, f'{t/1000:.0f}K', ha='center', fontsize=11, fontweight='bold')

    ax2.set_ylabel('Gas Cost')
    ax2.set_title('(b) Gas Cost: Optimistic vs Dispute Path')
    ax2.legend(loc='upper left', fontsize=9)
    ax2.grid(axis='y', alpha=0.3)

    plt.tight_layout()
    path = out_dir / "fig6_sandbox_gas.png"
    plt.savefig(path); plt.close()
    print(f"  Saved: {path.name}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", type=str, default=None,
                        help="Run ID, e.g. run_20260614_174758 (defaults to latest)")
    args = parser.parse_args()

    setup_style()
    summary, gt, run_dir = load_run(args.run)

    plots_dir = run_dir / "plots"
    plots_dir.mkdir(exist_ok=True)

    print(f"\nGenerating plots → {plots_dir}\n")
    plot_security_metrics(summary, plots_dir)
    plot_efficiency(summary, plots_dir)
    plot_radar(summary, plots_dir)
    plot_confusion(summary, plots_dir)
    plot_game_theory(gt, plots_dir)
    plot_sandbox(summary, plots_dir)

    print(f"\nDone. {len(list(plots_dir.glob('*.png')))} plots saved to:")
    print(f"  {plots_dir}")


if __name__ == "__main__":
    main()
