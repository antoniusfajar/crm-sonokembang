import type { FastifyInstance } from 'fastify';
import { asc, desc, eq, ilike } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { contacts, importJobs, leadSources, pipelines, snippets, stages, users } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/http.js';
import { normalizePhone } from '../../lib/phone.js';
import { readTable } from '../../lib/sheet.js';
import { importChats } from '../../services/chatImport.js';
import { requireRole } from '../auth.js';
import { audit } from '../../services/audit.js';
import { applyQualification, createLead, moveStage, openLeadForContact } from '../../services/leads.js';

// Field tujuan per jenis import + kata kunci untuk menebak kolom CSV otomatis.
export const IMPORT_FIELDS: Record<string, { key: string; label: string; guess: string[]; required?: boolean }[]> = {
  contacts: [
    { key: 'phone', label: 'No. WhatsApp', guess: ['phone', 'whatsapp', 'wa', 'hp', 'telepon', 'nomor', 'mobile'], required: true },
    { key: 'name', label: 'Nama', guess: ['name', 'nama', 'full name', 'contact name'] },
    { key: 'firstName', label: 'Nama depan', guess: ['first name', 'nama depan'] },
    { key: 'lastName', label: 'Nama belakang', guess: ['last name', 'nama belakang'] },
    { key: 'email', label: 'Email', guess: ['email', 'e-mail'] },
    { key: 'company', label: 'Perusahaan', guess: ['company', 'perusahaan', 'instansi'] },
    { key: 'type', label: 'Tipe kontak', guess: ['type', 'tipe', 'tag'] },
    { key: 'source', label: 'Sumber lead', guess: ['source', 'sumber'] },
    { key: 'owner', label: 'PIC sales (nama/email)', guess: ['owner', 'assigned', 'pic', 'sales'] },
    { key: 'legacyId', label: 'ID kontak CRM lama', guess: ['contact_id', 'contact id', 'id kontak', 'customer_id'] },
  ],
  leads: [
    { key: 'phone', label: 'No. WhatsApp', guess: ['phone', 'whatsapp', 'wa', 'hp', 'telepon', 'nomor', 'mobile'], required: true },
    { key: 'name', label: 'Nama', guess: ['contact name', 'name', 'nama'] },
    { key: 'pipeline', label: 'Pipeline', guess: ['pipeline'] },
    { key: 'stage', label: 'Tahap', guess: ['stage', 'tahap', 'status'] },
    { key: 'value', label: 'Nilai potensi (Rp)', guess: ['value', 'nilai', 'amount', 'monetary'] },
    { key: 'eventType', label: 'Jenis acara', guess: ['event', 'acara', 'jenis'] },
    { key: 'eventDate', label: 'Tanggal acara (YYYY-MM-DD)', guess: ['event date', 'tanggal acara', 'tanggal'] },
    { key: 'pax', label: 'Jumlah pax', guess: ['pax', 'jumlah', 'guest'] },
    { key: 'location', label: 'Lokasi acara', guess: ['location', 'lokasi', 'venue'] },
    { key: 'owner', label: 'PIC sales (nama/email)', guess: ['owner', 'assigned', 'pic', 'sales'] },
    { key: 'source', label: 'Sumber lead', guess: ['source', 'sumber'] },
    { key: 'lostReason', label: 'Alasan lost', guess: ['lost reason', 'alasan'] },
  ],
  // Riwayat chat CRM lama: satu baris = satu pesan.
  // Dua bentuk ekspor didukung:
  // a) satu baris = satu pesan (isi + waktu + arah inbound/outbound), atau
  // b) satu baris = pasangan pesan masuk + balasannya (isi/waktu inbound & outbound di kolom terpisah).
  // Kolom berpasangan ditaruh di depan supaya tebakan otomatis tidak tertukar dengan kolom umum.
  chats: [
    { key: 'bodyIn', label: 'Isi pesan masuk (inbound)', guess: ['isi pesan inbound', 'pesan inbound', 'inbound message', 'pesan masuk'] },
    { key: 'timeIn', label: 'Waktu pesan masuk', guess: ['timestamp inbound', 'waktu inbound', 'waktu masuk', 'inbound time'] },
    { key: 'bodyOut', label: 'Isi balasan (outbound)', guess: ['isi pesan outbound', 'pesan outbound', 'outbound message', 'pesan keluar', 'balasan'] },
    { key: 'timeOut', label: 'Waktu balasan', guess: ['timestamp outbound', 'waktu outbound', 'waktu balasan', 'outbound time'] },
    { key: 'body', label: 'Isi pesan', guess: ['body', 'message', 'pesan', 'isi', 'text', 'content'] },
    { key: 'timestamp', label: 'Waktu pesan', guess: ['timestamp', 'waktu', 'created_at', 'sent_at', 'date', 'tanggal'] },
    { key: 'direction', label: 'Arah (inbound/outbound)', guess: ['direction', 'arah', 'from_me'] },
    { key: 'phone', label: 'No. WhatsApp', guess: ['phone', 'whatsapp', 'wa_number', 'nomor', 'telepon', 'hp', 'mobile'] },
    { key: 'contactKey', label: 'ID kontak CRM lama', guess: ['contact_id', 'contact id', 'customer_id'] },
    { key: 'sales', label: 'Nama sales', guess: ['nama_sales', 'nama sales', 'sales', 'agent', 'pic', 'user'] },
    { key: 'name', label: 'Nama kontak', guess: ['contact_name', 'nama_kontak', 'nama pelanggan', 'nama customer', 'nama', 'name'] },
    { key: 'channel', label: 'Kanal (hanya WhatsApp yang diimpor)', guess: ['kanal', 'channel'] },
    { key: 'messageId', label: 'ID pesan', guess: ['message_id', 'message id', 'id pesan'] },
    { key: 'conversationKey', label: 'ID percakapan', guess: ['conversation_id', 'conversation id'] },
    { key: 'firstReplyAt', label: 'Balasan admin pertama', guess: ['admin_first_reply_ts', 'first_reply'] },
  ],
  snippets: [
    { key: 'name', label: 'Nama', guess: ['name', 'nama', 'title'], required: true },
    { key: 'shortcut', label: 'Shortcut', guess: ['shortcut', 'short', 'trigger', 'key'], required: true },
    { key: 'body', label: 'Isi', guess: ['body', 'content', 'isi', 'message', 'text'], required: true },
    { key: 'folder', label: 'Folder', guess: ['folder', 'group', 'category'] },
  ],
};

