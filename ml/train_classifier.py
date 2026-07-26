"""
Train the auto-approve vs. needs-human-review classifier on the synthetic
data, and export everything needed to port inference into TypeScript:
- feature means/stds (for standardization, since we're not shipping sklearn
  to the live app -- we standardize by hand in TS using these same values)
- the logistic regression weight vector + bias
- feature importances, for the demo's "why did it flag this" bar chart

Run generate_training_data.py first to produce training_data.csv.
"""

import csv
import json
import math
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score

FEATURES = [
    "headcount_growth_rate_pct",
    "new_hires_this_month",
    "cash_inflow_spike_ratio",
    "deal_size_ratio",
]
LABEL = "needs_human_review"


def load_data(path="training_data.csv"):
    X, y = [], []
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            X.append([float(row[feat]) for feat in FEATURES])
            y.append(int(row[LABEL]))
    return X, y


def standardize(X):
    n_features = len(X[0])
    means = [sum(row[i] for row in X) / len(X) for i in range(n_features)]
    stds = []
    for i in range(n_features):
        variance = sum((row[i] - means[i]) ** 2 for row in X) / len(X)
        stds.append(math.sqrt(variance) or 1.0)  # avoid div by zero
    X_std = [[(row[i] - means[i]) / stds[i] for i in range(n_features)] for row in X]
    return X_std, means, stds


def main():
    X, y = load_data()
    X_std, means, stds = standardize(X)

    X_train, X_test, y_train, y_test = train_test_split(
        X_std, y, test_size=0.2, random_state=42, stratify=y
    )

    model = LogisticRegression(class_weight="balanced", max_iter=1000)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]
    print(classification_report(y_test, y_pred, target_names=["auto_approve", "needs_review"]))
    print(f"ROC AUC: {roc_auc_score(y_test, y_prob):.3f}")

    # Feature importance = |coefficient|, normalized to sum to 1 for a clean bar chart
    coefs = model.coef_[0]
    abs_coefs = [abs(c) for c in coefs]
    total = sum(abs_coefs)
    importances = {FEATURES[i]: round(abs_coefs[i] / total, 4) for i in range(len(FEATURES))}
    importances_sorted = dict(sorted(importances.items(), key=lambda kv: -kv[1]))

    export = {
        "features": FEATURES,
        "means": means,
        "stds": stds,
        "weights": list(coefs),
        "bias": float(model.intercept_[0]),
        "feature_importance": importances_sorted,
        "decision_threshold": 0.5,
        "notes": (
            "Inference in TS: standardize each feature with (x - mean) / std "
            "using the means/stds here, dot product with weights, add bias, "
            "sigmoid it, threshold at decision_threshold. "
            "prob >= threshold => needs_human_review, else auto-approve."
        ),
    }

    with open("classifier_weights.json", "w") as f:
        json.dump(export, f, indent=2)

    print("\nFeature importance (for the demo bar chart):")
    for feat, imp in importances_sorted.items():
        print(f"  {feat}: {imp:.1%}")
    print("\nExported classifier_weights.json")


if __name__ == "__main__":
    main()
