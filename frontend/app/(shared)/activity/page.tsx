"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { getRecentActivity } from "@/lib/api";
import { formatCount, relativeTime } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { ActivityRow } from "@/components/ActivityRow";
import { Readout, ReadoutStrip } from "@/components/Readout";
import {
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
} from "@/components/StateNotice";

const LIMIT = 40;
const POLL_MS = 3000;

// Scoped to everyone's activity, not just this account's own -- the point
// of this page is watching the system respond to behavior in general
// (a live demo of the whole pipeline), and a single job seeker's own feed
// would usually sit empty between test clicks. If this ever needs to be
// "my activity only", the backend already returns user_id per row; filter
// client-side on account.linked_user_id.
export default function ActivityPage() {
  // Polling, not WebSockets or SSE: the backend exposes a plain REST endpoint
  // over the interactions table and nothing else.
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    ["activity", LIMIT],
    () => getRecentActivity(LIMIT),
    { refreshInterval: POLL_MS, revalidateOnFocus: true }
  );

  const seenRef = useRef<Set<number> | null>(null);
  const [arrived, setArrived] = useState<Set<number>>(new Set());

  // Ticks once a second, so relative times move between polls instead of
  // freezing until the next response lands.
  const now = useNow(1000);

  useEffect(() => {
    if (!data) return;
    const ids = data.events.map((event) => event.interaction_id);

    // The first successful response is the baseline; highlighting all of it
    // would claim dozens of events "just happened" on page load.
    if (seenRef.current === null) {
      seenRef.current = new Set(ids);
      return;
    }

    const incoming = ids.filter((id) => !seenRef.current!.has(id));
    if (incoming.length === 0) return;
    for (const id of incoming) seenRef.current.add(id);
    setArrived(new Set(incoming));
  }, [data]);

  const events = data?.events ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-display text-xl leading-none text-ink">
            Live activity
          </h1>
          <p className="mt-1.5 text-xs text-muted">
            Interaction rows written by the Kafka consumer, newest first, across every account.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block size-1.5 rounded-full ${
              error ? "bg-muted" : "vf-live-dot bg-accent"
            }`}
          />
          <span className="text-xs text-muted" role="status">
            {error
              ? "polling failed"
              : isValidating
                ? "polling · fetching"
                : `polling every ${POLL_MS / 1000}s`}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <ReadoutStrip>
          <Readout
            label="events shown"
            value={data ? String(events.length) : "—"}
          />
          <Readout
            label="newest interaction"
            value={
              events.length ? formatCount(events[0].interaction_id) : "—"
            }
          />
          <Readout
            label="last event"
            value={
              events.length && now
                ? relativeTime(events[0].event_ts, now)
                : "—"
            }
            tone="live"
          />
        </ReadoutStrip>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <LoadingNotice label="Loading recent activity" />
        ) : error ? (
          <ErrorNotice
            label="Could not load the activity feed"
            error={error}
            onRetry={() => mutate()}
          />
        ) : events.length === 0 ? (
          <EmptyNotice
            title="No interactions recorded yet."
            detail="The interactions table is empty. Publish an event from the Jobs page — once the consumer processes it, the row appears here within a few seconds."
          />
        ) : (
          <ul aria-live="polite" className="border-t border-border">
            {events.map((event) => (
              <ActivityRow
                key={event.interaction_id}
                event={event}
                isNew={arrived.has(event.interaction_id)}
                now={now}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
