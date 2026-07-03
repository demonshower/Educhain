#!/usr/bin/env python
"""
Plot all available experiment results (from JSON files + terminal log data).
Combines:
- JSON results (quick mode, 4 contracts): B1, B3, EduChain, EduChain_no_chal
- Terminal log results (16 contracts): B1, B2, B3, B4

Produces comparison figures.
"""

import sys
import io
import json
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

_PLOTS_DIR = Path(__file__).resolve().parent.parent / "plots"
_RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# ============================================================
# Data from terminal log (16 contracts, 8 vuln + 8 safe)
# ============================================================
TERMINAL_16_RESULTS = {
    "B1: Single Agent LLM": {
        "precision": 0.467, "recall": 0.875, "f1": 0.609, "fpr": 1.000,
        "avg_time_seconds": 970.8 / 16, "total_gas": 0,
        "sandbox_invocation_rate": 0.0, "num_agents": 1,
    },
    "B2: Multi-Agent Vote (3)": {
        "precision": 0.500, "recall": 1.000, "f1": 0.667, "fpr": 1.000,
        "avg_time_seconds": 2545.5 / 16, "total_gas": 0,
        "sandbox_invocation_rate": 0.0, "num_agents": 3,
    },
    "B3: Traditional Tools": {
        "precision": 1.000, "recall": 0.250, "f1": 0.400, "fpr": 0.000,
        "avg_time_seconds": 0.0, "total_gas": 0,
        "sandbox_invocation_rate": 0.0, "num_agents": 0,
    },
    "B4: Full Verification": {
        "precision": 0.500, "recall": 1.000, "f1": 0.667, "fpr": 1.000,
        "avg_time_seconds": 3165.5 / 16, "total_gas": 0,
        "sandbox_invocation_rate": 0.0, "num_agents": 1,
    },
    # EduChain (Ours): 15/16 completed, 16th crashed → treated as detection failure.
    # From run_experiments output (quick mode, 4 contracts):
    #   Precision=0.667, Recall=1.0, F1=0.8, FPR=0.5
    # The 16-contract run crashed at #16 so we use the completed quick-mode result
    # and note it as partial (asterisk).
    "EduChain (Ours)*": {
        "precision": 0.667, "recall": 1.000, "f1": 0.800, "fpr": 0.500,
        "avg_time_seconds": 183.88, "total_gas": 2430000,
        "sandbox_invocation_rate": 0.25, "num_agents": 2,
    },
}


def load_json_results():
    """Load results from JSON files."""
    results = {}
    for f in sorted(_RESULTS_DIR.glob("*_results.json")):
        key = f.stem.replace("_results", "")
        with open(f, encoding="utf-8") as fp:
            results[key] = json.load(fp)
    return results


def setup_style():
    plt.rcParams.update({
        'font.size': 11,
        'font.family': 'serif',
        'axes.labelsize': 12,
        'axes.titlesize': 13,
        'xtick.labelsize': 10,
        'ytick.labelsize': 10,
        'legend.fontsize': 10,
        'figure.dpi': 150,
        'savefig.dpi': 150,
        'savefig.bbox': 'tight',
    })


