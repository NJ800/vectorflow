"use client";

import { useState } from "react";
import { ApiError, EVENT_TYPES, simulateInteraction, type EventType } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * VIEW / CLICK / APPLY / SAVE, shared by the Jobs page and the Dashboard's
 * recommendation table. Always publishes as the caller's own
 * linked_user_id -- the backend forces this for a job_seeker token
 * regardless of what's sent, so there is nothing to pick here.
 *
 * Rendering this at all is the caller's decision, not this component's: a
 * recruiter/admin should see no action buttons, not disabled ones (see the
 * role checks at each call site), so this component doesn't check role
 * itself -- it has no way to know "should I exist here" versus "should I be
 * disabled," and baking a role check in here would just move the same
 * mistake one level down.
 */
export function ActionGroup({ jobId }: { jobId: number }) {
  const { token } = useAuth();
  const [pending, setPending] = useState<EventType | null>(null);
  const [status, setStatus] = useState<{ kind: "queued" | "published" | "error"; text: string } | null>(null);

  async function publish(eventType: EventType) {
    if (!token) return;
    setPending(eventType);
    setStatus({ kind: "queued", text: "EVENT QUEUED" });
    try {
      await simulateInteraction(token, jobId, eventType);
      setStatus({ kind: "published", text: "KAFKA EVENT PUBLISHED" });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof ApiError ? err.message.toUpperCase() : "PUBLISH FAILED" });
    } finally {
      setPending(null);
      window.setTimeout(() => setStatus(null), 2800);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-1">
        {EVENT_TYPES.map((eventType) => (
          <button
            key={eventType}
            type="button"
            disabled={pending !== null}
            onClick={() => publish(eventType)}
            title={`Publish a "${eventType}" interaction for this job`}
            className="rounded-sm border border-border px-2 py-1 text-[11px] tracking-wide text-ink uppercase transition-colors hover:border-muted disabled:cursor-not-allowed disabled:border-border/60 disabled:text-muted/60"
          >
            {eventType}
          </button>
        ))}
      </div>
      {status ? (
        <span
          className={`text-[11px] tracking-wide uppercase ${
            status.kind === "published" ? "text-success" : status.kind === "error" ? "text-danger" : "text-muted"
          }`}
        >
          {status.text}
        </span>
      ) : null}
    </div>
  );
}
