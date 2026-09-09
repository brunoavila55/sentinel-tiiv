import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/AppLayout";
import { AcceptInvitePage } from "@/pages/AcceptInvitePage";
import { AssetDetailPage } from "@/pages/AssetDetailPage";
import { AssetsPage } from "@/pages/AssetsPage";
import { AuditLogsPage } from "@/pages/AuditLogsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { MembersPage } from "@/pages/MembersPage";
import { OrganizationSettingsPage } from "@/pages/OrganizationSettingsPage";
import { ProblemsPage } from "@/pages/ProblemsPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { SitesPage } from "@/pages/SitesPage";
import { TopologyPage } from "@/pages/TopologyPage";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/assets/:assetId" element={<AssetDetailPage />} />
        <Route path="/topology" element={<TopologyPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/problems" element={<ProblemsPage />} />
        <Route path="/settings/organization" element={<OrganizationSettingsPage />} />
        <Route path="/settings/members" element={<MembersPage />} />
        <Route path="/settings/audit-logs" element={<AuditLogsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
