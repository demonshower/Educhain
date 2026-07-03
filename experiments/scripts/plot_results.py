#!/usr/bin/env python
"""
Generate comparison charts for EduChain experiment results.

Produces:
1. Security metrics bar chart (Precision, Recall, F1, FPR)
2. Efficiency comparison (Time, Gas)
3. Per-vulnerability-type heatmap
4. Game theory payoff visualization
5. Ablation study chart

Usage:
    python experiments/scripts/plot_results.py
"""

import sys
import io
import json
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

_RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
_PLOTS_DIR = Path(__file__).resolve().parent.parent / "plots"
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def load_results():
    results = {}
    for f in sorted(_RESULTS_DIR.glob("*_results.json")):
        key = f.stem.replace("_results", "")
        with open(f, encoding="utf-8") as fp:
            results[key] = json.load(fp)
    return results


def setup_style():
    """Set up publication-quality plot style."""
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


def plot_security_metrics(results: dict):
    """Fig 1: Security metrics comparison bar chart."""
    methods = []
    precision = []
    recall = []
    f1 = []
    fpr = []

    for key, data in results.items():
        m = data["metrics"]
        methods.append(data["name"].replace("B1_", "B1: ").replace("B3_", "B3: ").replace("B4_", "B4: "))
        precision.append(m["precision"])
        recall.append(m["recall"])
        f1.append(m["f1"])
        fpr.append(m["fpr"])

    x = np.arange(len(methods))
    width = 0.2

    fig, ax = plt.subplots(figsize=(10, 5))

    bars1 = ax.bar(x - 1.5*width, precision, width, label='Precision', color='#2196F3', alpha=0.85)
    bars2 = ax.bar(x - 0.5*width, recall, width, label='Recall', color='#4CAF50', alpha=0.85)
    bars3 = ax.bar(x + 0.5*width, f1, width, label='F1 Score', color='#FF9800', alpha=0.85)
    bars4 = ax.bar(x + 1.5*width, fpr, width, label='FPR', color='#F44336', alpha=0.85)

    ax.set_xlabel('Method')
    ax.set_ylabel('Score')
    ax.set_title('Security Performance Comparison')
    ax.set_xticks(x)
    ax.set_xticklabels(methods, rotation=15, ha='right')
    ax.legend(loc='upper right')
    ax.set_ylim(0, 1.15)
    ax.axhline(y=1.0, color='gray', linestyle='--', alpha=0.3)
    ax.grid(axis='y', alpha=0.3)

    # Add value labels on bars
    for bars in [bars1, bars2, bars3, bars4]:
        for bar in bars:
            height = bar.get_height()
            if height > 0:
                ax.annotate(f'{height:.2f}',
                    xy=(bar.get_x() + bar.get_width() / 2, height),
                    xytext=(0, 3), textcoords="offset points",
                    ha='center', va='bottom', fontsize=8)

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig1_security_metrics.png")
    plt.close()
    print("  Saved: fig1_security_metrics.png")


def plot_efficiency(results: dict):
    """Fig 2: Efficiency comparison (time + gas)."""
    methods = []
    times = []
    gas = []

    for key, data in results.items():
        m = data["metrics"]
        methods.append(data["name"].replace("B1_", "B1: ").replace("B3_", "B3: "))
        times.append(m["avg_time_seconds"])
        gas.append(m["total_gas"])

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    # Time comparison
    colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336'][:len(methods)]
    bars = ax1.bar(methods, times, color=colors, alpha=0.8)
    ax1.set_ylabel('Average Time per Contract (seconds)')
    ax1.set_title('(a) Computational Cost')
    ax1.set_xticklabels(methods, rotation=20, ha='right')
    ax1.grid(axis='y', alpha=0.3)
    for bar, t in zip(bars, times):
        ax1.annotate(f'{t:.1f}s', xy=(bar.get_x() + bar.get_width()/2, bar.get_height()),
                    xytext=(0, 3), textcoords="offset points", ha='center', fontsize=9)

    # Gas comparison
    bars = ax2.bar(methods, [g/1000 for g in gas], color=colors, alpha=0.8)
    ax2.set_ylabel('Total Gas Cost (thousands)')
    ax2.set_title('(b) On-chain Gas Cost')
    ax2.set_xticklabels(methods, rotation=20, ha='right')
    ax2.grid(axis='y', alpha=0.3)
    for bar, g in zip(bars, gas):
        label = f'{g/1000:.0f}K' if g > 0 else '0'
        ax2.annotate(label, xy=(bar.get_x() + bar.get_width()/2, bar.get_height()),
                    xytext=(0, 3), textcoords="offset points", ha='center', fontsize=9)

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig2_efficiency.png")
    plt.close()
    print("  Saved: fig2_efficiency.png")


