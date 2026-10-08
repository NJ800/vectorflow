import { ApiError } from "@/lib/api";

/**
 * Every data-dependent view in this app renders exactly one of loading /
 * empty / error, and they should look identical wherever they appear. Text
 * states, not skeleton cards or centered illustrations -- this is an
 * instrument panel, and an instrument panel reports its own state in words.
 */

export function LoadingNotice({ label }: { label: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 py-6 text-sm tracking-wide text-muted uppercase"
    >
      <span
        aria-hidden
        className="vf-live-dot inline-block size-1.5 rounded-full bg-muted"
      />
      {label}…
    </p>
  );
}

export function EmptyNotice({
  title,
  detail,
  status = "waiting",
}: {
  title: string;
  detail?: string;
  status?: string;
}) {
  return (
    <div className="border-t border-border py-8">
      <p className="text-sm tracking-wide text-ink uppercase">{title}</p>
      {detail ? <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{detail}</p> : null}
      <p className="mt-3 text-[11px] tracking-wide text-muted uppercase">
        status: <span className="text-ink">{status}</span>
      </p>
    </div>
  );
}

/** Shows what actually failed, including the backend's own message. Coral,
 *  not brass -- brass is reserved for live/active/score signals, and an
 *  error is the one thing in this app's palette that must never be
 *  confused with "things are going well." */
export function ErrorNotice({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const status = error instanceof ApiError ? error.status : undefined;
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  return (
    <div
      role="alert"
      className="border-t-2 border-danger bg-surface px-4 py-4 text-sm"
    >
      <p className="text-sm tracking-wide text-ink uppercase">
        {label}
        {status ? (
          <span className="ml-2 font-display tabular-nums text-danger normal-case">
            HTTP {status}
          </span>
        ) : null}
      </p>
      <p className="mt-1.5 font-mono text-xs leading-relaxed break-words text-muted normal-case">
        {message}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-sm border border-danger px-2.5 py-1 text-xs tracking-wide text-danger uppercase transition-colors hover:bg-danger/10"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
