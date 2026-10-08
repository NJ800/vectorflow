import pandas as pd

df = pd.read_csv("data/postings.csv", nrows=5)
print("COLUMNS:", list(df.columns))
print()
print(df.head())
print()
print("Total row count:")
print(sum(1 for _ in open("data/postings.csv", encoding="utf-8")) - 1)