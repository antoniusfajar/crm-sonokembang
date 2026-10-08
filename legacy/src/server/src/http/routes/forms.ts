import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, inArray, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { activities, forms, leads, leadSources, users } from '../../db/schema.js';
import { requireMenu, requireRole } from '../auth.js';
import { audit } from '../../services/audit.js';
import { badRequest, notFound } from '../../lib/http.js';
import { toCsv } from '../../lib/csv.js';
import { getSetting, setSetting } from '../../services/settings.js';
import { CONSULTATION_FIELDS, formStats, listSubmissions, MAP_TARGETS, slugify, submitForm, widgetConfig, widgetLead } from '../../services/forms.js';
import { leadCode } from '../../services/leads.js';
import { renderFormPage, WIDGET_JS } from '../public-pages.js';

const Field = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,32}$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'phone', 'email', 'number', 'date', 'select', 'textarea']),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  mapTo: z.string().max(60).nullable(),
});
const FormBody = z.object({
  name: z.string().trim().min(3).max(100),
  slug: z.string().trim().max(48).optional(),
  status: z.enum(['active', 'draft', 'archived']).default('draft'),
  purpose: z.enum(['lead', 'other']).default('lead'),
  fields: z.array(Field).min(1).max(30),
  sourceId: z.string().uuid().nullable().optional(),
  settings: z
    .object({
      title: z.string().max(120).optional(),
      intro: z.string().max(600).optional(),
      thankYou: z.string().max(400).optional(),
      submitLabel: z.string().max(40).optional(),
      notifyUserIds: z.array(z.string().uuid()).max(20).optional(),
      createTask: z.boolean().optional(),
      waTemplate: z.string().max(80).nullable().optional(),
      destination: z.string().max(200).optional(),
    })
    .default({}),
});

const clientIp = (req: FastifyRequest) => String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0]!.trim();
const cors = (reply: FastifyReply) => reply.header('Access-Control-Allow-Origin', '*').header('Access-Control-Allow-Headers', 'Content-Type').header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

