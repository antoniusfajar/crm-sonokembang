import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useMe } from '../auth';
import { useToast } from '../components/ui';
import { dateTime } from '../format';

interface Insight {
  icon: string;
  text: string;
}
interface Weekly {
  period: { label: string };
  insights: Insight[];
  ai: { items: Insight[]; createdAt: string } | null;
  aiAvailable: boolean;
}

/** Kartu gelap "Ringkasan minggu ini" — poin dari script, bisa dirangkai ulang oleh AI. */
export function WeeklySummaryCard({ pipelineId }: { pipelineId: string }) {
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const q = qs({ pipelineId });
  const { data } = useQuery<Weekly>({ queryKey: ['an-weekly', q], queryFn: () => api.get('/api/analytics/weekly' + q) });
  const [busy, setBusy] = useState(false);
  const [showScript, setShowScript] = useState(false);

  const askAi = async () => {
    setBusy(true);
    try {
      await api.post('/api/analytics/weekly/ai' + q, {});
      setShowScript(false);
      await qc.invalidateQueries({ queryKey: ['an-weekly', q] });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const useAi = !!data?.ai && !showScript;
  const items = useAi ? data!.ai!.items : (data?.insights ?? []);
  return (
    <div className="weekly-card">
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <span className="weekly-icon">🤖</span>
        <b style={{ fontSize: 14 }}>Ringkasan minggu ini</b>
        <span className="weekly-tag">{useAi ? 'Ditulis AI' : 'Dihitung sistem'}</span>
      </div>
      <div className="xs" style={{ opacity: 0.7, marginBottom: 6 }}>
        {data?.period.label ?? 'Memuat…'}
        {me.user.scope === 'own' ? ' · data milik Anda' : ''}
      </div>
      {items.map((i, n) => (
        <div key={n} className="weekly-item">
          <span style={{ flex: 'none' }}>{i.icon}</span>
          <span>{i.text}</span>
        </div>
      ))}
      {data && (
        <div className="row wrap" style={{ gap: 8, marginTop: 10, borderTop: '1px solid rgba(255,255,255,.12)', paddingTop: 10 }}>
          {data.aiAvailable ? (
            <button className="btn sm weekly-btn" disabled={busy} onClick={askAi}>
              {busy ? 'AI sedang menulis…' : data.ai ? 'Tulis ulang dengan AI' : 'Rangkum dengan AI'}
            </button>
          ) : (
            <span className="xs" style={{ opacity: 0.7 }}>AI belum aktif — poin di atas dihitung langsung dari data.</span>
          )}
          {data.ai && (
            <button className="btn sm ghost weekly-link" onClick={() => setShowScript((v) => !v)}>
              {showScript ? 'Lihat versi AI' : 'Lihat angka asli'}
            </button>
          )}
          {useAi && <span className="xs" style={{ opacity: 0.6, marginLeft: 'auto' }}>{dateTime(data.ai!.createdAt)}</span>}
        </div>
      )}
    </div>
  );
}
