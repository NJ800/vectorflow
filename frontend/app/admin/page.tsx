"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ApiError,
  deleteJob,
  getAdminAccounts,
  getAdminStats,
  getJobs,
  type Account,
  type AdminStats,
  type JobSummary,
  type Role,
} from "@/lib/api";
import { formatCount, formatDate, formatSalary, relativeTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { TextField } from "@/components/Controls";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "@/components/StateNotice";
import { RecommendationPanel } from "@/components/recommendations/RecommendationPanel";

// Role emphasis is done with weight/case, never color drawn from the
// brass token -- brass is reserved for live/active signals elsewhere in
// this app, and using it for "this row happens to be an admin" would blur
// that meaning into a generic decorative accent.
const ROLE_STYLE: Record<Role, string> = {
  job_seeker: "text-muted",
  recruiter: "text-brand",
  admin: "text-ink font-medium",
};

export default function AdminPage() {
  const { token } = useAuth();

  const stats = useSWR(token ? ["admin-stats", token] : null, ([, t]) => getAdminStats(t as string));
  const accounts = useSWR(token ? ["admin-accounts", token] : null, ([, t]) => getAdminAccounts(t as string));

  return (
    <div className="flex flex-col gap-10">
      <StatsGrid data={stats.data} error={stats.error} isLoading={stats.isLoading} onRetry={() => stats.mutate()} />

      <section>
        <h2 className="font-display text-lg text-ink">Postings per recruiter</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left">
            <thead>
              <tr className="border-y border-border text-[11px] text-muted">
                <th scope="col" className="py-2 pr-4 font-normal">account</th>
                <th scope="col" className="py-2 pr-4 font-normal">email</th>
                <th scope="col" className="py-2 text-right font-normal">postings</th>
              </tr>
            </thead>
            <tbody>
              {(stats.data?.jobs_per_recruiter ?? []).map((r) => (
                <tr key={r.account_id} className="border-b border-border/60">
                  <td className="py-2 pr-4 font-display text-xs tabular-nums text-muted">{r.account_id}</td>
                  <td className="py-2 pr-4 text-sm text-ink">{r.email}</td>
                  <td className="py-2 text-right font-display text-base tabular-nums text-ink">
                    {r.job_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg text-ink">Accounts</h2>
          <span className="font-display text-sm tabular-nums text-muted">
            {accounts.data ? formatCount(accounts.data.accounts.length) : "—"}
          </span>
        </div>
        <div className="mt-3">
          {accounts.isLoading ? (
            <LoadingNotice label="Loading accounts" />
          ) : accounts.error ? (
            <ErrorNotice label="Could not load accounts" error={accounts.error} onRetry={() => accounts.mutate()} />
          ) : (
            <AccountsTable accounts={accounts.data?.accounts ?? []} />
          )}
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink">Inspect a job seeker&rsquo;s recommendations</h2>
        <p className="mt-1 text-xs text-muted">
          Debugging/support tool -- runs the exact same GET /recommendations/&#123;user_id&#125; any job seeker&rsquo;s
          own dashboard uses.
        </p>
        <div className="mt-3">
          <RecommendationInspector />
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink">Moderate postings</h2>
        <p className="mt-1 text-xs text-muted">
          Search any posting, seed data included, and remove it -- admin can delete any job, not only ones it posted
          itself.
        </p>
        <div className="mt-3">
          <ModerationTool />
        </div>
      </section>
    </div>
  );
}

function StatsGrid({
  data,
  error,
  isLoading,
  onRetry,
}: {
  data: AdminStats | undefined;
  error: unknown;
  isLoading: boolean;
  onRetry: () => void;
}) {
  if (isLoading) return <LoadingNotice label="Loading system stats" />;
  if (error) return <ErrorNotice label="Could not load system stats" error={error} onRetry={onRetry} />;
  if (!data) return null;

  return (
    <div>
      <p className="text-[11px] tracking-wide text-muted uppercase">system telemetry</p>
      <div className="mt-3 flex flex-wrap divide-x divide-border border-y border-border">
        <BigStat label="total users" value={formatCount(data.total_users)} />
        <BigStat label="total jobs" value={formatCount(data.total_jobs)} />
        <BigStat label="interactions" value={formatCount(data.total_interactions)} />
        <BigStat label="accounts" value={formatCount(data.total_accounts)} />
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <p className="text-[11px] tracking-wide text-muted uppercase">role distribution</p>
        <dl className="mt-2 flex flex-col gap-1">
          {Object.entries(data.accounts_by_role).map(([role, count]) => (
            <div key={role} className="flex items-baseline gap-3">
              <dt className="w-28 text-xs tracking-wide text-muted uppercase">{role.replace("_", " ")}</dt>
              <dd className="font-display text-lg tabular-nums text-ink">{formatCount(count)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-4 text-xs text-muted">
        last interaction written by the consumer:{" "}
        <span className="font-display text-accent-text">
          {data.latest_interaction_at ? relativeTime(data.latest_interaction_at) : "never"}
        </span>
        {" "}-- if this stops advancing while events are being simulated, the Kafka consumer isn&rsquo;t running.
      </p>
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[140px] px-5 py-4 first:pl-0">
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 font-display text-5xl tabular-nums text-ink">{value}</div>
    </div>
  );
}

function AccountsTable({ accounts }: { accounts: Account[] }) {
  if (accounts.length === 0) {
    return <EmptyNotice title="No accounts found." detail="The accounts table returned zero rows." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-y border-border text-[11px] text-muted">
            <th scope="col" className="py-2 pr-4 font-normal">id</th>
            <th scope="col" className="py-2 pr-4 font-normal">email</th>
            <th scope="col" className="py-2 pr-4 font-normal">role</th>
            <th scope="col" className="py-2 pr-4 font-normal">linked user</th>
            <th scope="col" className="py-2 font-normal">created</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.account_id} className="border-b border-border/60">
              <td className="py-2 pr-4 font-display text-xs tabular-nums text-muted">{a.account_id}</td>
              <td className="py-2 pr-4 text-sm text-ink">{a.email}</td>
              <td className={`py-2 pr-4 text-sm ${ROLE_STYLE[a.role]}`}>{a.role}</td>
              <td className="py-2 pr-4 font-display text-sm tabular-nums text-muted">{a.linked_user_id ?? "—"}</td>
              <td className="py-2 text-xs text-muted">{formatDate(a.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationInspector() {
  const [input, setInput] = useState("");
  const [userId, setUserId] = useState<number | null>(null);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(input);
          setUserId(Number.isFinite(n) && n > 0 ? n : null);
        }}
        className="flex items-end gap-2"
      >
        <TextField label="user_id" value={input} onChange={setInput} placeholder="e.g. 3" className="w-40" />
        <button
          type="submit"
          className="border border-border px-3 py-1.5 text-xs text-ink transition-colors hover:border-muted"
        >
          Inspect
        </button>
      </form>

      {userId !== null ? (
        <div className="mt-4 border-t border-border pt-4">
          <RecommendationPanel userId={userId} />
        </div>
      ) : null}
    </div>
  );
}

function ModerationTool() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ jobId: number; text: string; err: boolean } | null>(null);

  const results = useSWR(
    debounced ? ["moderate-jobs", debounced] : null,
    ([, q]) => getJobs({ search: q as string, page_size: 10 })
  );

  async function handleDelete(job: JobSummary) {
    if (!token) return;
    setPendingId(job.job_id);
    setFeedback(null);
    try {
      await deleteJob(token, job.job_id);
      setFeedback({ jobId: job.job_id, text: `Deleted "${job.title}".`, err: false });
      results.mutate();
    } catch (err) {
      setFeedback({
        jobId: job.job_id,
        text: err instanceof ApiError ? err.message : "Could not delete this posting.",
        err: true,
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <TextField
        label="Search postings"
        value={search}
        onChange={setSearch}
        placeholder="title, company, description..."
        className="max-w-sm"
      />

      {results.isLoading ? <div className="mt-3"><LoadingNotice label="Searching" /></div> : null}
      {results.error ? (
        <div className="mt-3">
          <ErrorNotice label="Search failed" error={results.error} />
        </div>
      ) : null}

      {results.data ? (
        <ul className="mt-3 border-t border-border">
          {results.data.jobs.map((job) => (
            <li key={job.job_id} className="flex items-center gap-3 border-b border-border/60 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{job.title}</span>
                <span className="block truncate text-xs text-muted">
                  {job.company} · {job.location} · job_id {job.job_id}
                  {job.posted_by_account_id == null ? " · seed data" : " · recruiter-posted"}
                </span>
              </span>
              <span className="shrink-0 font-display text-sm tabular-nums text-muted">
                {formatSalary(job) ?? "—"}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(job)}
                disabled={pendingId === job.job_id}
                className="shrink-0 rounded-sm border border-border px-2.5 py-1 text-xs tracking-wide text-muted uppercase transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
              >
                {pendingId === job.job_id ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
          {results.data.jobs.length === 0 ? (
            <p className="py-4 text-sm text-muted">No postings match &ldquo;{debounced}&rdquo;.</p>
          ) : null}
        </ul>
      ) : null}

      {feedback ? (
        <p className={`mt-3 border-l-2 py-1 pl-3 text-xs ${feedback.err ? "border-danger" : "border-success"} text-ink`}>
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