def plot_vuln_type_heatmap(results: dict):
    """Fig 3: Per-vulnerability-type detection heatmap."""
    type_map = {
        "vuln_001": "Reentrancy", "vuln_002": "Reentrancy",
        "vuln_003": "Access Ctrl", "vuln_004": "Access Ctrl",
        "vuln_005": "Int Overflow", "vuln_006": "Oracle Manip",
        "vuln_007": "Frontrunning", "vuln_008": "Delegatecall",
        "vuln_009": "Sig Replay", "vuln_010": "Flash Loan",
    }

    # Only use methods that have full dataset results
    full_methods = {k: v for k, v in results.items()
                    if v["dataset_size"] >= 10}

    if not full_methods:
        # Use all available
        full_methods = results

    vuln_types = sorted(set(type_map.values()))
    method_names = [data["name"] for data in full_methods.values()]

    # Build detection matrix
    matrix = np.zeros((len(vuln_types), len(full_methods)))

    for j, (key, data) in enumerate(full_methods.items()):
        type_counts = {}
        type_detected = {}
        for c in data.get("per_contract", []):
            if c["id"] in type_map:
                vtype = type_map[c["id"]]
                type_counts[vtype] = type_counts.get(vtype, 0) + 1
                if c["detected"]:
                    type_detected[vtype] = type_detected.get(vtype, 0) + 1

        for i, vtype in enumerate(vuln_types):
            total = type_counts.get(vtype, 0)
            detected = type_detected.get(vtype, 0)
            matrix[i, j] = detected / total if total > 0 else -1  # -1 = no data

    fig, ax = plt.subplots(figsize=(8, 6))

    # Custom colormap: gray for no data, red-yellow-green for 0-100%
    masked = np.ma.masked_where(matrix < 0, matrix)
    im = ax.imshow(masked, cmap='RdYlGn', aspect='auto', vmin=0, vmax=1)

    ax.set_xticks(range(len(method_names)))
    ax.set_xticklabels(method_names, rotation=30, ha='right')
    ax.set_yticks(range(len(vuln_types)))
    ax.set_yticklabels(vuln_types)
    ax.set_title('Detection Rate by Vulnerability Type')

    # Add text annotations
    for i in range(len(vuln_types)):
        for j in range(len(method_names)):
            val = matrix[i, j]
            if val >= 0:
                text = f'{val*100:.0f}%'
                color = 'white' if val < 0.4 or val > 0.8 else 'black'
                ax.text(j, i, text, ha='center', va='center', fontsize=9, color=color)
            else:
                ax.text(j, i, 'N/A', ha='center', va='center', fontsize=8, color='gray')

    plt.colorbar(im, ax=ax, label='Detection Rate')
    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig3_vuln_type_heatmap.png")
    plt.close()
    print("  Saved: fig3_vuln_type_heatmap.png")


