import pandas as pd
import numpy as np

K_VALUES = [5, 10]
RELEVANCE_THRESHOLD = 1  # label >= 1 counts as "relevant" for Recall/MAP (binary)

def dcg_at_k(relevances, k):
    relevances = relevances[:k]
    if len(relevances) == 0:
        return 0.0
    discounts = np.log2(np.arange(2, len(relevances) + 2))
    return float(np.sum((2 ** np.array(relevances) - 1) / discounts))

def ndcg_at_k(relevances, k):
    actual_dcg = dcg_at_k(relevances, k)
    ideal_relevances = sorted(relevances, reverse=True)
    ideal_dcg = dcg_at_k(ideal_relevances, k)
    if ideal_dcg == 0:
        return 0.0
    return actual_dcg / ideal_dcg

def recall_at_k(relevances, k, total_relevant):
    if total_relevant == 0:
        return None  # undefined for users with zero relevant items -- excluded from the average
    hits = sum(1 for r in relevances[:k] if r >= RELEVANCE_THRESHOLD)
    return hits / total_relevant

def average_precision_at_k(relevances, k):
    relevances = relevances[:k]
    hits = 0
    precisions = []
    for i, r in enumerate(relevances, 1):
        if r >= RELEVANCE_THRESHOLD:
            hits += 1
            precisions.append(hits / i)
    if not precisions:
        return 0.0
    return float(np.mean(precisions))

def evaluate_ranking(df, score_col, k_values):
    results = {f"recall@{k}": [] for k in k_values}
    results.update({f"ndcg@{k}": [] for k in k_values})
    results.update({f"map@{k}": [] for k in k_values})

    for user_id, group in df.groupby("user_id"):
        ranked = group.sort_values(score_col, ascending=False)
        relevances = ranked["label"].tolist()
        total_relevant = sum(1 for r in relevances if r >= RELEVANCE_THRESHOLD)

        for k in k_values:
            r_at_k = recall_at_k(relevances, k, total_relevant)
            if r_at_k is not None:
                results[f"recall@{k}"].append(r_at_k)
            results[f"ndcg@{k}"].append(ndcg_at_k(relevances, k))
            results[f"map@{k}"].append(average_precision_at_k(relevances, k))

    return {metric: float(np.mean(scores)) for metric, scores in results.items() if scores}

def evaluate():
    df = pd.read_csv("data/test_predictions.csv")
    print(f"Evaluating on {df['user_id'].nunique()} test users, {len(df)} total rows.\n")

    xgb_results = evaluate_ranking(df, score_col="predicted_score", k_values=K_VALUES)
    baseline_results = evaluate_ranking(df, score_col="cosine_similarity", k_values=K_VALUES)

    print(f"{'Metric':<12} {'Cosine-only (Stage 1)':<24} {'XGBoost (Stage 1+2)':<22} {'Improvement':<12}")
    print("-" * 72)
    for metric in sorted(xgb_results.keys()):
        base = baseline_results[metric]
        xgb = xgb_results[metric]
        delta = xgb - base
        pct = (delta / base * 100) if base > 0 else 0
        print(f"{metric:<12} {base:<24.4f} {xgb:<22.4f} {delta:+.4f} ({pct:+.1f}%)")

if __name__ == "__main__":
    evaluate()