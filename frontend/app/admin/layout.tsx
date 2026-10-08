import { RequireRole } from "@/components/auth/RequireRole";
import { AppShell } from "@/components/AppShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole allow="admin">
      <AppShell>{children}</AppShell>
    </RequireRole>
  );
}
