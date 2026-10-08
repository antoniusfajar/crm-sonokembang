import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { count } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { leadSources, pipelines, proposalTemplates, promptVersions, roleSettings, snippets, stages, users, distributionMembers, waTemplates } from './schema.js';
import { DEFAULT_PIPELINES, DEFAULT_SOURCES, DEFAULT_WA_TEMPLATES } from '../services/defaults.js';
import { DEFAULT_SCOPE, defaultMenus, ROLES } from '../lib/permissions.js';
import { hashPassword } from '../lib/password.js';
import { randomToken } from '../lib/crypto.js';
import { DEFAULT_PROMPT } from '../ai/responder.js';
import { DEFAULT_PROPOSAL_TEMPLATES, DEFAULT_SNIPPETS } from './seed-content.js';

/** Data dasar yang wajib ada. Aman dijalankan berulang (hanya mengisi yang kosong). */
export async function ensureBaseData(ctx: Ctx, log: (m: string) => void = console.log) {
  const db = ctx.db;
  for (const role of ROLES) {
    await db.insert(roleSettings).values({ role, menus: defaultMenus(role), scope: DEFAULT_SCOPE[role] }).onConflictDoNothing();
  }

  const [{ n: pipeCount }] = (await db.select({ n: count() }).from(pipelines)) as [{ n: number }];
  if (!Number(pipeCount)) {
    for (const [i, p] of DEFAULT_PIPELINES.entries()) {
      const [row] = await db.insert(pipelines).values({ name: p.name, color: p.color, sortOrder: i, targetShare: p.targetShare, eventTypes: p.eventTypes }).returning();
      await db.insert(stages).values(
        p.stages.map(([name, probability, slaDays, kind, requirements], j) => ({ pipelineId: row!.id, name, probability, slaDays: slaDays || null, kind, requirements, sortOrder: j })),
      );
    }
    log('Pipeline bawaan dibuat (Wedding, Non Wedding, Retail)');
  }

  const [{ n: srcCount }] = (await db.select({ n: count() }).from(leadSources)) as [{ n: number }];
  if (!Number(srcCount)) {
    await db.insert(leadSources).values([
      ...DEFAULT_SOURCES.map((s, i) => ({ ...s, sortOrder: i })),
      { name: 'Tidak diketahui', channel: '—', refCode: null, howRecorded: 'Tanpa penanda — wajib dikoreksi sales sebelum Proposal', offline: false, sortOrder: 99 },
    ]);
  }

  const [{ n: promptCount }] = (await db.select({ n: count() }).from(promptVersions)) as [{ n: number }];
  if (!Number(promptCount)) await db.insert(promptVersions).values({ version: 1, content: DEFAULT_PROMPT, note: 'Versi awal dari prototype', active: true });

  const [{ n: tplCount }] = (await db.select({ n: count() }).from(proposalTemplates)) as [{ n: number }];
  if (!Number(tplCount)) await db.insert(proposalTemplates).values(DEFAULT_PROPOSAL_TEMPLATES);

  const [{ n: waTplCount }] = (await db.select({ n: count() }).from(waTemplates)) as [{ n: number }];
  if (!Number(waTplCount)) await db.insert(waTemplates).values(DEFAULT_WA_TEMPLATES).onConflictDoNothing();

  const [{ n: snipCount }] = (await db.select({ n: count() }).from(snippets)) as [{ n: number }];
  if (!Number(snipCount)) await db.insert(snippets).values(DEFAULT_SNIPPETS);

  const [{ n: userCount }] = (await db.select({ n: count() }).from(users)) as [{ n: number }];
  if (!Number(userCount)) {
    const pw = ctx.config.ADMIN_PASSWORD || randomToken(12);
    await db.insert(users).values({
      name: ctx.config.ADMIN_NAME,
      email: ctx.config.ADMIN_EMAIL.toLowerCase(),
      passwordHash: await hashPassword(pw),
      role: 'admin',
      mustChangePassword: !ctx.config.ADMIN_PASSWORD,
    });
    log('==================================================');
    log(`Akun Admin pertama: ${ctx.config.ADMIN_EMAIL}`);
    if (!ctx.config.ADMIN_PASSWORD) log(`Kata sandi sementara: ${pw}  (wajib diganti saat login pertama)`);
    log('==================================================');
  }
}

