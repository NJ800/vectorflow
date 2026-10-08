---
title: VectorFlow
emoji: 🧭
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# VectorFlow

A distributed personalized job recommendation engine — two-stage vector
retrieval + ML ranking, with live Kafka-driven personalization and
Redis-cached low-latency serving.

Backend: FastAPI + PostgreSQL/pgvector + Kafka + Redis + XGBoost, all
running together in a single container.