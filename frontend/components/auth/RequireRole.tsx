"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { homeForRole, useAuth } from "@/lib/auth";
import type { Role } from "@/lib/api";

/**
 * Client-side route guard: no session -> /login; wrong role for this
 * route -> that role's own home instead of a bare 403 page, since the
 * three roles genuinely don't share any screens here.
 *
 * This can only be a client check -- the session lives in localStorage, not
 * a cookie the server could read during rendering (see lib/auth.tsx) -- so
 * every page under it is a client component. The backend is the actual
 * enforcement boundary regardless: every protected endpoint re-checks the
 * bearer token and role itself, so this guard is a UX convenience, not the
 * security boundary.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: Role | Role[];
  children: React.ReactNode;
}) {
  const { status, account } = useAuth();
  const router = useRouter();
  const allowed = Array.isArray(allow) ? allow : [allow];
  const mismatched = status === "authenticated" && account && !allowed.includes(account.role);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    } else if (mismatched && account) {
      router.replace(homeForRole(account.role));
    }
  }, [status, mismatched, account, router]);

  if (status === "loading") {
    return <AuthPending />;
  }
  if (status === "anonymous" || mismatched) {
    // Redirect is in flight (the effect above); render nothing rather than
    // flashing content this visitor isn't allowed to see.
    return null;
  }
  return <>{children}</>;
}

function AuthPending() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="flex items-center gap-2.5 text-muted">
        <span aria-hidden className="vf-live-dot inline-block size-1.5 rounded-full bg-accent" />
        <span className="text-sm">checking session</span>
      </div>
    </div>
  );
}
