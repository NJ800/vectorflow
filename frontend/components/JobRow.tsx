"use client";

import useSWR from "swr";
import { getJobDetail, type JobSummary } from "@/lib/api";
import { formatDate, formatSalary } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { ActionGroup } from "./ActionGroup";
import { ErrorNotice, LoadingNotice } from "./StateNotice";

export function JobRow({
  job,
  expanded,
  onToggle,
}: {
  job: JobSummary;
  expanded: boolean;
  onToggle: (jobId: number) => void;
}) {
  const panelId = `job-panel-${job.job_id}`;
  const salary = formatSalary(job);

  return (
    <li className="border-b border-border">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onToggle(job.job_id)}
          className={`flex w-full items-baseline gap-3 border-l-2 px-3 py-2.5 text-left transition-colors duration-150 ${
            expanded
              ? "border-brand bg-surface-hover"
              : "border-transparent hover:border-brand/60 hover:bg-surface-hover"
          }`}
        >
          <span
            aria-hidden
            className={`w-3 shrink-0 font-display text-xs text-muted transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          >
            ›
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink" title={job.title}>
              {job.title}
            </span>
            <span className="block truncate text-xs text-muted">
              {job.company}
              {job.location ? ` · ${job.location}` : ""}
              {job.seniority_level ? ` · ${job.seniority_level}` : ""}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-display text-sm tabular-nums text-ink">
              {salary ?? <span className="text-muted/50">—</span>}
            </span>
            <span className="block font-display text-[11px] tabular-nums text-muted">
              {formatDate(job.posted_at)}
            </span>
          </span>
        </button>
      </h3>

      {expanded ? (
        <div id={panelId} className="border-t border-border bg-surface px-3 py-4 md:px-5">
          <JobDetailBody jobId={job.job_id} />
          <SeekerActions jobId={job.job_id} />
        </div>
      ) : null}
    </li>
  );
}

function JobDetailBody({ jobId }: { jobId: number }) {
  const { data, error, isLoading, mutate } = useSWR(["job", jobId], ([, id]) =>
    getJobDetail(id as number)
  );

  if (isLoading) return <LoadingNotice label="Loading job detail" />;
  if (error) {
    return (
      <ErrorNotice
        label={`Could not load job ${jobId}`}
        error={error}
        onRetry={() => mutate()}
      />
    );
  }
  if (!data) return null;

  const description = data.description?.trim();

  return (
    <div>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
        <Fact label="job id" value={String(data.job_id)} mono />
        <Fact label="seniority" value={data.seniority_level ?? "not set"} />
        <Fact label="salary" value={formatSalary(data) ?? "not published"} />
        <Fact label="posted" value={formatDate(data.posted_at)} />
      </dl>

      <div className="mt-4">
        <p className="text-[11px] text-muted">description</p>
        {description ? (
          <p className="mt-1 max-h-48 overflow-y-auto pr-2 text-sm leading-relaxed whitespace-pre-line text-ink/90">
            {description}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            This job has no description stored.
          </p>
        )}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] leading-none text-muted">{label}</dt>
      <dd
        className={`mt-1 text-sm tabular-nums text-ink ${
          mono ? "font-mono text-xs" : "font-display"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Only a job_seeker gets these -- a recruiter or admin browsing this same
 * list has no "self" to act as, so per spec they see nothing here, not a
 * disabled button group. Rendered, not merely disabled: the check is `role
 * !== "job_seeker" -> return null`, not a `disabled` prop.
 */
function SeekerActions({ jobId }: { jobId: number }) {
  const { account } = useAuth();
  if (account?.role !== "job_seeker") return null;

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-[11px] tracking-wide text-muted uppercase">
        publish to <span className="font-mono text-ink/80 normal-case">interaction-events</span> as{" "}
        <span className="font-display tabular-nums text-ink">user {account.linked_user_id}</span>
      </p>
      <div className="mt-2.5">
        <ActionGroup jobId={jobId} />
      </div>
    </div>
  );
}