/** Data contoh untuk mencoba aplikasi (npm run db:seed -- --demo). Jangan dipakai di production. */
export async function seedDemo(ctx: Ctx) {
  const pw = await hashPassword('sonokembang123');
  const team = [
    { name: 'Rahman', email: 'rahman@sonokembang.local', role: 'spv' as const },
    { name: 'Dewi', email: 'dewi@sonokembang.local', role: 'sales' as const },
    { name: 'Bachtiar', email: 'bachtiar@sonokembang.local', role: 'sales' as const },
    { name: 'Aziza', email: 'aziza@sonokembang.local', role: 'sales' as const },
    { name: 'Digital Marketing', email: 'marketing@sonokembang.local', role: 'marketing' as const },
  ];
  for (const t of team) {
    const [u] = await ctx.db.insert(users).values({ ...t, passwordHash: pw }).onConflictDoNothing().returning();
    if (u && t.role !== 'marketing') {
      await ctx.db.insert(distributionMembers).values({ userId: u.id, weight: t.role === 'spv' ? 10 : 30 }).onConflictDoNothing();
    }
  }
  const { handleInbound } = await import('../services/messaging.js');
  const samples: [string, string, string][] = [
    ['6281233449021', 'Retno Wulandari', 'Pagi, saya mau tanya untuk resepsi pernikahan bulan Desember. IGADS-wedding'],
    ['6281322901187', 'Hadi Kusuma', 'Halo, mau pesan nasi box premium untuk wisuda UB 7 November, 300 box. WEB-wisuda'],
    ['6285677814402', 'Dinda Ayu', 'Brosurnya sudah saya terima, nanti saya kabari'],
    ['6287899037715', 'Sri Handayani', 'Mau tanya untuk aqiqah tumpeng + snack 150 orang'],
    ['6281933126650', 'Bagus Prakoso', 'Kalau coffee break 2x untuk gathering kantor kena berapa? EXPO-skwedding'],
  ];
  for (const [from, name, text] of samples) {
    await handleInbound(ctx, { type: 'message', from, profileName: name, text, kind: 'text', timestamp: new Date(), waMessageId: `demo.${from}.${Date.now()}` });
  }
  console.log('Data demo dibuat. Login: dewi@sonokembang.local / sonokembang123 (Sales), rahman@… (SPV)');
}

/**
 * Riwayat 12 bulan untuk mencoba Dashboard & Reports (npm run db:seed -- --demo --history).
 * Angka dibuat acak tapi masuk akal. JANGAN dipakai di production.
 */
