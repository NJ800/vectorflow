"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, type Role } from "@/lib/api";
import { homeForRole, useAuth } from "@/lib/auth";

type SignupRole = Extract<Role, "job_seeker" | "recruiter">;

/**
 * Real signup, not a role picker over fake data: a job_seeker submission
 * here creates a brand-new row in `users` and gets a real Gemini embedding
 * computed server-side before this page redirects anywhere, so the
 * dashboard it lands on has genuine recommendations from the first paint.
 * No company-name field on the recruiter side -- the accounts table has
 * nowhere to persist one yet, and collecting it just to silently discard it
 * would be its own kind of fake data.
 */
export default function SignupPage() {
  const { status, account, signup } = useAuth();
  const router = useRouter();

  const [role, setRole] = useState<SignupRole>("job_seeker");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [location, setLocation] = useState("");
  const [experience, setExperience] = useState("");
  const [skills, setSkills] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated" && account) {
      router.replace(homeForRole(account.role));
    }
  }, [status, account, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    let acc;
    setSubmitting(true);
    try {
      if (role === "recruiter") {
        acc = await signup({ email, password, role: "recruiter" });
      } else {
        const skillList = skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!currentTitle.trim() || !location.trim() || !experience || skillList.length === 0) {
          setError("Title, location, years of experience, and at least one skill are required.");
          setSubmitting(false);
          return;
        }
        acc = await signup({
          email,
          password,
          role: "job_seeker",
          current_title: currentTitle.trim(),
          location: location.trim(),
          total_experience_years: Number(experience),
          skills: skillList,
        });
      }
      router.replace(homeForRole(acc.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create an account.");
      setSubmitting(false);
    }
  }

  if (status === "loading" || status === "authenticated") {
    return <div className="min-h-screen bg-bg" />;
  }

  const FIELD =
    "mt-1.5 w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/60 transition-colors hover:border-muted focus:border-brand";
  const LABEL = "mt-4 block text-sm text-muted";

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="font-display text-4xl leading-none text-ink">VectorFlow</div>
        <p className="mt-2 text-sm text-muted">Create an account</p>

        <div className="mt-8 flex gap-6 border-b border-border">
          {(["job_seeker", "recruiter"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={`-mb-px border-b-2 pb-2 text-sm transition-colors ${
                role === r ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {r === "job_seeker" ? "Job seeker" : "Recruiter"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-2">
          <label htmlFor="email" className={LABEL}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD}
            placeholder="you@vectorflow.dev"
          />

          <label htmlFor="password" className={LABEL}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD}
            placeholder="at least 8 characters"
          />

          {role === "job_seeker" ? (
            <>
              <label htmlFor="title" className={LABEL}>
                Current title
              </label>
              <input
                id="title"
                type="text"
                required
                value={currentTitle}
                onChange={(e) => setCurrentTitle(e.target.value)}
                className={FIELD}
                placeholder="e.g. Senior Backend Engineer"
              />

              <label htmlFor="location" className={LABEL}>
                Location
              </label>
              <input
                id="location"
                type="text"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={FIELD}
                placeholder="e.g. Austin, TX"
              />

              <label htmlFor="experience" className={LABEL}>
                Years of experience
              </label>
              <input
                id="experience"
                type="number"
                min={0}
                max={60}
                step={0.5}
                required
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                className={FIELD}
                placeholder="e.g. 6.5"
              />

              <label htmlFor="skills" className={LABEL}>
                Skills
              </label>
              <input
                id="skills"
                type="text"
                required
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                className={FIELD}
                placeholder="comma-separated, e.g. Python, AWS, Docker"
              />
            </>
          ) : null}

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
            {submitting ? (role === "job_seeker" ? "Building embeddings…" : "Creating account…") : "Create account"}
          </button>

          {submitting && role === "job_seeker" ? (
            <p className="mt-2 text-xs text-muted">Creating profile… building embeddings…</p>
          ) : null}
        </form>

        <div className="mt-6 text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-brand hover:text-brand-hover">
            Sign in instead
          </Link>
        </div>
      </div>
    </div>
  );
}
