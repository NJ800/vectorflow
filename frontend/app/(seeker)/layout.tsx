import { RequireRole } from "@/components/auth/RequireRole";
import { AppShell } from "@/components/AppShell";

export default function SeekerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole allow="job_seeker">
      <AppShell>{children}</AppShell>
    </RequireRole>
  );
}