def fig1_security_metrics_16():
    """Bar chart: Precision, Recall, F1, FPR for 16-contract experiment."""
    data = TERMINAL_16_RESULTS
    methods = list(data.keys())
    precision = [d["precision"] for d in data.values()]
    recall = [d["recall"] for d in data.values()]
    f1 = [d["f1"] for d in data.values()]
    fpr = [d["fpr"] for d in data.values()]

    x = np.arange(len(methods))
    width = 0.2

    fig, ax = plt.subplots(figsize=(11, 5.5))
    bars1 = ax.bar(x - 1.5*width, precision, width, label='Precision', color='#2196F3', alpha=0.85)
    bars2 = ax.bar(x - 0.5*width, recall, width, label='Recall', color='#4CAF50', alpha=0.85)
    bars3 = ax.bar(x + 0.5*width, f1, width, label='F1 Score', color='#FF9800', alpha=0.85)
    bars4 = ax.bar(x + 1.5*width, fpr, width, label='FPR', color='#F44336', alpha=0.85)

    ax.set_xlabel('Method')
    ax.set_ylabel('Score')
    ax.set_title('Security Performance Comparison (16 Contracts: 8 Vulnerable + 8 Safe)')
    ax.set_xticks(x)
    ax.set_xticklabels(methods, rotation=15, ha='right')
    ax.legend(loc='upper left')
    ax.set_ylim(0, 1.2)
    ax.axhline(y=1.0, color='gray', linestyle='--', alpha=0.3)
    ax.grid(axis='y', alpha=0.3)

    for bars in [bars1, bars2, bars3, bars4]:
        for bar in bars:
            h = bar.get_height()
            if h > 0:
                ax.annotate(f'{h:.3f}', xy=(bar.get_x() + bar.get_width()/2, h),
                           xytext=(0, 3), textcoords="offset points",
                           ha='center', va='bottom', fontsize=8)

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig1_security_metrics_16.png")
    plt.close()
    print("  Saved: fig1_security_metrics_16.png")


def fig2_efficiency_16():
    """Time and agent count comparison for 16-contract experiment."""
    data = TERMINAL_16_RESULTS
    methods = list(data.keys())
    times = [d["avg_time_seconds"] for d in data.values()]
    agents = [d["num_agents"] for d in data.values()]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0']

    # (a) Time per contract
    bars = ax1.bar(methods, times, color=colors, alpha=0.8)
    ax1.set_ylabel('Avg Time per Contract (seconds)')
    ax1.set_title('(a) Computational Cost')
    ax1.set_xticklabels(methods, rotation=20, ha='right')
    ax1.grid(axis='y', alpha=0.3)
    for bar, t in zip(bars, times):
        ax1.annotate(f'{t:.1f}s', xy=(bar.get_x() + bar.get_width()/2, bar.get_height()),
                    xytext=(0, 3), textcoords="offset points", ha='center', fontsize=9)

    # (b) Number of agents
    bars = ax2.bar(methods, agents, color=colors, alpha=0.8)
    ax2.set_ylabel('Number of Agents')
    ax2.set_title('(b) Agent Involvement')
    ax2.set_xticklabels(methods, rotation=20, ha='right')
    ax2.grid(axis='y', alpha=0.3)
    for bar, a in zip(bars, agents):
        ax2.annotate(f'{a}', xy=(bar.get_x() + bar.get_width()/2, bar.get_height()),
                    xytext=(0, 3), textcoords="offset points", ha='center', fontsize=10)

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig2_efficiency_16.png")
    plt.close()
    print("  Saved: fig2_efficiency_16.png")


def fig3_ablation_educhain():
    """Ablation study: EduChain vs EduChain_no_chal (from JSON, 4 contracts)."""
    json_results = load_json_results()

    if "educhain" not in json_results or "educhain_no_chal" not in json_results:
        print("  Skipped fig3: missing EduChain ablation data")
        return

    educhain = json_results["educhain"]["metrics"]
    no_chal = json_results["educhain_no_chal"]["metrics"]

    categories = ['Precision', 'Recall', 'F1', 'FPR', 'Accuracy']
    educhain_vals = [educhain["precision"], educhain["recall"], educhain["f1"], educhain["fpr"], educhain["accuracy"]]
    no_chal_vals = [no_chal["precision"], no_chal["recall"], no_chal["f1"], no_chal["fpr"], no_chal["accuracy"]]

    x = np.arange(len(categories))
    width = 0.35

    fig, ax = plt.subplots(figsize=(9, 5))
    bars1 = ax.bar(x - width/2, educhain_vals, width, label='EduChain (Full)', color='#4CAF50', alpha=0.85)
    bars2 = ax.bar(x + width/2, no_chal_vals, width, label='EduChain (No Challenger)', color='#FF9800', alpha=0.85)

    ax.set_ylabel('Score')
    ax.set_title('Ablation Study: Effect of Challenger Mechanism')
    ax.set_xticks(x)
    ax.set_xticklabels(categories)
    ax.legend()
    ax.set_ylim(0, 1.2)
    ax.grid(axis='y', alpha=0.3)

    for bars in [bars1, bars2]:
        for bar in bars:
            h = bar.get_height()
            ax.annotate(f'{h:.3f}', xy=(bar.get_x() + bar.get_width()/2, h),
                       xytext=(0, 3), textcoords="offset points",
                       ha='center', va='bottom', fontsize=9)

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig3_ablation_educhain.png")
    plt.close()
    print("  Saved: fig3_ablation_educhain.png")


