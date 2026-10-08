"use client";

import useSWR from "swr";
import { getRecommendations, type RecommendationResult } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Readout, ReadoutStrip } from "@/components/Readout";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "@/components/StateNotice";
import { ScoreDisplay, scoreEmphasis } from "@/components/ScoreDisplay";
import { ActionGroup } from "@/components/ActionGroup";

const TOP_K = 10;

/**
 * The ranked-jobs table plus its source/latency readout strip, for a single
 * user_id. Used by the job seeker's own dashboard and, read-only, by the
 * admin panel's "inspect any job seeker's recommendations" tool -- same real
 * endpoint, same data, just a different caller.
 *
 * `interactive` turns on inline view/click/apply/save buttons per row. Only
 * the job seeker's own dashboard passes it; the component still re-checks
 * the caller's own role before rendering them (see RecommendationTable
 * below), since a recruiter/admin has no "self" to act as and per-spec
 * these buttons must not render for them at all, not just be disabled.
 */
export function RecommendationPanel({
  userId,
  interactive = false,
}: {
  userId: number;
  interactive?: boolean;
}) {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    ["recommendations", userId, TOP_K],
    ([, id]) => getRecommendations(id as number, TOP_K)
  );

  const results = data?.results ?? [];

  return (
    <div>
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => mutate()}
          disabled={isValidating}
          className="rounded-sm border border-border px-2.5 py-1.5 text-xs tracking-wide text-ink uppercase transition-colors hover:border-muted disabled:text-muted"
        >
          {isValidating ? "Requesting…" : "Re-request"}
        </button>
      </div>

      <div className="mt-3">
        <ReadoutStrip>
          <Readout
            label="source"
            value={data ? data.source : "—"}
            tone={data?.source === "live" ? "live" : "ink"}
            title={
              data?.source === "cache"
                ? "Served from the Redis entry for this user"
                : "Computed by pgvector retrieval + XGBoost re-rank"
            }
          />
          <Readout label="latency" value={data ? data.latency_ms.toFixed(1) : "—"} unit="ms" />
          <Readout label="returned" value={data ? String(results.length) : "—"} />
          <Readout
            label="top score"
            value={results.length ? results[0].score.toFixed(4) : "—"}
            tone="brand"
          />
        </ReadoutStrip>
      </div>

      <div className="mt-5 min-h-0">
        {isLoading ? (
          <LoadingNotice label={`Loading recommendations for user ${userId}`} />
        ) : error ? (
          <ErrorNotice
            label={`Request failed -- could not retrieve recommendations for user ${userId}`}
            error={error}
            onRetry={() => mutate()}
          />
        ) : results.length === 0 ? (
          <EmptyNotice
            title="No recommendations"
            detail="The recommendation engine returned an empty result set for this profile."
            status="waiting"
          />
        ) : (
          <RecommendationTable results={results} interactive={interactive} />
        )}
      </div>
    </div>
  );
}

export function RecommendationTable({
  results,
  interactive = false,
}: {
  results: RecommendationResult[];
  interactive?: boolean;
}) {
  const { account } = useAuth();
  const scores = results.map((r) => r.score);
  const showActions = interactive && account?.role === "job_seeker";

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">
          Ranked job recommendations with model score and cosine similarity
        </caption>
        <thead>
          <tr className="border-y border-border text-[11px] tracking-wide text-muted uppercase">
            <th scope="col" className="w-[16%] py-2 pr-3 text-right font-normal">score</th>
            <th scope="col" className={`${showActions ? "w-[36%]" : "w-[52%]"} py-2 pr-3 font-normal`}>
              role / company
            </th>
            <th scope="col" className="hidden w-[20%] py-2 pr-3 font-normal sm:table-cell">location</th>
            {showActions ? (
              <th scope="col" className="w-[28%] py-2 pl-3 font-normal">actions</th>
            ) : (
              <th scope="col" className="hidden w-[12%] py-2 pl-3 font-normal sm:table-cell">posted</th>
            )}
          </tr>
        </thead>
        <tbody>
          {results.map((job, index) => (
            <tr
              key={job.job_id}
              className="border-b border-border/60 align-top transition-colors hover:bg-surface-hover"
            >
              <td className="py-3 pr-3">
                <ScoreDisplay
                  score={job.score}
                  similarity={job.cosine_similarity}
                  emphasis={scoreEmphasis(job.score, index, scores)}
                />
              </td>
              <td className="py-3 pr-3">
                <span className="block truncate text-sm text-ink" title={job.title}>
                  {job.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted" title={job.company}>
                  {job.company}
                </span>
              </td>
              <td className="hidden py-3 pr-3 text-sm text-muted sm:table-cell">
                <span className="block truncate" title={job.location}>{job.location}</span>
              </td>
              {showActions ? (
                <td className="py-3 pl-3">
                  <ActionGroup jobId={job.job_id} />
                </td>
              ) : (
                <td className="hidden py-3 pl-3 sm:table-cell" />
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
