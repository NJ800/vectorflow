"use client";

import useSWR from "swr";
import { getUserDetail } from "@/lib/api";
import { formatExperience } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { RecommendationPanel } from "@/components/recommendations/RecommendationPanel";
import { ErrorNotice, LoadingNotice } from "@/components/StateNotice";

/**
 * One continuous instrument panel, not a page of independent cards: a fixed
 * 280px profile column and the recommendation table share the same border,
 * divided by a single vertical hairline.
 */
export default function SeekerDashboardPage() {
  const { account } = useAuth();
  const userId = account?.linked_user_id ?? null;

  const detail = useSWR(userId === null ? null : ["user", userId], ([, id]) => getUserDetail(id as number));

  if (userId === null) {
    return (
      <ErrorNotice
        label="This account has no linked job-seeker profile"
        error={new Error("linked_user_id is missing from the session")}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 border border-border md:grid-cols-[280px_minmax(0,1fr)]">
      <div className="border-b border-border p-5 md:border-r md:border-b-0">
        <p className="text-[11px] tracking-wide text-muted uppercase">Profile</p>
        <div className="mt-3 border-t border-border pt-3">
          {detail.isLoading ? (
            <LoadingNotice label="Loading profile" />
          ) : detail.error ? (
            <ErrorNotice label="Could not load your profile" error={detail.error} onRetry={() => detail.mutate()} />
          ) : (
            <>
              <p className="font-display text-xl leading-tight text-ink">
                user {userId}
              </p>
              <p className="mt-1 text-xs tracking-wide text-muted uppercase">
                {detail.data?.current_title ?? "title not set"}
              </p>
              <p className="mt-3 text-sm text-ink">{detail.data?.location ?? "—"}</p>

              <div className="mt-5 border-t border-border pt-3">
                <p className="text-[11px] tracking-wide text-muted uppercase">Experience</p>
                <p className="mt-1 font-display text-lg tabular-nums text-ink">
                  {formatExperience(detail.data?.total_experience_years ?? null) ?? "—"}
                </p>
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <p className="text-[11px] tracking-wide text-muted uppercase">Current title</p>
                <p className="mt-1 text-sm text-ink">{detail.data?.current_title ?? "not set"}</p>
              </div>

              {detail.data?.skills && detail.data.skills.length > 0 ? (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-[11px] tracking-wide text-muted uppercase">Skills</p>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {detail.data.skills.map((skill) => (
                      <li key={skill} className="text-sm text-ink">
                        {skill}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-5 border-t border-border pt-3">
                <p className="text-[11px] tracking-wide text-muted uppercase">Profile vector</p>
                <p className="mt-1 text-sm text-success">Ready</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="p-5">
        <p className="text-[11px] tracking-wide text-muted uppercase">Recommendations</p>
        <div className="mt-3">
          <RecommendationPanel userId={userId} interactive />
        </div>
      </div>
    </div>
  );
}
