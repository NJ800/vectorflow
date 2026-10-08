"use client";

import type { ActivityEvent, EventType } from "@/lib/api";
import { absoluteTime, relativeTime } from "@/lib/format";

/**
 * apply and save are the strongest signals in the pipeline (alpha 0.08 in
 * the consumer, versus 0.03 and 0.01), so they are the only ones that get
 * accent -- view and click both read as muted, undifferentiated from each
 * other.
 */
const TONE: Record<EventType, string> = {
  apply: "text-accent-text",
  save: "text-accent-text",
  click: "text-muted",
  view: "text-muted",
};

export function ActivityRow({
  event,
  isNew,
  now,
}: {
  event: ActivityEvent;
  isNew: boolean;
  now: number;
}) {
  return (
    <li
      className={`flex items-baseline gap-3 border-b border-border/60 px-3 py-2.5 ${
        isNew ? "vf-arrive" : ""
      }`}
    >
      <span
        className={`w-12 shrink-0 text-xs ${TONE[event.event_type]}`}
        title={`event type: ${event.event_type}`}
      >
        {event.event_type}
      </span>
      <span
        className="w-16 shrink-0 font-display text-xs tabular-nums text-muted"
        title={absoluteTime(event.event_ts)}
      >
        {relativeTime(event.event_ts, now)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">
          {event.job_title}
        </span>
        <span className="block truncate text-xs text-muted">
          {event.job_company} · user{" "}
          <span className="font-display tabular-nums">{event.user_id}</span>
          {event.user_title ? ` · ${event.user_title}` : ""}
        </span>
      </span>
      <span className="hidden shrink-0 font-display text-[11px] tabular-nums text-muted/70 sm:block">
        {event.interaction_id}
      </span>
    </li>
  );
}