export async function seedHistory(ctx: Ctx) {
  const { contacts, conversations, leadSources, leadStageHistory, leads, messages, pipelines, proposals, stages, targets, users } = await import('./schema.js');
  const { eq, inArray } = await import('drizzle-orm');
  const db = ctx.db;
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const sales = await db.select().from(users).where(inArray(users.role, ['sales', 'spv']));
  if (!sales.length) throw new Error('Jalankan --demo dulu (butuh pengguna sales)');
  const pipes = await db.select().from(pipelines);
  const allStages = await db.select().from(stages);
  const sources = (await db.select().from(leadSources)).filter((x) => x.name !== 'Tidak diketahui');
  const events: Record<string, [string, number, number][]> = {
    Wedding: [['Wedding · buffet + gubuk', 300, 1200], ['Resepsi pernikahan', 400, 1000], ['Lamaran', 80, 200]],
    'Non Wedding': [['Gathering kantor', 80, 300], ['Wisuda · nasi box', 150, 500], ['Syukuran', 50, 200], ['Ulang tahun', 40, 150]],
    Retail: [['Nasi box', 30, 200], ['Tumpeng', 20, 80], ['Snack box', 50, 300]],
  };
  const perPax: Record<string, number> = { Wedding: 120_000, 'Non Wedding': 55_000, Retail: 35_000 };
  const lostR = ['Harga di atas budget', 'Tanggal penuh', 'Pilih kompetitor', 'Acara dibatalkan', 'Menu tidak sesuai'];
  const now = Date.now();
  let made = 0;
  const repeatPool: { contactId: string; ownerId: string }[] = [];
  for (let daysAgo = 360; daysAgo >= 1; daysAgo--) {
    const perDay = rnd() < 0.5 ? 1 : rnd() < 0.7 ? 2 : 0;
    for (let k = 0; k < perDay; k++) {
      const created = new Date(now - daysAgo * 86_400_000 + Math.floor(rnd() * 10 * 3600_000));
      const pipe = rnd() < 0.5 ? pipes.find((x) => x.name === 'Wedding')! : rnd() < 0.65 ? pipes.find((x) => x.name === 'Non Wedding')! : pipes.find((x) => x.name === 'Retail')!;
      const st = allStages.filter((x) => x.pipelineId === pipe.id).sort((a, b) => a.sortOrder - b.sortOrder);
      const open = st.filter((x) => x.kind === 'open');
      const won = st.find((x) => x.kind === 'won')!;
      const lost = st.find((x) => x.kind === 'lost')!;
      const [evt, pmin, pmax] = pick(events[pipe.name] ?? events.Retail!);
      const pax = Math.round(pmin + rnd() * (pmax - pmin));
      const value = Math.round((pax * (perPax[pipe.name] ?? 50_000)) / 100_000) * 100_000;
      let owner = pick(sales);
      const src = pick(sources);
      // Sebagian order acara non-wedding datang dari pelanggan lama (repeat order, PIC tetap sama).
      const repeat = pipe.name !== 'Wedding' && repeatPool.length && rnd() < 0.3 ? pick(repeatPool) : null;
      let c: { id: string } | undefined;
      if (repeat) {
        repeatPool.splice(repeatPool.indexOf(repeat), 1);
        c = { id: repeat.contactId };
        owner = sales.find((x) => x.id === repeat.ownerId) ?? owner;
      } else {
        const phone = `6289${String(100000000 + made).slice(-9)}`;
        [c] = await db
          .insert(contacts)
          .values({ waPhone: phone, name: `Demo ${made + 1}`, sourceId: src.id, ownerId: owner.id, firstMessageAt: created, lastMessageAt: created, createdAt: created, segment: rnd() < 0.3 ? 'Korporat' : 'Personal' })
          .returning();
      }
      // Nasib lead: makin lama makin pasti selesai
      const r = rnd();
      const fate = daysAgo < 14 ? (r < 0.75 ? 'open' : r < 0.9 ? 'won' : 'lost') : r < 0.22 ? 'won' : r < 0.62 ? 'lost' : 'open';
      const reachOpen = fate === 'won' ? open.length - 1 : Math.floor(rnd() * open.length);
      const finalStage = fate === 'won' ? won : fate === 'lost' ? lost : open[reachOpen]!;
      const closedAt = fate === 'open' ? null : new Date(Math.min(created.getTime() + (3 + rnd() * Math.min(daysAgo - 1, 40)) * 86_400_000, now - 3600_000));
      const eventDate = new Date(created.getTime() + (20 + rnd() * 200) * 86_400_000).toISOString().slice(0, 10);
      const score = Math.min(100, Math.round((fate === 'won' ? 55 : 25) + rnd() * 45));
      const [l] = await db
        .insert(leads)
        .values({
          contactId: c!.id,
          pipelineId: pipe.id,
          stageId: finalStage.id,
          ownerId: owner.id,
          sourceId: src.id,
          origin: 'auto',
          eventType: evt,
          eventDate,
          pax,
          budget: value,
          estimatedValue: value,
          dealValue: fate === 'won' ? value : null,
          dpAmount: fate === 'won' ? Math.round(value * 0.3) : null,
          score,
          temperature: score >= 70 ? 'Hot' : score >= 40 ? 'Warm' : 'Cold',
          potensi: value >= 50_000_000 ? 'Besar' : value >= 15_000_000 ? 'Sedang' : 'Kecil',
          lostKind: fate === 'lost' ? (rnd() < 0.7 ? 'Lost' : 'Abandoned') : null,
          lostReason: fate === 'lost' ? pick(lostR) : null,
          closedAt,
          createdAt: created,
          updatedAt: closedAt ?? created,
          stageChangedAt: closedAt ?? created,
          lastActivityAt: closedAt ?? new Date(created.getTime() + rnd() * 20 * 86_400_000),
        })
        .returning();
      const path = [...open.slice(0, reachOpen + 1), ...(fate === 'open' ? [] : [finalStage])];
      await db.insert(leadStageHistory).values(path.map((x, i) => ({ leadId: l!.id, stageId: x.id, userId: owner.id, at: new Date(created.getTime() + i * 86_400_000) })));
      if (path.some((x) => x.name === 'Proposal') || fate === 'won') {
        await db.insert(proposals).values({ leadId: l!.id, pricePerPax: perPax[pipe.name] ?? 50_000, status: 'sent', createdBy: owner.id, createdAt: new Date(created.getTime() + 2 * 86_400_000) });
      }
      const handoff = new Date(created.getTime() + 10 * 60_000);
      const convVals = { assigneeId: owner.id, aiActive: false, handoffAt: handoff, handoffClaimedAt: handoff, lastInboundAt: created, lastMessageAt: created };
      const [conv] = repeat
        ? await db.update(conversations).set(convVals).where(eq(conversations.contactId, c!.id)).returning()
        : await db.insert(conversations).values({ contactId: c!.id, ...convVals, createdAt: created }).returning();
      await db.insert(messages).values([
        { conversationId: conv!.id, direction: 'in', senderType: 'customer', body: `Halo, mau tanya ${evt.toLowerCase()}`, status: 'received', createdAt: created },
        { conversationId: conv!.id, direction: 'out', senderType: 'user', userId: owner.id, body: 'Halo kak, terima kasih sudah menghubungi Sonokembang', status: 'read', createdAt: new Date(handoff.getTime() + (3 + rnd() * 50) * 60_000) },
      ]);
      if (fate === 'won') {
        repeatPool.push({ contactId: c!.id, ownerId: owner.id });
        await db.update(contacts).set({ contactType: 'Pelanggan' }).where(eq(contacts.id, c!.id));
      }
      made++;
    }
  }
  // Target bulan ini & bulan lalu
  const nowWib = new Date(now + 7 * 3600_000);
  const months = [0, 1, 2].map((i) => {
    const d = new Date(Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth() - i, 1));
    return d.toISOString().slice(0, 7);
  });
  for (const m of months) {
    await db.insert(targets).values({ period: m, scope: 'team', amount: 800_000_000 }).onConflictDoNothing();
    for (const u of sales) await db.insert(targets).values({ period: m, scope: u.id, amount: u.role === 'spv' ? 100_000_000 : 240_000_000 }).onConflictDoNothing();
  }
  void eq;
  console.log(`Riwayat demo dibuat: ${made} lead selama 12 bulan`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const { loadConfig } = await import('../config.js');
    const { createDb } = await import('./client.js');
    const { runMigrations } = await import('./migrate.js');
    const { EventBus } = await import('../lib/events.js');
    const { SecretBox } = await import('../lib/crypto.js');
    const { createWhatsAppProvider } = await import('../whatsapp/index.js');
    const { AiService } = await import('../ai/service.js');
    const config = loadConfig();
    await runMigrations(config.DATABASE_URL);
    const { db, pool } = createDb(config.DATABASE_URL);
    const box = new SecretBox(config.APP_ENCRYPTION_KEY);
    const ctx: Ctx = { config, db, events: new EventBus(), box, wa: createWhatsAppProvider(config), ai: new AiService(db, box) };
    await ensureBaseData(ctx);
    if (process.argv.includes('--demo')) await seedDemo(ctx);
    if (process.argv.includes('--history')) await seedHistory(ctx);
    await pool.end();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

