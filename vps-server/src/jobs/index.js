import { query, one, notify, supervisors, getSetting } from '../db.js';
import { sendMessage } from '../whatsapp.js';
import { callWebsite } from '../website.js';

/**
 * Daftar job terjadwal. `schedule` memakai format cron (node-cron, 6 kolom = ada detik):
 *   detik menit jam tanggal bulan hari
 * Tambah job baru cukup dengan menambah entri di sini.
 */
export const JOBS = [
  {
    name: 'sla',
    schedule: '0 * * * * *', // tiap menit
    description: 'Tandai chat yang lama belum dibalas & eskalasi ke SPV',
    run: async () => {
      const sla = await getSetting('sla', { warnMinutes: 15, escalateMinutes: 60 });
      const warn = await query(
        `SELECT cv.id, cv.assignee_id, c.name, c.wa_phone FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
         WHERE cv.awaiting_reply_since IS NOT NULL AND cv.sla_level < 1
           AND cv.awaiting_reply_since <= NOW() - INTERVAL ? MINUTE`,
        [sla.warnMinutes],
      );
      for (const cv of warn) {
        await query('UPDATE conversations SET sla_level = 1 WHERE id = ?', [cv.id]);
        if (cv.assignee_id) await notify(cv.assignee_id, 'sla', `Chat ${cv.name || cv.wa_phone} menunggu balasan > ${sla.warnMinutes} menit`, `inbox/index/${cv.id}`);
      }
      const esc = await query(
        `SELECT cv.id, c.name, c.wa_phone FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
         WHERE cv.awaiting_reply_since IS NOT NULL AND cv.sla_level < 2
           AND cv.awaiting_reply_since <= NOW() - INTERVAL ? MINUTE`,
        [sla.escalateMinutes],
      );
      const spv = esc.length ? await supervisors() : [];
      for (const cv of esc) {
        await query('UPDATE conversations SET sla_level = 2 WHERE id = ?', [cv.id]);
        for (const s of spv) await notify(s.id, 'sla_escalation', `Eskalasi: ${cv.name || cv.wa_phone} belum dibalas > ${sla.escalateMinutes} menit`, `inbox/index/${cv.id}`);
      }
      return `${warn.length} peringatan, ${esc.length} eskalasi`;
    },
  },
  {
    name: 'task-due',
    schedule: '30 * * * * *', // tiap menit (detik ke-30)
    description: 'Notifikasi tugas yang jatuh tempo 15 menit lagi',
    run: async () => {
      const rows = await query(
        `SELECT id, user_id, title, lead_id FROM tasks
         WHERE done_at IS NULL AND reminded_at IS NULL AND due_at <= NOW() + INTERVAL 15 MINUTE`,
      );
      for (const t of rows) {
        await notify(t.user_id, 'task_due', `Tugas segera jatuh tempo: ${t.title}`, t.lead_id ? `leads/view/${t.lead_id}` : 'tasks');
        await query('UPDATE tasks SET reminded_at = NOW() WHERE id = ?', [t.id]);
      }
      return `${rows.length} pengingat`;
    },
  },
  {
    name: 'stale-leads',
    schedule: '0 */15 8-20 * * *', // tiap 15 menit, jam kerja 08–20
    description: 'Buat tugas follow-up otomatis untuk lead yang lama tidak disentuh',
    run: async () => {
      const { staleLeadDays } = await getSetting('reminder', { staleLeadDays: 3 });
      const leads = await query(
        `SELECT l.id, l.owner_id, l.name FROM leads l JOIN stages s ON s.id = l.stage_id
         WHERE s.kind = 'open' AND l.owner_id IS NOT NULL AND l.last_activity_at <= NOW() - INTERVAL ? DAY`,
        [staleLeadDays],
      );
      let created = 0;
      for (const l of leads) {
        // rule_key per hari supaya tidak dobel (UNIQUE lead_id + rule_key)
        const key = `stale-${new Date().toISOString().slice(0, 10)}`;
        const r = await query(
          `INSERT IGNORE INTO tasks (lead_id, user_id, title, kind, due_at, auto, rule_key)
           VALUES (?, ?, ?, 'Follow-up', NOW() + INTERVAL 2 HOUR, 1, ?)`,
          [l.id, l.owner_id, `Follow-up: ${l.name} (tidak ada aktivitas ${staleLeadDays} hari)`, key],
        );
        if (r.affectedRows) {
          created++;
          await notify(l.owner_id, 'stale_lead', `Lead ${l.name} perlu di-follow-up`, `leads/view/${l.id}`);
        }
      }
      return `${created} tugas dibuat`;
    },
  },
  {
    name: 'broadcast',
    schedule: '15 * * * * *', // tiap menit
    description: 'Kirim broadcast WA terjadwal (maks 50 penerima per menit)',
    run: async () => {
      await query("UPDATE broadcasts SET status = 'sending' WHERE status = 'scheduled' AND scheduled_at <= NOW()");
      const b = await one("SELECT id, body FROM broadcasts WHERE status = 'sending' ORDER BY id LIMIT 1");
      if (!b) return 'tidak ada';
      const recipients = await query(
        `SELECT r.id, r.contact_id, c.opt_out_at FROM broadcast_recipients r JOIN contacts c ON c.id = r.contact_id
         WHERE r.broadcast_id = ? AND r.status = 'pending' LIMIT 50`,
        [b.id],
      );
      let sent = 0;
      for (const r of recipients) {
        if (r.opt_out_at) {
          await query("UPDATE broadcast_recipients SET status = 'skipped', error = 'opt-out' WHERE id = ?", [r.id]);
          continue;
        }
        try {
          let conv = await one("SELECT id FROM conversations WHERE contact_id = ? AND channel = 'whatsapp'", [r.contact_id]);
          if (!conv) conv = { id: (await query('INSERT INTO conversations (contact_id) VALUES (?)', [r.contact_id])).insertId };
          await sendMessage({ conversationId: conv.id, body: b.body, senderType: 'system' });
          await query("UPDATE broadcast_recipients SET status = 'sent', sent_at = NOW() WHERE id = ?", [r.id]);
          sent++;
        } catch (e) {
          await query("UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?", [String(e.message).slice(0, 250), r.id]);
        }
      }
      const left = await one("SELECT COUNT(*) n FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending'", [b.id]);
      if (!Number(left.n)) await query("UPDATE broadcasts SET status = 'done' WHERE id = ?", [b.id]);
      return `broadcast #${b.id}: ${sent} terkirim, sisa ${left.n}`;
    },
  },
  {
    name: 'website-ping',
    schedule: '0 */5 * * * *', // tiap 5 menit
    description: 'Cek website CI3 bisa dihubungi dari VPS',
    run: async () => {
      const r = await callWebsite('ping');
      return `website OK ${r.time}`;
    },
  },
  {
    name: 'cleanup',
    schedule: '0 0 2 * * *', // tiap hari 02:00
    description: 'Hapus sesi kedaluwarsa & riwayat job lama',
    run: async () => {
      const s = await query('DELETE FROM ci_sessions WHERE timestamp < UNIX_TIMESTAMP(NOW() - INTERVAL 2 DAY)');
      const j = await query('DELETE FROM job_runs WHERE started_at < NOW() - INTERVAL 30 DAY');
      return `${s.affectedRows} sesi, ${j.affectedRows} log dihapus`;
    },
  },
];
