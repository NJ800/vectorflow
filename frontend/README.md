# VectorFlow frontend

Operational console for the VectorFlow job recommendation system. Next.js 16
(App Router) + TypeScript + Tailwind v4 + SWR, talking to the existing FastAPI
backend. There is no mock data anywhere: every number on screen came from the
API.

## Running it

This lives at `vectorflow/frontend`, alongside the backend at `vectorflow/backend`.
The backend must be up first, from `vectorflow/backend`:

```bash
docker compose up -d                  # postgres/pgvector, kafka, redis
cd app && uvicorn main:app --reload --port 8000
python scripts/consume_events.py      # from vectorflow/backend, in its own shell
```

The consumer is not optional. `POST /interactions/simulate` only publishes to
the `interaction-events` topic; without a consumer running, nothing is written
to `interactions` and no user embedding is ever updated, so the Activity feed
and the Dashboard will never reflect a simulated event.

Then:

```bash
npm install
npm run dev        # http://localhost:3000
```

`NEXT_PUBLIC_API_URL` points at the backend and defaults to
`http://localhost:8000`. It is set in `.env.local`.

## Layout

```
app/
  page.tsx            Dashboard: user list + recommendations
  jobs/page.tsx       Jobs browser: search/filter/sort, expand, simulate
  activity/page.tsx   Live activity feed (3s polling)
  globals.css         Design tokens (@theme) and the two animations
components/           AppShell, UserRow, JobRow, ActivityRow, Readout, StateNotice, Controls
lib/api.ts            The only place that talks to the backend
lib/format.ts         Timestamp/salary/number formatting
```

## Notes on the architecture it reflects

**Simulation is asynchronous and the UI says so.** Publishing an event shows
"published" and explains that the consumer updates the embedding afterwards.
Nothing fakes an instant change to recommendations, because there isn't one.

**Polling, not WebSockets.** The backend exposes `GET /activity/recent` and
nothing else; SWR's `refreshInterval` is the honest fit. Rows that were absent
from the previous poll get a brass edge that decays once.

**Timestamps are UTC.** `event_ts` is a Postgres `TIMESTAMP` with no zone and
the backend writes `datetime.utcnow()`, so FastAPI serialises it without a `Z`.
`parseServerTimestamp` in `lib/format.ts` appends one; passing the raw string to
`new Date()` would make every relative time wrong by the viewer's UTC offset.

**Seniority options are derived, not hardcoded.** There is no facet endpoint, so
the dropdown is built from the `seniority_level` values in a real sample of
rows plus whatever the current page returned.

**`source` and `latency_ms` are surfaced deliberately.** A `cache` hit answers
in ~1ms and a `live` request runs pgvector retrieval plus the XGBoost re-rank in
tens to hundreds of ms. That difference is the most interesting thing the API
tells you, so it sits in the readout strip rather than being hidden.