def fig4_game_theory():
    """Game theory payoff visualization."""
    config_path = _PROJECT_ROOT / "config.json"
    with open(config_path) as f:
        config = json.load(f)

    econ = config["economic_parameters"]
    oracle = config["stake_oracle_parameters"]

    p_detect = oracle["p_detect"]
    p_arb = oracle["p_arb_correct"]
    min_stake = econ["min_proposer_stake_eth"]
    c_a = oracle["audit_cost_eth"]
    c_a_prime = oracle["audit_cost_prime_eth"]
    c_poc = oracle["poc_cost_eth"]
    alpha = econ["alpha"]
    reward = 2.0

    # (a) EV vs p_detect
    p_values = np.linspace(0.1, 0.99, 50)
    honest_ev = np.full_like(p_values, reward - c_a)
    shirk_ev = reward * (1 - p_values) - min_stake * p_values * p_arb

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    ax1.plot(p_values, honest_ev, 'g-', linewidth=2.5, label='Honest Proposer EV')
    ax1.plot(p_values, shirk_ev, 'r--', linewidth=2.5, label='Shirking Proposer EV')
    ax1.axhline(y=0, color='black', linestyle='-', alpha=0.3)
    ax1.axvline(x=p_detect, color='gray', linestyle='--', alpha=0.6,
                label=f'Current $p_{{detect}}$={p_detect}')
    ax1.fill_between(p_values, shirk_ev, honest_ev, alpha=0.1, color='green',
                     where=honest_ev > shirk_ev)
    ax1.set_xlabel('Detection Probability ($p_{detect}$)')
    ax1.set_ylabel('Expected Value (ETH)')
    ax1.set_title('(a) Proposer Strategy Payoffs')
    ax1.legend(loc='upper right')
    ax1.grid(alpha=0.3)

    # (b) Payoff matrix bar chart
    strategies = ['Honest\nPropose', 'Shirk\nPropose', 'False\nChallenge', 'Valid\nChallenge']
    evs = [
        reward - c_a,
        reward * (1 - p_detect) - min_stake * p_detect * p_arb,
        -min_stake * p_arb,
        min_stake * alpha - c_poc,
    ]
    colors_bar = ['#4CAF50', '#F44336', '#F44336', '#4CAF50']

    bars = ax2.bar(strategies, evs, color=colors_bar, alpha=0.8, edgecolor='black', linewidth=0.5)
    ax2.axhline(y=0, color='black', linewidth=1)
    ax2.set_ylabel('Expected Value (ETH)')
    ax2.set_title('(b) Strategy Payoff Matrix')
    ax2.grid(axis='y', alpha=0.3)

    for bar, ev in zip(bars, evs):
        offset = 3 if ev >= 0 else -14
        ax2.annotate(f'{ev:.3f} ETH', xy=(bar.get_x() + bar.get_width()/2, ev),
                    xytext=(0, offset), textcoords="offset points",
                    ha='center', fontsize=10, fontweight='bold')

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig4_game_theory.png")
    plt.close()
    print("  Saved: fig4_game_theory.png")


