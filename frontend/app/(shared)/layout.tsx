import { RequireRole } from "@/components/auth/RequireRole";
import { AppShell } from "@/components/AppShell";

/**
 * /jobs and /activity are the two screens all three roles share -- a
 * recruiter or admin can browse and watch the same real data a job seeker
 * sees, just without the simulate actions (see ActionGroup's call sites,
 * which check role explicitly rather than relying on this guard alone).
 */
export default function SharedLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole allow={["job_seeker", "recruiter", "admin"]}>
      <AppShell>{children}</AppShell>
    </RequireRole>
  );
}
