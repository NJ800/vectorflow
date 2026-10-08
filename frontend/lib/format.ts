import type { JobSummary } from "./api";

/**
 * The backend stores `TIMESTAMP` (no zone) and writes UTC via
 * `datetime.utcnow()`, so FastAPI serialises e.g. "2026-09-05T16:43:15.482288".
 * Passing that straight to `new Date()` makes the browser read it as *local*
 * time, which throws relative timestamps off by the viewer's UTC offset.
 */
export function parseServerTimestamp(value: string): Date {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

export function relativeTime(value: string, now: number = Date.now()): string {
  const seconds = Math.max(
    0,
    Math.round((now - parseServerTimestamp(value).getTime()) / 1000)
  );
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function absoluteTime(value: string): string {
  return parseServerTimestamp(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return parseServerTimestamp(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const counts = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return counts.format(value);
}

function money(value: number): string {
  return value >= 1000
    ? `$${Math.round(value / 1000)}k`
    : `$${Math.round(value)}`;
}

/**
 * The dataset mixes hourly and annual figures and the API does not say which,
 * so the period is deliberately not labelled.
 */
export function formatSalary(job: Pick<JobSummary, "salary_min" | "salary_max">) {
  const { salary_min: min, salary_max: max } = job;
  if (min != null && max != null) {
    return min === max ? money(min) : `${money(min)}–${money(max)}`;
  }
  if (min != null) return `${money(min)}+`;
  if (max != null) return `up to ${money(max)}`;
  return null;
}

export function formatExperience(years: number | null): string | null {
  if (years == null) return null;
  return `${years.toFixed(1)} yrs`;
}