// Pemetaan tahap CRM lama → tahap baru (dari prototype v16)
const STAGE_MAP: Record<string, string> = {
  'new lead': 'Lead Baru',
  contacted: 'Perkenalan & Brosur',
  'follow up': 'Follow Up',
  'proposal sent': 'Proposal',
  'won / dp paid': 'Closing (DP masuk)',
  won: 'Closing (DP masuk)',
  'event done': 'Event Selesai',
  lost: 'Lost',
};

export function guessMapping(kind: string, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of IMPORT_FIELDS[kind] ?? []) {
    const h = headers.find((x) => f.guess.some((g) => x.toLowerCase().trim() === g)) ?? headers.find((x) => f.guess.some((g) => x.toLowerCase().includes(g)));
    if (h && !Object.values(map).includes(h)) map[f.key] = h;
  }
  return map;
}

export function importRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  app.get('/api/import', async (req) => {
    requireRole(req, 'admin');
    const rows = await db
      .select({ id: importJobs.id, kind: importJobs.kind, filename: importJobs.filename, status: importJobs.status, result: importJobs.result, at: importJobs.createdAt })
      .from(importJobs)
      .orderBy(desc(importJobs.createdAt))
      .limit(30);
    return { jobs: rows, fields: IMPORT_FIELDS };
  });

  app.post('/api/import', async (req) => {
    const me = requireRole(req, 'admin');
    const file = await req.file();
    if (!file) throw badRequest('File CSV / Excel belum dipilih');
    const kindField = (file.fields.kind as any)?.value;
    const kind = z.enum(['contacts', 'leads', 'snippets', 'chats']).parse(kindField);
    let table: string[][];
    try {
      table = await readTable(await file.toBuffer(), file.filename);
    } catch {
      throw badRequest('File tidak bisa dibaca. Pakai CSV atau Excel (.xlsx).');
    }
    table = table.filter((r) => r.some((c) => c.trim()));
    if (table.length < 2) throw badRequest('File kosong atau hanya berisi judul kolom');
    const headers = table[0]!.map((h) => h.trim());
    // Riwayat chat bisa sangat panjang; pecah file bila lebih dari batas ini.
    const limit = kind === 'chats' ? 100_000 : 20_000;
    if (table.length - 1 > limit) throw badRequest(`Maksimal ${limit.toLocaleString('id-ID')} baris per file — pecah file menjadi beberapa bagian.`);
    const rows = table.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
    const mapping = guessMapping(kind, headers);
    const [job] = await db.insert(importJobs).values({ kind, filename: file.filename, rows, mapping, createdBy: me.id }).returning({ id: importJobs.id });
    return { id: job!.id, kind, headers, total: rows.length, sample: rows.slice(0, 10), mapping, fields: IMPORT_FIELDS[kind] };
  });

  app.post('/api/import/:id/commit', async (req) => {
    const me = requireRole(req, 'admin');
    const id = (req.params as any).id as string;
    const { mapping } = z.object({ mapping: z.record(z.string(), z.string()) }).parse(req.body);
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, id));
    if (!job) throw notFound();
    if (job.status !== 'preview') throw badRequest('Import ini sudah diproses');
    for (const f of IMPORT_FIELDS[job.kind]!) if (f.required && !mapping[f.key]) throw badRequest(`Kolom "${f.label}" wajib dipetakan`);

    const val = (row: Record<string, string>, key: string) => (mapping[key] ? (row[mapping[key]!] ?? '').trim() : '');
    const allUsers = await db.select().from(users);
    const sources = await db.select().from(leadSources);
    const findUser = (s: string) => (s ? allUsers.find((u) => u.email.toLowerCase() === s.toLowerCase() || u.name.toLowerCase() === s.toLowerCase()) : undefined);
    const findSource = (s: string) => (s ? sources.find((x) => x.name.toLowerCase() === s.toLowerCase() || x.channel.toLowerCase() === s.toLowerCase()) : undefined);
    if (job.kind === 'chats') {
      if (!mapping.phone && !mapping.contactKey) throw badRequest('Petakan kolom "No. WhatsApp" atau "ID kontak CRM lama"');
      const paired = !!(mapping.bodyIn || mapping.bodyOut);
      if (paired && !((mapping.bodyIn && mapping.timeIn) || (mapping.bodyOut && mapping.timeOut))) throw badRequest('Petakan isi & waktu pesan masuk dan/atau balasan');
      if (!paired && !(mapping.body && mapping.timestamp && mapping.direction)) throw badRequest('Petakan kolom "Isi pesan", "Waktu pesan", dan "Arah" — atau kolom pesan masuk/balasan bila satu baris berisi pasangan pesan');
      const r = await importChats(ctx, job.rows, mapping, job.filename);
      await db.update(importJobs).set({ status: 'done', mapping, result: { ...r, errors: r.errors.slice(0, 200) } }).where(eq(importJobs.id, id));
      await audit(db, me.id, 'import.commit', 'import', id, { kind: job.kind, created: r.created, errors: r.errors.length });
      return { ...r, errors: r.errors.slice(0, 100), errorCount: r.errors.length };
    }
    const result = { created: 0, updated: 0, skipped: 0, errors: [] as { row: number; error: string }[] };

    for (const [i, row] of job.rows.entries()) {
      const rowNo = i + 2;
      try {
        if (job.kind === 'snippets') {
          const shortcut = '/' + val(row, 'shortcut').replace(/^\//, '').replace(/\s+/g, '').toLowerCase();
          const ins = await db
            .insert(snippets)
            .values({ name: val(row, 'name'), shortcut, body: val(row, 'body'), folder: val(row, 'folder') || 'Impor' })
            .onConflictDoNothing()
            .returning({ id: snippets.id });
          ins.length ? result.created++ : result.skipped++;
          continue;
        }
        const phone = normalizePhone(val(row, 'phone'));
        if (!phone) throw new Error('Nomor WhatsApp tidak valid');
        const name = val(row, 'name') || [val(row, 'firstName'), val(row, 'lastName')].filter(Boolean).join(' ') || null;
        const owner = findUser(val(row, 'owner'));
        const source = findSource(val(row, 'source'));
        let [c] = await db.select().from(contacts).where(eq(contacts.waPhone, phone));
        if (!c) {
          [c] = await db
            .insert(contacts)
            .values({ waPhone: phone, name, email: val(row, 'email') || null, company: val(row, 'company') || null, contactType: val(row, 'type') || 'Calon pelanggan', sourceId: source?.id ?? null, ownerId: owner?.id ?? null, legacyId: val(row, 'legacyId') || null })
            .returning();
          if (job.kind === 'contacts') result.created++;
        } else {
          // Tidak menimpa data yang sudah ada — hanya mengisi yang kosong.
          await db
            .update(contacts)
            .set({
              name: c.name ?? name,
              email: c.email ?? (val(row, 'email') || null),
              company: c.company ?? (val(row, 'company') || null),
              sourceId: c.sourceId ?? source?.id ?? null,
              ownerId: c.ownerId ?? owner?.id ?? null,
              legacyId: c.legacyId ?? (val(row, 'legacyId') || null),
            })
            .where(eq(contacts.id, c.id));
          if (job.kind === 'contacts') result.updated++;
        }
        if (job.kind === 'leads') {
          if (await openLeadForContact(ctx, c!.id)) {
            result.skipped++;
            continue;
          }
          const pName = val(row, 'pipeline');
          const [p] = pName ? await db.select().from(pipelines).where(ilike(pipelines.name, pName)) : [];
          const lead = await createLead(ctx, {
            contactId: c!.id,
            ownerId: owner?.id ?? c!.ownerId,
            sourceId: source?.id ?? c!.sourceId,
            origin: 'manual',
            originNote: `Import dari ${job.filename}`,
            pipelineId: p?.id,
            eventType: val(row, 'eventType') || null,
            userId: me.id,
          });
          const value = Number(val(row, 'value').replace(/[^\d]/g, '')) || null;
          const pax = Number(val(row, 'pax').replace(/[^\d]/g, '')) || null;
          const date = /^\d{4}-\d{2}-\d{2}$/.test(val(row, 'eventDate')) ? val(row, 'eventDate') : null;
          await applyQualification(ctx, lead.id, { eventType: val(row, 'eventType') || null, eventDate: date, eventDateText: date ? null : val(row, 'eventDate') || null, location: val(row, 'location') || null, pax, estimatedValue: value }, 'user', me.id);
          const stRaw = val(row, 'stage');
          if (stRaw) {
            const target = STAGE_MAP[stRaw.toLowerCase()] ?? stRaw;
            const [st] = await db
              .select()
              .from(stages)
              .where(eq(stages.pipelineId, lead.pipelineId))
              .orderBy(asc(stages.sortOrder))
              .then((ss) => ss.filter((s) => s.name.toLowerCase() === target.toLowerCase()));
            if (st && st.id !== lead.stageId) {
              // Data historis: syarat tahap (bukti DP, dll.) tidak dipaksakan, alasan lost diisi dari CRM lama.
              await moveStage(
                ctx,
                lead.id,
                { stageId: st.id, lostKind: 'Lost', lostReason: val(row, 'lostReason') || 'dari CRM lama' },
                me.id,
                { skipRequirements: ['dp_proof', 'source_known', 'proposal_sent', 'lost_reason'] },
              );
            }
          }
          result.created++;
        }
      } catch (e) {
        result.errors.push({ row: rowNo, error: (e as Error).message });
      }
    }
    await db.update(importJobs).set({ status: 'done', mapping, result }).where(eq(importJobs.id, id));
    await audit(db, me.id, 'import.commit', 'import', id, { kind: job.kind, created: result.created, updated: result.updated, errors: result.errors.length });
    return { ...result, errors: result.errors.slice(0, 100), errorCount: result.errors.length };
  });

  app.post('/api/import/:id/cancel', async (req) => {
    requireRole(req, 'admin');
    await db.update(importJobs).set({ status: 'cancelled' }).where(eq(importJobs.id, (req.params as any).id));
    return { ok: true };
  });
}

