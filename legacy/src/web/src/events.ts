import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Dengarkan event real-time dari server (SSE) dan segarkan data yang terkait. */
export function useLiveEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let stop = false;
    const connect = () => {
      if (stop) return;
      es = new EventSource('/api/events');
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data);
          if (e.type === 'message' || e.type === 'conversation') {
            qc.invalidateQueries({ queryKey: ['conversations'] });
            qc.invalidateQueries({ queryKey: ['conversation', e.conversationId] });
            qc.invalidateQueries({ queryKey: ['me'] });
            qc.invalidateQueries({ queryKey: ['ai-overview'] });
          }
          if (e.type === 'lead') {
            qc.invalidateQueries({ queryKey: ['leads'] });
            qc.invalidateQueries({ queryKey: ['lead', e.leadId] });
            qc.invalidateQueries({ queryKey: ['conversations'] });
          }
          if (e.type === 'notification') {
            qc.invalidateQueries({ queryKey: ['me'] });
            qc.invalidateQueries({ queryKey: ['notifications'] });
          }
          if (e.type === 'task') qc.invalidateQueries({ queryKey: ['tasks'] });
        } catch {
          /* abaikan */
        }
      };
      es.onerror = () => {
        es?.close();
        setTimeout(connect, 4000);
      };
    };
    connect();
    return () => {
      stop = true;
      es?.close();
    };
  }, [qc]);
}
