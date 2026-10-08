"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  ApiError,
  createJob,
  deleteJob,
  getJobDetail,
  getJobs,
  updateJob,
  type JobDetail,
  type JobSummary,
} from "@/lib/api";
import { formatCount, formatDate, formatSalary } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Readout, ReadoutStrip } from "@/components/Readout";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "@/components/StateNotice";
import { SelectField, TextField } from "@/components/Controls";

const SENIORITY_OPTIONS = [
  "Internship",
  "Entry level",
  "Associate",
  "Mid-Senior level",
  "Director",
  "Executive",
].map((value) => ({ value, label: value }));

interface FormState {
  title: string;
  company: string;
  location: string;
  description: string;
  seniority_level: string;
  salary_min: string;
  salary_max: string;
}

const BLANK_FORM: FormState = {
  title: "",
  company: "",
  location: "",
  description: "",
  seniority_level: "",
  salary_min: "",
  salary_max: "",
};

function jobToForm(job: JobDetail): FormState {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description ?? "",
    seniority_level: job.seniority_level ?? "",
    salary_min: job.salary_min != null ? String(job.salary_min) : "",
    salary_max: job.salary_max != null ? String(job.salary_max) : "",
  };
}

export default function ManageJobsPage() {
  const { account, token } = useAuth();
  const accountId = account?.account_id ?? null;

  const postings = useSWR(
    accountId === null ? null : ["my-jobs", accountId],
    ([, id]) => getJobs({ posted_by: id as number, sort: "recent", page_size: 200 })
  );

  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  // Which job_id (or null, for the blank create form) `form` currently
  // reflects. Used below to reset/populate `form` during render rather
  // than in an effect -- this is React's own recommended pattern for
  // "adjust state when a prop/selection changes" (see
  // https://react.dev/learn/you-might-not-need-an-effect), and it avoids
  // the extra render + flash of stale data an effect-based reset causes.
  const [formJobId, setFormJobId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const selectedDetail = useSWR(
    selectedJobId === null ? null : ["job", selectedJobId],
    ([, id]) => getJobDetail(id as number)
  );

  if (selectedJobId !== formJobId) {
    if (selectedJobId === null) {
      setForm(BLANK_FORM);
      setFormJobId(null);
    } else if (selectedDetail.data && selectedDetail.data.job_id === selectedJobId) {
      setForm(jobToForm(selectedDetail.data));
      setFormJobId(selectedJobId);
    }
    // else: a job just got selected and its detail hasn't loaded yet --
    // leave `form` as-is for this render; the "Loading posting" notice
    // below covers the gap, and this block re-runs once data.js arrives.
  }

  const jobs = useMemo(() => postings.data?.jobs ?? [], [postings.data]);

  const stats = useMemo(() => {
    if (jobs.length === 0) return { count: 0, highestMax: null as number | null, mostRecent: null as string | null };
    const withMax = jobs.filter((j) => j.salary_max != null).map((j) => j.salary_max as number);
    return {
      count: jobs.length,
      highestMax: withMax.length ? Math.max(...withMax) : null,
      mostRecent: jobs[0]?.posted_at ?? null,
    };
  }, [jobs]);

  function startCreate() {
    setSelectedJobId(null);
    setConfirmingDelete(false);
    setFeedback(null);
  }

  function selectJob(jobId: number) {
    setSelectedJobId(jobId);
    setConfirmingDelete(false);
    setFeedback(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setFeedback(null);

    const payload = {
      title: form.title.trim(),
      company: form.company.trim(),
      location: form.location.trim(),
      description: form.description.trim() || null,
      seniority_level: form.seniority_level || null,
      salary_min: form.salary_min === "" ? null : Number(form.salary_min),
      salary_max: form.salary_max === "" ? null : Number(form.salary_max),
    };

    try {
      if (selectedJobId === null) {
        const created = await createJob(token, payload);
        setFeedback({ kind: "ok", text: `Posted -- job_id ${created.job_id}. It's live in the public jobs list now.` });
        setForm(BLANK_FORM);
        postings.mutate();
      } else {
        await updateJob(token, selectedJobId, payload);
        setFeedback({ kind: "ok", text: "Saved. The change is live in the public jobs list now." });
        postings.mutate();
        selectedDetail.mutate();
      }
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof ApiError ? err.message : "Could not save this posting." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || selectedJobId === null) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await deleteJob(token, selectedJobId);
      postings.mutate();
      setSelectedJobId(null);
      setConfirmingDelete(false);
      setFeedback({ kind: "ok", text: "Deleted." });
    } catch (err) {
      // A job with recorded interactions/embeddings 409s rather than
      // cascading -- that's the backend refusing to silently destroy
      // interaction history, not a bug, so it's surfaced verbatim.
      setFeedback({ kind: "err", text: err instanceof ApiError ? err.message : "Could not delete this posting." });
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-xl leading-none text-ink">Your postings</h1>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-sm border border-border px-3 py-1.5 text-xs tracking-wide text-ink uppercase transition-colors hover:border-muted"
        >
          New posting
        </button>
      </div>

      <div className="mt-4">
        <ReadoutStrip>
          <Readout label="postings" value={postings.data ? formatCount(stats.count) : "—"} />
          <Readout
            label="highest max salary"
            value={stats.highestMax != null ? formatCount(stats.highestMax) : "—"}
          />
          <Readout label="most recent post" value={stats.mostRecent ? formatDate(stats.mostRecent) : "—"} />
        </ReadoutStrip>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          {postings.isLoading ? (
            <LoadingNotice label="Loading your postings" />
          ) : postings.error ? (
            <ErrorNotice label="Could not load your postings" error={postings.error} onRetry={() => postings.mutate()} />
          ) : jobs.length === 0 ? (
            <EmptyNotice
              title="You haven't posted anything yet."
              detail="Use “+ New posting” to create your first listing -- it appears in the public jobs list immediately."
            />
          ) : (
            <ul className="border-t border-border">
              {jobs.map((job) => (
                <PostingRow key={job.job_id} job={job} selected={job.job_id === selectedJobId} onSelect={selectJob} />
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 border-t border-border pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <h2 className="font-display text-base text-ink">
            {selectedJobId === null ? "New posting" : `Editing job ${selectedJobId}`}
          </h2>

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            <TextField label="Title" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
            <TextField label="Company" value={form.company} onChange={(v) => setForm((f) => ({ ...f, company: v }))} />
            <TextField label="Location" value={form.location} onChange={(v) => setForm((f) => ({ ...f, location: v }))} />
            <SelectField
              label="Seniority"
              value={form.seniority_level}
              onChange={(v) => setForm((f) => ({ ...f, seniority_level: v }))}
              placeholder="Not set"
              options={SENIORITY_OPTIONS}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Salary min"
                type="number"
                value={form.salary_min}
                onChange={(v) => setForm((f) => ({ ...f, salary_min: v }))}
              />
              <TextField
                label="Salary max"
                type="number"
                value={form.salary_max}
                onChange={(v) => setForm((f) => ({ ...f, salary_max: v }))}
              />
            </div>
            <div>
              <label htmlFor="description" className="mb-1 block text-[11px] leading-none text-muted">
                Description
              </label>
              <textarea
                id="description"
                rows={6}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full border border-border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted transition-colors hover:border-muted/60 focus:border-muted"
              />
            </div>

            {selectedJobId !== null && selectedDetail.isLoading ? (
              <LoadingNotice label="Loading posting" />
            ) : null}
            {selectedJobId !== null && selectedDetail.error ? (
              <ErrorNotice label="Could not load this posting" error={selectedDetail.error} />
            ) : null}

            <div className="mt-1 flex items-center gap-2">
              <button
                type="submit"
                disabled={saving || !form.title || !form.company || !form.location}
                className="rounded-sm bg-brand px-3 py-1.5 text-xs font-medium text-surface transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                {saving ? "Saving…" : selectedJobId === null ? "Create posting" : "Save changes"}
              </button>

              {selectedJobId !== null ? (
                confirmingDelete ? (
                  <>
                    <span className="text-xs tracking-wide text-muted uppercase">Delete this posting?</span>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded-sm border border-danger px-3 py-1.5 text-xs tracking-wide text-danger uppercase transition-colors hover:bg-danger/10 disabled:opacity-50"
                    >
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      className="px-2 py-1.5 text-xs tracking-wide text-muted uppercase hover:text-ink"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="px-2 py-1.5 text-xs tracking-wide text-muted uppercase transition-colors hover:text-danger"
                  >
                    Delete this posting
                  </button>
                )
              ) : null}
            </div>

            {feedback ? (
              <p
                role={feedback.kind === "err" ? "alert" : "status"}
                className={`border-l-2 py-1 pl-3 text-xs leading-relaxed ${
                  feedback.kind === "err" ? "border-danger text-ink" : "border-success text-muted"
                }`}
              >
                {feedback.text}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}

function PostingRow({
  job,
  selected,
  onSelect,
}: {
  job: JobSummary;
  selected: boolean;
  onSelect: (jobId: number) => void;
}) {
  const salary = formatSalary(job);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(job.job_id)}
        aria-pressed={selected}
        className={`flex w-full items-baseline gap-3 border-b border-border/60 border-l-2 px-3 py-2.5 text-left transition-colors ${
          selected ? "border-l-brand bg-brand/15" : "border-l-transparent hover:bg-brand/10"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{job.title}</span>
          <span className="block truncate text-xs text-muted">
            {job.company} · {job.location}
            {job.seniority_level ? ` · ${job.seniority_level}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-display text-sm tabular-nums text-ink">
            {salary ?? <span className="text-muted/50">—</span>}
          </span>
          <span className="block font-display text-[11px] tabular-nums text-muted">{formatDate(job.posted_at)}</span>
        </span>
      </button>
    </li>
  );
}