def plot_game_theory(results: dict):
    """Fig 4: Game theory payoff analysis."""
    # Load config for parameters
    config_path = _PROJECT_ROOT / "config.json"
    with open(config_path) as f:
        config = json.load(f)

    econ = config["economic_parameters"]
    oracle = config["stake_oracle_parameters"]

    p_detect = oracle["p_detect"]
    p_arb = oracle["p_arb_correct"]
    min_stake = econ["min_proposer_stake_eth"]
    c_a = oracle["audit_cost_eth"]
    reward = 2.0

    # Compute EV for different p_detect values
    p_values = np.linspace(0.1, 0.99, 50)
    honest_ev = np.full_like(p_values, reward - c_a)
    shirk_ev = reward * (1 - p_values) - min_stake * p_values * p_arb
    false_chal_ev = np.full_like(p_values, -min_stake * p_arb)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    # (a) EV vs p_detect
    ax1.plot(p_values, honest_ev, 'g-', linewidth=2, label='Honest Proposer')
    ax1.plot(p_values, shirk_ev, 'r--', linewidth=2, label='Shirking Proposer')
    ax1.plot(p_values, false_chal_ev, 'b:', linewidth=2, label='False Challenger')
    ax1.axhline(y=0, color='black', linestyle='-', alpha=0.3)
    ax1.axvline(x=p_detect, color='gray', linestyle='--', alpha=0.5, label=f'Current p_detect={p_detect}')
    ax1.fill_between(p_values, shirk_ev, honest_ev, alpha=0.1, color='green',
                     where=honest_ev > shirk_ev)
    ax1.set_xlabel('Detection Probability (p_detect)')
    ax1.set_ylabel('Expected Value (ETH)')
    ax1.set_title('(a) Strategy Payoffs vs Detection Probability')
    ax1.legend(loc='upper right')
    ax1.grid(alpha=0.3)
    ax1.set_xlim(0.1, 1.0)

    # (b) Payoff matrix
    strategies = ['Honest\nPropose', 'Shirk\nPropose', 'False\nChallenge', 'Valid\nChallenge']
    evs = [
        reward - c_a,
        reward * (1 - p_detect) - min_stake * p_detect * p_arb,
        -min_stake * p_arb,
        min_stake * econ["alpha"] - oracle["poc_cost_eth"],
    ]
    colors_bar = ['#4CAF50', '#F44336', '#F44336', '#4CAF50']

    bars = ax2.bar(strategies, evs, color=colors_bar, alpha=0.8, edgecolor='black', linewidth=0.5)
    ax2.axhline(y=0, color='black', linewidth=1)
    ax2.set_ylabel('Expected Value (ETH)')
    ax2.set_title('(b) Strategy Payoff Matrix')
    ax2.grid(axis='y', alpha=0.3)

    for bar, ev in zip(bars, evs):
        va = 'bottom' if ev >= 0 else 'top'
        offset = 3 if ev >= 0 else -12
        ax2.annotate(f'{ev:.3f}', xy=(bar.get_x() + bar.get_width()/2, ev),
                    xytext=(0, offset), textcoords="offset points",
                    ha='center', va=va, fontsize=10, fontweight='bold')

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig4_game_theory.png")
    plt.close()
    print("  Saved: fig4_game_theory.png")


def plot_radar_chart(results: dict):
    """Fig 5: Radar chart comparing all methods across dimensions."""
    categories = ['Precision', 'Recall', 'F1', '1-FPR', 'Speed\n(norm)', 'Gas Eff\n(norm)']
    N = len(categories)

    fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))

    angles = [n / float(N) * 2 * np.pi for n in range(N)]
    angles += angles[:1]

    colors = ['#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336']
    max_time = max(d["metrics"]["avg_time_seconds"] for d in results.values()) or 1
    max_gas = max(d["metrics"]["total_gas"] for d in results.values()) or 1

    for idx, (key, data) in enumerate(results.items()):
        m = data["metrics"]
        values = [
            m["precision"],
            m["recall"],
            m["f1"],
            1 - m["fpr"],
            1 - (m["avg_time_seconds"] / max_time) if max_time > 0 else 1,
            1 - (m["total_gas"] / max_gas) if max_gas > 0 else 1,
        ]
        values += values[:1]

        color = colors[idx % len(colors)]
        ax.plot(angles, values, 'o-', linewidth=2, color=color, label=data["name"])
        ax.fill(angles, values, alpha=0.1, color=color)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories)
    ax.set_ylim(0, 1.1)
    ax.set_title('Multi-Dimensional Comparison', y=1.08)
    ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.1))
    ax.grid(True)

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig5_radar.png")
    plt.close()
    print("  Saved: fig5_radar.png")


