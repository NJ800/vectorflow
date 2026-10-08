import { RequireRole } from "@/components/auth/RequireRole";
import { AppShell } from "@/components/AppShell";

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole allow={["recruiter", "admin"]}>
      <AppShell>{children}</AppShell>
    </RequireRole>
  );
}
