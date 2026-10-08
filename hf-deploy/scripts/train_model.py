import pandas as pd
import numpy as np
import xgboost as xgb
import pickle
from sklearn.model_selection import train_test_split

FEATURE_COLS = [
    "cosine_similarity", "same_location", "title_overlap",
    "skill_overlap", "experience_years", "days_since_posted",
    "job_popularity", "user_activity_level",
]

def load_and_split():
    df = pd.read_csv("data/training_features.csv")

    # Split by user_id, not by row -- keeps each user's full candidate set
    # together on one side, avoiding leakage between train and test.
    unique_users = df["user_id"].unique()
    train_users, test_users = train_test_split(unique_users, test_size=0.2, random_state=42)

    train_df = df[df["user_id"].isin(train_users)].copy()
    test_df = df[df["user_id"].isin(test_users)].copy()

    # XGBoost's ranking objective requires rows grouped contiguously by query (user_id),
    # with group sizes telling it where one user's candidate set ends and the next begins.
    train_df = train_df.sort_values("user_id").reset_index(drop=True)
    test_df = test_df.sort_values("user_id").reset_index(drop=True)

    return train_df, test_df

def to_group_sizes(df):
    return df.groupby("user_id").size().tolist()

def train_model():
    train_df, test_df = load_and_split()
    print(f"Train: {len(train_df)} rows, {train_df['user_id'].nunique()} users")
    print(f"Test:  {len(test_df)} rows, {test_df['user_id'].nunique()} users")

    X_train, y_train = train_df[FEATURE_COLS], train_df["label"]
    X_test, y_test = test_df[FEATURE_COLS], test_df["label"]

    train_groups = to_group_sizes(train_df)
    test_groups = to_group_sizes(test_df)

    dtrain = xgb.DMatrix(X_train, label=y_train)
    dtrain.set_group(train_groups)

    dtest = xgb.DMatrix(X_test, label=y_test)
    dtest.set_group(test_groups)

    params = {
    "objective": "rank:ndcg",
    "eta": 0.05,
    "max_depth": 4,
    "min_child_weight": 5,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "lambda": 2.0,
    "eval_metric": ["ndcg@10"],
    }

    print("\nTraining XGBoost ranker...")
    model = xgb.train(
        params,
        dtrain,
        num_boost_round=100,
        evals=[(dtrain, "train"), (dtest, "test")],
        early_stopping_rounds=15,
        verbose_eval=10,
    )

    model.save_model("data/xgboost_ranker.json")
    with open("data/feature_cols.pkl", "wb") as f:
        pickle.dump(FEATURE_COLS, f)

    print("\nFeature importance (gain):")
    importance = model.get_score(importance_type="gain")
    for feat, score in sorted(importance.items(), key=lambda x: -x[1]):
        print(f"  {feat}: {score:.2f}")

    # Save test set (with predictions) for the evaluation script (Step 4)
    best_iter = model.best_iteration
    print(f"\nBest iteration: {best_iter} (test-ndcg@10 = {model.best_score:.5f})")
    test_df["predicted_score"] = model.predict(dtest, iteration_range=(0, best_iter + 1))
    test_df.to_csv("data/test_predictions.csv", index=False)
    print(f"\nSaved test predictions to data/test_predictions.csv")

if __name__ == "__main__":
    train_model()