def plot_sandbox_analysis(results: dict):
    """Fig 6: Sandbox invocation and PoC success analysis."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 5))

    # (a) Sandbox invocation rate (optimistic efficiency)
    methods = []
    sandbox_rates = []
    challenge_rates = []

    for key, data in results.items():
        methods.append(data["name"])
        m = data["metrics"]
        sandbox_rates.append(m.get("sandbox_invocation_rate", 0) * 100)
        per_contract = data.get("per_contract", [])
        cr = sum(1 for c in per_contract if c.get("challenge_raised")) / len(per_contract) * 100 if per_contract else 0
        challenge_rates.append(cr)

    x = np.arange(len(methods))
    width = 0.35

    ax1.bar(x - width/2, challenge_rates, width, label='Challenge Rate', color='#FF9800', alpha=0.8)
    ax1.bar(x + width/2, sandbox_rates, width, label='Sandbox Rate', color='#2196F3', alpha=0.8)
    ax1.set_ylabel('Rate (%)')
    ax1.set_title('(a) Optimistic Efficiency')
    ax1.set_xticks(x)
    ax1.set_xticklabels(methods, rotation=20, ha='right')
    ax1.legend()
    ax1.grid(axis='y', alpha=0.3)

    # (b) Gas cost breakdown (stacked bar)
    gas_components = {
        'Publish + Propose': 350_000,
        'Challenge': 180_000,
        'Committee + Arbitration': 550_000,
        'Finalize': 100_000,
    }

    # Optimistic path vs Dispute path
    paths = ['Optimistic\n(no dispute)', 'Dispute\n(full path)']
    optimistic_gas = [350_000 + 100_000, 0]  # publish+propose+finalize
    challenge_gas = [0, 180_000]
    arbitration_gas = [0, 550_000]
    finalize_gas = [0, 100_000]
    base_gas = [350_000, 350_000]

    ax2.bar(paths, base_gas, label='Publish + Propose', color='#4CAF50', alpha=0.8)
    ax2.bar(paths, challenge_gas, bottom=base_gas, label='Challenge', color='#FF9800', alpha=0.8)
    bottom2 = [b+c for b, c in zip(base_gas, challenge_gas)]
    ax2.bar(paths, arbitration_gas, bottom=bottom2, label='Committee + Arbitration', color='#F44336', alpha=0.8)
    bottom3 = [b+a for b, a in zip(bottom2, arbitration_gas)]
    ax2.bar(paths, [100_000, 100_000], bottom=[350_000, bottom3[1]], label='Finalize', color='#2196F3', alpha=0.8)

    ax2.set_ylabel('Gas Cost')
    ax2.set_title('(b) Gas Cost: Optimistic vs Dispute Path')
    ax2.legend(loc='upper left')
    ax2.grid(axis='y', alpha=0.3)

    # Add total labels
    ax2.annotate('450K', xy=(0, 450_000), xytext=(0, 5), textcoords="offset points",
                ha='center', fontsize=11, fontweight='bold')
    ax2.annotate('1.08M', xy=(1, 1_080_000), xytext=(0, 5), textcoords="offset points",
                ha='center', fontsize=11, fontweight='bold')

    plt.tight_layout()
    plt.savefig(_PLOTS_DIR / "fig6_sandbox_analysis.png")
    plt.close()
    print("  Saved: fig6_sandbox_analysis.png")


def main():
    _PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    setup_style()

    results = load_results()
    if not results:
        print("No results found. Run experiments first.")
        return

    print(f"Loaded results: {list(results.keys())}")
    print(f"Generating plots...\n")

    plot_security_metrics(results)
    plot_efficiency(results)
    plot_vuln_type_heatmap(results)
    plot_game_theory(results)
    plot_radar_chart(results)
    plot_sandbox_analysis(results)

    print(f"\nAll plots saved to: {_PLOTS_DIR}/")
    print("Files:")
    for f in sorted(_PLOTS_DIR.glob("*.png")):
        print(f"  {f.name}")


if __name__ == "__main__":
    main()
