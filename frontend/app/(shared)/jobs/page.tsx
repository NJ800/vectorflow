"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { getJobs, type JobSort } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { SelectField, TextField } from "@/components/Controls";
import { JobRow } from "@/components/JobRow";
import { Readout, ReadoutStrip } from "@/components/Readout";
import {
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
} from "@/components/StateNotice";

const PAGE_SIZE = 20;
/** One real sample used to discover which seniority values exist in the data. */
const FACET_SAMPLE_SIZE = 500;

const SORT_OPTIONS: { value: JobSort; label: string }[] = [
  { value: "recent", label: "Most recent" },
  { value: "salary_high", label: "Salary, high first" },
  { value: "salary_low", label: "Salary, low first" },
];

export default function JobsPage() {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [seniority, setSeniority] = useState("");
  const [sort, setSort] = useState<JobSort>("recent");
  const [page, setPage] = useState(1);
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedLocation = useDebouncedValue(location, 300);

  const query = {
    search: debouncedSearch || undefined,
    location: debouncedLocation || undefined,
    seniority: seniority || undefined,
    sort,
    page,
    page_size: PAGE_SIZE,
  };

  const jobs = useSWR(
    ["jobs", debouncedSearch, debouncedLocation, seniority, sort, page, PAGE_SIZE],
    () => getJobs(query)
  );

  // The API exposes no facet endpoint, so the seniority options are derived
  // from a real sample of rows rather than a hardcoded list.
  const facets = useSWR(["job-facets", FACET_SAMPLE_SIZE], () =>
    getJobs({ page_size: FACET_SAMPLE_SIZE, sort: "recent" })
  );

  const seniorityOptions = useMemo(() => {
    const values = new Set<string>();
    for (const job of facets.data?.jobs ?? []) {
      if (job.seniority_level) values.add(job.seniority_level);
    }
    for (const job of jobs.data?.jobs ?? []) {
      if (job.seniority_level) values.add(job.seniority_level);
    }
    if (seniority) values.add(seniority);
    return [...values]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [facets.data, jobs.data, seniority]);

  const results = jobs.data?.jobs ?? [];
  const total = jobs.data?.total ?? 0;
  const totalPages = jobs.data
    ? Math.max(1, Math.ceil(jobs.data.total / jobs.data.page_size))
    : 1;
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  function resetToFirstPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
      setExpandedJobId(null);
    };
  }

  return (
    <div>
      <div>
        <h1 className="font-display text-xl leading-none text-ink">Jobs</h1>
        <p className="mt-1.5 text-xs text-muted">
          Every simulate button below acts as you -- there is nothing to pick.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Search title, company, description"
          value={search}
          onChange={resetToFirstPage(setSearch)}
          placeholder="e.g. registered nurse"
        />
        <TextField
          label="Location contains"
          value={location}
          onChange={resetToFirstPage(setLocation)}
          placeholder="e.g. TX"
        />
        <SelectField
          label="Seniority"
          value={seniority}
          onChange={resetToFirstPage(setSeniority)}
          placeholder="Any"
          options={seniorityOptions}
        />
        <SelectField
          label="Sort"
          value={sort}
          onChange={resetToFirstPage((value: string) => setSort(value as JobSort))}
          options={SORT_OPTIONS}
        />
      </div>

      <div className="mt-4">
        <ReadoutStrip>
          <Readout label="matching postings" value={jobs.data ? formatCount(total) : "—"} />
          <Readout label="page" value={jobs.data ? `${page} / ${formatCount(totalPages)}` : "—"} />
          <Readout label="showing" value={jobs.data ? `${firstRow}–${lastRow}` : "—"} />
        </ReadoutStrip>
      </div>

      <div className="mt-4">
        {jobs.isLoading ? (
          <LoadingNotice label="Loading postings" />
        ) : jobs.error ? (
          <ErrorNotice label="Could not load jobs" error={jobs.error} onRetry={() => jobs.mutate()} />
        ) : results.length === 0 ? (
          <EmptyNotice
            title="No postings matched these filters."
            detail="The jobs query returned zero rows. Try widening the search, location, or seniority filter."
          />
        ) : (
          <ul className="border-t border-border">
            {results.map((job) => (
              <JobRow
                key={job.job_id}
                job={job}
                expanded={expandedJobId === job.job_id}
                onToggle={(jobId) =>
                  setExpandedJobId((current) => (current === jobId ? null : jobId))
                }
              />
            ))}
          </ul>
        )}
      </div>

      {jobs.data && totalPages > 1 ? (
        <nav aria-label="Pagination" className="mt-5 flex items-center justify-between gap-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              setPage((current) => Math.max(1, current - 1));
              setExpandedJobId(null);
            }}
            className="rounded-sm border border-border px-3 py-1.5 text-xs tracking-wide text-ink uppercase transition-colors hover:border-muted disabled:cursor-not-allowed disabled:border-border/60 disabled:text-muted/50"
          >
            Previous
          </button>
          <span className="font-display text-xs tabular-nums text-muted">
            page {page} of {formatCount(totalPages)}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((current) => Math.min(totalPages, current + 1));
              setExpandedJobId(null);
            }}
            className="rounded-sm border border-border px-3 py-1.5 text-xs tracking-wide text-ink uppercase transition-colors hover:border-muted disabled:cursor-not-allowed disabled:border-border/60 disabled:text-muted/50"
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}
