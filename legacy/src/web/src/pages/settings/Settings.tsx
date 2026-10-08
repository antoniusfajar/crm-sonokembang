import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { ProfileTab, RolesTab, UsersTab, PipelineTab } from './TabsA';
import { SourcesTab, DistributionTab, FieldsTab, KpiTab } from './TabsB';
import { PromptTab, AiModelTab, WhatsAppTab, ImportTab } from './TabsC';
import { TargetTab } from './TabsD';
import { IntegrationsTab } from './TabsE';
import { ReportSchedulesCard } from '../Reports';

const TABS: [string, string][] = [
  ['profil', 'Profil bisnis'],
  ['peran', 'Peran & akses'],
  ['pengguna', 'Users'],
  ['pipeline', 'Pipeline'],
  ['target', 'Target omzet'],
  ['laporan', 'Pengiriman laporan'],
  ['kpi', 'SLA & jam kerja'],
  ['sumber', 'Sumber lead & link WA'],
  ['ai', 'Prompt & pagar AI'],
  ['aimodel', 'Model AI & API key'],
  ['distribusi', 'Distribusi lead'],
  ['field', 'Custom field'],
  ['whatsapp', 'WhatsApp'],
  ['integrasi', 'Integrasi'],
  ['import', 'Import data'],
];

export function SettingsPage() {
  const { tab = 'profil' } = useParams();
  const nav = useNavigate();
  return (
    <Layout flush>
      <div className="tabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => nav(`/pengaturan/${k}`)}>
            {l}
          </button>
        ))}
      </div>
      <div className="content">
        {tab === 'profil' && <ProfileTab />}
        {tab === 'peran' && <RolesTab />}
        {tab === 'pengguna' && <UsersTab />}
        {tab === 'pipeline' && <PipelineTab />}
        {tab === 'target' && <TargetTab />}
        {tab === 'laporan' && (
          <div style={{ maxWidth: 1100 }}>
            <ReportSchedulesCard />
            <div className="small muted" style={{ marginTop: 10 }}>
              Laporan sekali buat & riwayat ada di menu Reports. Email berlampiran butuh SMTP (lihat Notifikasi & SLA › Kanal notifikasi).
            </div>
          </div>
        )}
        {tab === 'kpi' && <KpiTab />}
        {tab === 'sumber' && <SourcesTab />}
        {tab === 'ai' && <PromptTab />}
        {tab === 'aimodel' && <AiModelTab />}
        {tab === 'distribusi' && <DistributionTab />}
        {tab === 'field' && <FieldsTab />}
        {tab === 'whatsapp' && <WhatsAppTab />}
        {tab === 'integrasi' && <IntegrationsTab />}
        {tab === 'import' && <ImportTab />}
      </div>
    </Layout>
  );
}
