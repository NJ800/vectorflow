"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { ApiError, getJobs } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { homeForRole, useAuth } from "@/lib/auth";

/**
 * Centered, single column, no card shadow or gradient -- an access panel,
 * not a marketing page. The one real stat below the form (total postings
 * indexed) comes from GET /jobs?page_size=1 -- the same count the Jobs page
 * itself shows -- not a fabricated counter.
 */
export default function LoginPage() {
  const { status, account, login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jobsCount = useSWR("login-jobs-count", () => getJobs({ page_size: 1 }));

  useEffect(() => {
    if (status === "authenticated" && account) {
      router.replace(homeForRole(account.role));
    }
  }, [status, account, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const acc = await login(email, password);
      router.replace(homeForRole(acc.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
      setSubmitting(false);
    }
  }

  if (status === "loading" || status === "authenticated") {
    return <div className="min-h-screen bg-bg" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="font-display text-4xl leading-none text-ink">VectorFlow</div>
        <p className="mt-2 text-sm text-muted">Control access</p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
          Personalized job recommendations that update live as you interact --
          backed by real retrieval, ranking, and a Kafka feedback loop, not a
          static list.
        </p>

        {jobsCount.data ? (
          <p className="mt-4 font-display text-lg tabular-nums text-brand">
            {formatCount(jobsCount.data.total)}
            <span className="ml-1.5 font-body text-sm text-muted">postings indexed</span>
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-8 border-t border-border pt-6">
          <label htmlFor="email" className="block text-sm text-muted">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/60 transition-colors hover:border-muted focus:border-brand"
            placeholder="you@vectorflow.dev"
          />

          <label htmlFor="password" className="mt-4 block text-sm text-muted">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/60 transition-colors hover:border-muted focus:border-brand"
            placeholder="••••••••"
          />

          {error ? (
            <p role="alert" className="mt-4 border-l-2 border-danger py-1 pl-3 text-sm text-ink">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-sm bg-brand py-2.5 text-sm font-medium text-surface transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-6 text-sm text-muted">
          New here?{" "}
          <Link href="/signup" className="text-brand hover:text-brand-hover">
            Create an account
          </Link>
        </div>

        <div className="mt-8 border-t border-border pt-4 text-xs leading-relaxed text-muted/80">
          <p>Seeded test accounts</p>
          <p className="mt-1">
            job seeker <span className="font-mono">user1..user20@vectorflow.dev</span> /{" "}
            <span className="font-mono">JobSeekerPass123!</span>
          </p>
          <p className="mt-0.5">
            recruiter <span className="font-mono">recruiter1..recruiter4@vectorflow.dev</span> /{" "}
            <span className="font-mono">RecruiterPass123!</span>
          </p>
          <p className="mt-0.5">
            admin <span className="font-mono">admin@vectorflow.dev</span> /{" "}
            <span className="font-mono">AdminPass123!</span>
          </p>
        </div>
      </div>
    </div>
  );
}
