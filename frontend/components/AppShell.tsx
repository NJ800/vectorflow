"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { getHealth } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/api";

interface NavItem {
  label: string;
  href: string;
}

/**
 * One nav item per role stands in for that role's own home (job_seeker's
 * dashboard, recruiter's job console, admin's telemetry panel) rather than a
 * separate hollow "Overview" page duplicating it -- a recruiter's whole
 * product surface already is /manage, so a second nav entry pointing at the
 * same content would be decoration, not information.
 */
const NAV: Record<Role, NavItem[]> = {
  job_seeker: [
    { label: "Overview", href: "/" },
    { label: "Jobs", href: "/jobs" },
    { label: "Activity", href: "/activity" },
  ],
  recruiter: [
    { label: "Manage", href: "/manage" },
    { label: "Jobs", href: "/jobs" },
    { label: "Activity", href: "/activity" },
  ],
  admin: [
    { label: "Admin", href: "/admin" },
    { label: "Jobs", href: "/jobs" },
    { label: "Activity", href: "/activity" },
    { label: "Manage", href: "/manage" },
  ],
};

/**
 * One shell for every role -- the three roles land on genuinely different
 * content (a feed, a posting console, a telemetry panel), but the chrome
 * around them is a single solid-brand top bar, not three reskins of the
 * same header and not a left rail. A utility bar, not a marketing nav: slim,
 * wordmark left, sections center, account far right.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { account, logout } = useAuth();
  const pathname = usePathname();

  if (!account) return null;
  const nav = NAV[account.role];

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex h-14 items-center gap-x-8 bg-brand px-4 md:px-8">
        <Link href={nav[0].href} className="whitespace-nowrap font-display text-lg font-semibold text-surface">
          VectorFlow
        </Link>

        <nav aria-label="Sections" className="hidden gap-6 md:flex">
          {nav.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`border-b-2 py-0.5 text-sm transition-colors ${
                  active ? "border-surface text-surface" : "border-transparent text-surface/70 hover:text-surface"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-5 text-[13px] whitespace-nowrap text-surface/80">
          <SystemTelemetry />
          <span className="hidden lg:inline">
            <span className="text-surface">{account.email}</span>
            <span> · {account.role.replace("_", " ")}</span>
          </span>
          <button
            type="button"
            onClick={logout}
            className="rounded-sm border border-surface/40 px-2.5 py-1 text-surface transition-colors hover:bg-brand-hover"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Nav collapses to a second row on narrow viewports rather than a
          hamburger drawer -- one more shell shape, not two. */}
      <nav aria-label="Sections" className="flex gap-5 overflow-x-auto border-b border-border bg-surface px-4 py-2 md:hidden">
        {nav.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 border-b-2 pb-1 text-sm ${
                active ? "border-brand text-ink" : "border-transparent text-muted"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}

/**
 * The header's own live-status readout: a real round-trip to /health,
 * timed client-side. Sits on the brand bar, so its resting state uses the
 * same light-on-brand text as the rest of the header; only the failure
 * state switches to a colour (a pale danger tint that still reads against
 * the dark brand background), and the pulse is the one animation this
 * shell allows (see globals.css).
 */
function SystemTelemetry() {
  const startRef = useRef<number>(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const { error } = useSWR(
    "shell-health",
    async () => {
      startRef.current = performance.now();
      const result = await getHealth();
      setLatencyMs(Math.round(performance.now() - startRef.current));
      return result;
    },
    { refreshInterval: 15_000, shouldRetryOnError: true, errorRetryInterval: 10_000 }
  );

  const online = !error && latencyMs !== null;

  return (
    <span className="flex items-center gap-3">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`inline-block size-1.5 rounded-full ${online ? "vf-live-dot bg-accent" : "bg-danger"}`}
        />
        <span className={online ? "" : "text-danger"}>{online ? "Live" : "Unreachable"}</span>
      </span>
      <span className="hidden sm:inline">
        {online ? (
          <>
            API <span className="font-display tabular-nums text-surface">{latencyMs}</span>ms
          </>
        ) : (
          "API offline"
        )}
      </span>
    </span>
  );
}