export function formRoutes(app: FastifyInstance, ctx: Ctx) {
  const db = ctx.db;

  // ================= Publik (tanpa login) =================
  app.options('/api/public/*', async (_req, reply) => cors(reply).code(204).send());

  app.get('/f/:slug', async (req, reply) => {
    const [f] = await db.select().from(forms).where(eq(forms.slug, (req.params as any).slug));
    const biz = await getSetting<{ name: string; logoPath?: string | null }>(db, 'business_profile');
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    if (!f || f.status !== 'active') return reply.code(404).send(renderFormPage(null, biz));
    return renderFormPage(f, biz);
  });

  app.get('/api/public/forms/:slug', async (req, reply) => {
    cors(reply);
    const [f] = await db.select().from(forms).where(eq(forms.slug, (req.params as any).slug));
    if (!f || f.status !== 'active') throw notFound('Form tidak ditemukan');
    return { name: f.name, fields: f.fields.map(({ mapTo, ...x }) => x), settings: { title: f.settings.title, intro: f.settings.intro, submitLabel: f.settings.submitLabel } };
  });

  app.post('/api/public/forms/:slug', async (req, reply) => {
    cors(reply);
    const b = (req.body ?? {}) as Record<string, any>;
    return submitForm(ctx, (req.params as any).slug, b.answers ?? b, { ip: clientIp(req), page: b._page ?? null, utm: b._utm ?? null, honeypot: b._hp ?? null });
  });

  app.get('/widget.js', async (_req, reply) => {
    reply.type('application/javascript; charset=utf-8').header('Cache-Control', 'public, max-age=300');
    return WIDGET_JS;
  });

  app.get('/api/public/widget', async (req, reply) => {
    cors(reply);
    const c = await widgetConfig(ctx);
    const origin = String(req.headers.origin ?? req.headers.referer ?? '');
    const host = origin ? (() => { try { return new URL(origin).host; } catch { return ''; } })() : '';
    // Bila daftar domain diisi, widget hanya tampil di domain itu.
    const allowed = !c.allowedDomains.length || !host || c.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
    if (!c.enabled || !c.hotline || !allowed) return { enabled: false };
    const { allowedDomains, ...pub } = c;
    return pub;
  });

  app.post('/api/public/widget/lead', async (req, reply) => {
    cors(reply);
    const b = z.object({ name: z.string().max(80).optional(), phone: z.string().max(30).optional(), eventType: z.string().max(60).optional(), eventDate: z.string().max(10).optional(), page: z.string().max(300).optional(), _hp: z.string().optional() }).parse(req.body ?? {});
    return widgetLead(ctx, { ...b, honeypot: b._hp }, clientIp(req));
  });

  // ================= Form Management (login) =================
  app.get('/api/forms', async (req) => {
    requireMenu(req, 'formmgmt');
    const rows = await db.select({ f: forms, src: leadSources.name }).from(forms).leftJoin(leadSources, eq(leadSources.id, forms.sourceId)).orderBy(desc(forms.updatedAt));
    const st = await formStats(ctx, rows.map((r) => r.f.id));
    return {
      rows: rows.map(({ f, src }) => ({ ...f, sourceName: src, stats: st.get(f.id) ?? { submissions: 0, leads: 0, closings: 0, last: null } })),
      mapTargets: MAP_TARGETS,
      publicBase: ctx.config.PUBLIC_URL.replace(/\/$/, ''),
    };
  });

  app.get('/api/forms/:id', async (req) => {
    requireMenu(req, 'formmgmt');
    const [f] = await db.select().from(forms).where(eq(forms.id, (req.params as any).id));
    if (!f) throw notFound();
    const subs = await listSubmissions(ctx, f.id, 50);
    const leadRows = subs.filter((s) => s.leadId).map((s) => s.leadId!);
    const codes = leadRows.length ? await db.select({ id: leads.id, code: leads.code }).from(leads).where(inArray(leads.id, leadRows)) : [];
    const code = new Map(codes.map((c) => [c.id, leadCode(c.code)]));
    return { ...f, submissions: subs.map((s) => ({ ...s, leadCode: s.leadId ? (code.get(s.leadId) ?? null) : null })) };
  });

  const uniqueSlug = async (want: string, selfId?: string) => {
    const base = slugify(want);
    for (let i = 0; i < 50; i++) {
      const s = i ? `${base}-${i + 1}` : base;
      const [x] = await db.select({ id: forms.id }).from(forms).where(eq(forms.slug, s));
      if (!x || x.id === selfId) return s;
    }
    throw badRequest('Tidak bisa membuat alamat form');
  };

  const check = (b: z.infer<typeof FormBody>) => {
    const keys = new Set<string>();
    for (const f of b.fields) {
      if (keys.has(f.key)) throw badRequest(`Kunci field "${f.key}" dipakai dua kali`);
      keys.add(f.key);
      if (f.type === 'select' && !f.options?.length) throw badRequest(`Field "${f.label}" bertipe pilihan butuh daftar pilihan`);
    }
    if (b.purpose === 'lead' && !b.fields.some((f) => f.mapTo === 'phone')) throw badRequest('Form yang dijadikan lead wajib punya field Nomor WhatsApp yang dipetakan ke "Nomor WhatsApp"');
    const maps = b.fields.map((f) => f.mapTo).filter((m) => m && !m.startsWith('custom:'));
    if (new Set(maps).size !== maps.length) throw badRequest('Satu tujuan data hanya boleh dipakai satu field');
  };

  app.post('/api/forms', async (req) => {
    const me = requireMenu(req, 'formmgmt');
    const raw = req.body as any;
    const b = FormBody.parse(raw?.preset === 'consultation' ? { name: 'Form Konsultasi', fields: CONSULTATION_FIELDS, settings: { title: 'Konsultasi catering', intro: 'Isi data singkat di bawah, tim kami akan menghubungi lewat WhatsApp.', createTask: true } } : raw);
    check(b);
    const [row] = await db
      .insert(forms)
      .values({ ...b, slug: await uniqueSlug(b.slug || b.name), createdBy: me.id })
      .returning();
    await audit(db, me.id, 'form.create', 'form', row!.id, { name: b.name });
    return row;
  });

  app.put('/api/forms/:id', async (req) => {
    const me = requireMenu(req, 'formmgmt');
    const id = (req.params as any).id;
    const b = FormBody.parse(req.body);
    check(b);
    const [row] = await db
      .update(forms)
      .set({ ...b, slug: await uniqueSlug(b.slug || b.name, id), updatedAt: new Date() })
      .where(eq(forms.id, id))
      .returning();
    if (!row) throw notFound();
    await audit(db, me.id, 'form.update', 'form', id, { status: b.status });
    return row;
  });

  app.delete('/api/forms/:id', async (req) => {
    const me = requireRole(req, 'admin', 'marketing');
    await db.delete(forms).where(eq(forms.id, (req.params as any).id));
    await audit(db, me.id, 'form.delete', 'form', (req.params as any).id);
    return { ok: true };
  });

  app.get('/api/forms/:id/export.csv', async (req, reply) => {
    const me = requireRole(req, 'admin', 'marketing', 'spv');
    const [f] = await db.select().from(forms).where(eq(forms.id, (req.params as any).id));
    if (!f) throw notFound();
    const subs = await listSubmissions(ctx, f.id, 10_000);
    const withPhone = me.role === 'admin';
    const cols = f.fields.filter((x) => withPhone || x.type !== 'phone');
    const rows: unknown[][] = [['Waktu', ...cols.map((c) => c.label), 'Halaman']];
    for (const s of subs) rows.push([s.createdAt.toISOString(), ...cols.map((c) => (s.data as any)[c.key] ?? ''), s.page ?? '']);
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="form-${f.slug}.csv"`);
    return toCsv(rows);
  });

  // ================= Livechat widget (pengaturan) =================
  app.get('/api/widget', async (req) => {
    requireMenu(req, 'widget');
    const c = await widgetConfig(ctx);
    const base = ctx.config.PUBLIC_URL.replace(/\/$/, '');
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(activities)
      .where(and(eq(activities.type, 'form'), like(activities.title, 'Livechat widget%'), gte(activities.at, new Date(Date.now() - 30 * 86_400_000))));
    const n = r?.n ?? 0;
    return { config: c, embedCode: `<script src="${base}/widget.js" defer></script>`, leads30: Number(n ?? 0) };
  });

  app.put('/api/widget', async (req) => {
    const me = requireMenu(req, 'widget');
    const b = z
      .object({
        enabled: z.boolean(),
        position: z.enum(['right', 'left']),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        launcher: z.enum(['bubble', 'pill']),
        label: z.string().trim().max(40),
        greeting: z.string().trim().max(200),
        showGreeting: z.boolean(),
        badge: z.boolean(),
        prechat: z.boolean(),
        askEvent: z.boolean(),
        askDate: z.boolean(),
        eventOptions: z.array(z.string().trim().min(1).max(60)).max(20),
        hoursNote: z.string().trim().max(120),
        allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+$/)).max(10),
      })
      .parse(req.body);
    await setSetting(db, 'widget', b, me.id);
    await audit(db, me.id, 'widget.update', 'setting', 'widget');
    return { ok: true };
  });

  // daftar pengguna untuk notifikasi form
  app.get('/api/forms-meta/users', async (req) => {
    requireMenu(req, 'formmgmt');
    return db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.status, 'aktif'));
  });
}
