import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MeProvider, useMeQuery } from './auth';
import { Loading } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { AccountPage } from './pages/Account';
import { InboxPage } from './pages/Inbox';
import { TasksPage } from './pages/Tasks';
import { PipelinePage } from './pages/Pipeline';
import { LeadDetailPage } from './pages/LeadDetail';
import { ContactsPage } from './pages/Contacts';
import { AiPage } from './pages/Ai';
import { NotifPage } from './pages/Notif';
import { TemplatesPage } from './pages/Templates';
import { SettingsPage } from './pages/settings/Settings';
import { ComingSoon } from './pages/ComingSoon';
import { DashboardPage } from './pages/Dashboard';
import { CustomersPage } from './pages/Customers';
import { ReportsPage } from './pages/Reports';
import { BroadcastPage } from './pages/Broadcast';
import { FormsPage } from './pages/Forms';
import { WidgetPage } from './pages/Widget';
import { ReputationPage } from './pages/Reputation';
import { AdsPage } from './pages/Ads';
import { SocialPage } from './pages/Social';
import { WebsitePage } from './pages/Website';
import { MENU_META, landingPath, menuForPath } from './nav';

export function App() {
  const { data: me, isLoading } = useMeQuery();
  const loc = useLocation();
  if (isLoading) return <Loading />;
  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} />
      </Routes>
    );
  }
  const keys = me.menus.flatMap((g) => g.items.map((i) => i.key));
  const home = landingPath(keys, me.user.role);
  if (me.user.mustChangePassword && loc.pathname !== '/akun') return <Navigate to="/akun" replace />;
  const key = menuForPath(loc.pathname);
  const blocked = key && !keys.includes(key);
  const phaseOf = (k: string) => me.menus.flatMap((g) => g.items).find((i) => i.key === k)?.phase ?? 1;

  return (
    <MeProvider me={me}>
      {blocked ? (
        <Layout title="Tidak ada akses" eyebrow="Hak akses">
          <div className="empty">Menu ini tidak dibuka untuk peran {me.user.roleLabel}. Minta Admin mengubahnya di Pengaturan › Peran &amp; akses.</div>
        </Layout>
      ) : (
        <Routes>
          <Route path="/login" element={<Navigate to={home} replace />} />
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/akun" element={<AccountPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/inbox/:id" element={<InboxPage />} />
          <Route path="/tugas" element={<TasksPage />} />
          <Route path="/leads" element={<PipelinePage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/kontak" element={<ContactsPage />} />
          <Route path="/pelanggan" element={<CustomersPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/broadcast" element={<BroadcastPage />} />
          <Route path="/form" element={<FormsPage />} />
          <Route path="/widget" element={<WidgetPage />} />
          <Route path="/reputasi" element={<ReputationPage />} />
          <Route path="/ads" element={<AdsPage />} />
          <Route path="/sosmed" element={<SocialPage />} />
          <Route path="/website" element={<WebsitePage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/notif" element={<NotifPage />} />
          <Route path="/template" element={<TemplatesPage />} />
          <Route path="/pengaturan" element={<SettingsPage />} />
          <Route path="/pengaturan/:tab" element={<SettingsPage />} />
          {Object.entries(MENU_META)
            .filter(([k]) => phaseOf(k) > 1)
            .map(([k, m]) => (
              <Route key={k} path={m.path} element={<ComingSoon menuKey={k} />} />
            ))}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      )}
    </MeProvider>
  );
}