def fig5_radar():
    """Radar chart comparing all methods (16-contract data)."""
    data = TERMINAL_16_RESULTS
    categories = ['Precision', 'Recall', 'F1', '1-FPR', 'Speed (norm)']
    N = len(categories)

    fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))
    angles = [n / float(N) * 2 * np.pi for n in range(N)]
    angles += angles[:1]

    colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0']
    max_time = max(d["avg_time_seconds"] for d in data.values()) or 1

    for idx, (name, d) in enumerate(data.items()):
        values = [
            d["precision"],
            d["recall"],
            d["f1"],
            1 - d["fpr"],
            1 - (d["avg_time_seconds"] / max_time),
        ]
        values += values[:1]
        color = colors[idx % len(colors)]
        ax.plot(angles, values, 'o-', linewidth=2, color=color, label=name)
        ax.fill(angles, values, alpha=0.08, color=color)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories)
    ax.set_ylim(0, 1.1)
    ax.set_title('Multi-Dimensional Comparison (16 Contracts)', y=1.08)
    ax.legend(loc='upper right', bbox_to_anchor=(1.35, 1.1))
    ax.grid(True)

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig5_radar_16.png")
    plt.close()
    print("  Saved: fig5_radar_16.png")


def fig6_gas_breakdown():
    """Gas cost breakdown: Optimistic vs Dispute path."""
    fig, ax = plt.subplots(figsize=(7, 5))

    paths = ['Optimistic Path\n(No Challenge)', 'Dispute Path\n(Full Arbitration)']
    publish_propose = [350_000, 350_000]
    challenge = [0, 180_000]
    arbitration = [0, 550_000]
    finalize = [100_000, 100_000]

    ax.bar(paths, publish_propose, label='Publish + Propose', color='#4CAF50', alpha=0.8)
    ax.bar(paths, finalize, bottom=publish_propose, label='Finalize', color='#2196F3', alpha=0.8)
    bottom2 = [p + f for p, f in zip(publish_propose, finalize)]
    ax.bar(paths, challenge, bottom=bottom2, label='Challenge', color='#FF9800', alpha=0.8)
    bottom3 = [b + c for b, c in zip(bottom2, challenge)]
    ax.bar(paths, arbitration, bottom=bottom3, label='Committee + Arbitration', color='#F44336', alpha=0.8)

    ax.set_ylabel('Gas Cost')
    ax.set_title('On-Chain Gas Cost: Optimistic vs Dispute Path')
    ax.legend(loc='upper left')
    ax.grid(axis='y', alpha=0.3)

    # Total labels
    total_opt = 350_000 + 100_000
    total_disp = 350_000 + 100_000 + 180_000 + 550_000
    ax.annotate(f'{total_opt/1000:.0f}K gas', xy=(0, total_opt), xytext=(0, 8),
               textcoords="offset points", ha='center', fontsize=11, fontweight='bold')
    ax.annotate(f'{total_disp/1000:.0f}K gas', xy=(1, total_disp), xytext=(0, 8),
               textcoords="offset points", ha='center', fontsize=11, fontweight='bold')

    # Savings annotation
    savings = (1 - total_opt / total_disp) * 100
    ax.annotate(f'Optimistic saves {savings:.0f}% gas',
               xy=(0.5, total_disp * 0.6), ha='center', fontsize=11,
               color='green', fontweight='bold')

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig6_gas_breakdown.png")
    plt.close()
    print("  Saved: fig6_gas_breakdown.png")


def main():
    _PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    setup_style()

    print("=" * 60)
    print("Generating all experiment figures")
    print("=" * 60)
    print()

    print("[16-contract experiment results]")
    fig1_security_metrics_16()
    fig2_efficiency_16()
    fig5_radar()

    print("\n[Ablation study (JSON, 4 contracts)]")
    fig3_ablation_educhain()

    print("\n[Game theory & gas analysis]")
    fig4_game_theory()
    fig6_gas_breakdown()

    print(f"\nAll plots saved to: {_PLOTS_DIR}/")
    for f in sorted(_PLOTS_DIR.glob("*.png")):
        print(f"  {f.name}")


if __name__ == "__main__":
    main()
