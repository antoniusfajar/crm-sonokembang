import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  serial,
  index,
  uniqueIndex,
  date,
  primaryKey,
  doublePrecision,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ---------- Pengguna, peran, sesi ----------

export const roleEnum = pgEnum('role', ['sales', 'marketing', 'spv', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['aktif', 'cuti', 'nonaktif']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  status: userStatusEnum('status').notNull().default('aktif'),
  phone: text('phone'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  lastActiveAt: ts('last_active_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256 dari token cookie
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const loginLogs = pgTable('login_logs', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  success: boolean('success').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  at: createdAt(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  data: jsonb('data'),
  at: createdAt(),
}, (t) => [index('audit_entity_idx').on(t.entity, t.entityId)]);

// Hak akses menu & cakupan data per peran (Pengaturan › Peran & akses)
export const roleSettings = pgTable('role_settings', {
  role: roleEnum('role').primaryKey(),
  menus: jsonb('menus').$type<Record<string, boolean>>().notNull(),
  scope: text('scope').$type<'own' | 'all'>().notNull().default('all'),
});

// Pengaturan umum key → value (profil bisnis, jam kerja, SLA, distribusi, AI, dll.)
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

// ---------- Pipeline ----------

export const stageKindEnum = pgEnum('stage_kind', ['open', 'won', 'lost']);

export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#db6262'),
  sortOrder: integer('sort_order').notNull().default(0),
  targetShare: integer('target_share').notNull().default(0), // persen porsi target omzet
  eventTypes: jsonb('event_types').$type<string[]>().notNull().default([]), // dipakai untuk memilih pipeline otomatis
  active: boolean('active').notNull().default(true),
});

export const stages = pgTable('stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  kind: stageKindEnum('kind').notNull().default('open'),
  probability: integer('probability').notNull().default(0),
  slaDays: integer('sla_days'),
  // Syarat wajib sebelum kartu boleh pindah ke tahap ini
  requirements: jsonb('requirements').$type<string[]>().notNull().default([]),
}, (t) => [index('stages_pipeline_idx').on(t.pipelineId)]);

// ---------- Sumber lead ----------

export const leadSources = pgTable('lead_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  channel: text('channel').notNull(), // mis. "Instagram Ads", "Website", "Pameran"
  refCode: text('ref_code'), // penanda di pesan pertama / link WA
  howRecorded: text('how_recorded'),
  offline: boolean('offline').notNull().default(false),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('lead_sources_ref_uq').on(t.refCode)]);

// ---------- Kontak, percakapan, pesan ----------

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  waPhone: text('wa_phone').notNull(), // digit saja, format 62xxxxxxxx
  name: text('name'),
  contactType: text('contact_type').notNull().default('Calon pelanggan'),
  email: text('email'),
  company: text('company'),
  segment: text('segment').$type<'Personal' | 'Korporat' | 'Institusi'>(),
  sourceId: uuid('source_id').references(() => leadSources.id, { onDelete: 'set null' }),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  firstMessageAt: ts('first_message_at'),
  lastMessageAt: ts('last_message_at'),
  // Fase 3: broadcast & atribusi iklan
  optOutAt: ts('opt_out_at'), // balas STOP → tidak dikirimi broadcast lagi
  lastBroadcastAt: ts('last_broadcast_at'),
  adRefId: text('ad_ref_id'), // id iklan dari click-to-WhatsApp (referral.source_id)
  legacyId: text('legacy_id'), // contact_id di CRM lama — untuk mencocokkan impor riwayat chat
  createdAt: createdAt(),
}, (t) => [uniqueIndex('contacts_wa_uq').on(t.waPhone), index('contacts_owner_idx').on(t.ownerId), index('contacts_legacy_idx').on(t.legacyId)]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull().default('whatsapp'),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  aiActive: boolean('ai_active').notNull().default(true),
  handoffAt: ts('handoff_at'),
  handoffReason: text('handoff_reason'),
  handoffSummary: text('handoff_summary'),
  handoffClaimedAt: ts('handoff_claimed_at'),
  lastInboundAt: ts('last_inbound_at'),
  lastMessageAt: ts('last_message_at'),
  lastMessagePreview: text('last_message_preview'),
  awaitingReplySince: ts('awaiting_reply_since'), // pesan customer yang belum dibalas manusia/AI
  unreadCount: integer('unread_count').notNull().default(0),
  slaLevel: integer('sla_level').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('conversations_contact_channel_uq').on(t.contactId, t.channel),
  index('conversations_assignee_idx').on(t.assigneeId),
  index('conversations_last_msg_idx').on(t.lastMessageAt),
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  direction: text('direction').$type<'in' | 'out' | 'system'>().notNull(),
  senderType: text('sender_type').$type<'customer' | 'ai' | 'user' | 'system'>().notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').$type<'text' | 'template' | 'document' | 'image' | 'system'>().notNull().default('text'),
  body: text('body').notNull().default(''),
  templateName: text('template_name'),
  mediaPath: text('media_path'),
  mediaName: text('media_name'),
  waMessageId: text('wa_message_id'),
  status: text('status').$type<'received' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'held'>().notNull(),
  error: text('error'),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [
  index('messages_conv_idx').on(t.conversationId, t.createdAt),
  uniqueIndex('messages_wa_id_uq').on(t.waMessageId),
]);

// ---------- Lead ----------

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: serial('code'), // tampil sebagai L-2041
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id),
  stageId: uuid('stage_id').notNull().references(() => stages.id),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  sourceId: uuid('source_id').references(() => leadSources.id, { onDelete: 'set null' }),
  origin: text('origin').$type<'auto' | 'manual'>().notNull().default('auto'),
  originNote: text('origin_note'),
  // Nama lead otomatis: [pipeline]_[nama depan]_[tgl acara]_[lokasi] — diisi trigger database
  // (lihat drizzle/0007_lead_name_trigger.sql), selalu ikut berubah bila datanya berubah.
  name: text('name').notNull().default(''),
  // Nama pemesan dari chat/sales; nama kontak tetap nama profil WhatsApp.
  customerName: text('customer_name'),
  // Data kualifikasi
  eventType: text('event_type'),
  eventDate: date('event_date'),
  eventDateText: text('event_date_text'),
  location: text('location'),
  pax: integer('pax'),
  budget: bigint('budget', { mode: 'number' }),
  estimatedValue: bigint('estimated_value', { mode: 'number' }),
  potensi: text('potensi').$type<'Kecil' | 'Sedang' | 'Besar'>(),
  // Perkiraan bulan DP masuk (disimpan tanggal 1); dasar "peluang tahun ini"
  expectedDpMonth: date('expected_dp_month'),
  // Field mana yang diisi AI (untuk label 🤖 AI)
  aiFilled: jsonb('ai_filled').$type<string[]>().notNull().default([]),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  score: integer('score').notNull().default(0),
  scoreBreakdown: jsonb('score_breakdown').$type<{ label: string; pts: number }[]>().notNull().default([]),
  temperature: text('temperature').$type<'Hot' | 'Warm' | 'Cold'>().notNull().default('Cold'),
  // Penutupan
  lostKind: text('lost_kind').$type<'Lost' | 'Abandoned'>(),
  lostReason: text('lost_reason'),
  lostNote: text('lost_note'),
  dpAmount: bigint('dp_amount', { mode: 'number' }),
  // Nilai total order saat closing = omzet (sampai sinkron Ecount tersedia)
  dealValue: bigint('deal_value', { mode: 'number' }),
  reviewRequestedAt: ts('review_requested_at'), // Fase 3: permintaan ulasan Google H+1 setelah acara
  dpDate: date('dp_date'),
  dpProofPath: text('dp_proof_path'),
  closedAt: ts('closed_at'),
  stageChangedAt: ts('stage_changed_at').notNull().defaultNow(),
  lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  index('leads_contact_idx').on(t.contactId),
  index('leads_stage_idx').on(t.stageId),
  index('leads_owner_idx').on(t.ownerId),
  uniqueIndex('leads_code_uq').on(t.code),
]);

export const leadStageHistory = pgTable('lead_stage_history', {
  id: serial('id').primaryKey(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  stageId: uuid('stage_id').notNull().references(() => stages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  at: createdAt(),
}, (t) => [index('lsh_lead_idx').on(t.leadId)]);

export const activities = pgTable('activities', {
  id: serial('id').primaryKey(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  type: text('type').notNull(), // message_out, proposal_sent, stage_change, test_food, dp, handoff, lead_created
  title: text('title').notNull(),
  note: text('note'),
  at: createdAt(),
}, (t) => [index('activities_lead_idx').on(t.leadId, t.at)]);

export const notes = pgTable('notes', {
  id: serial('id').primaryKey(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, (t) => [index('notes_contact_idx').on(t.contactId)]);

export const testFoods = pgTable('test_foods', {
  id: serial('id').primaryKey(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  scheduledAt: ts('scheduled_at').notNull(),
  place: text('place'),
  people: integer('people'),
  result: text('result'), // catatan hasil
  // Hasil terstruktur (prototype v16): menu yang dicoba, rating 1–5, keputusan customer
  menus: jsonb('menus').$type<string[]>().notNull().default([]),
  rating: integer('rating'),
  decision: text('decision').$type<'lanjut' | 'revisi' | 'belum'>(),
  resultAt: ts('result_at'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

// ---------- Custom field ----------

export const customFields = pgTable('custom_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity: text('entity').$type<'lead' | 'contact'>().notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  type: text('type').$type<'text' | 'number' | 'date' | 'select' | 'boolean'>().notNull(),
  options: jsonb('options').$type<string[]>().notNull().default([]),
  required: boolean('required').notNull().default(false),
  aiFillable: boolean('ai_fillable').notNull().default(false),
  showInTable: boolean('show_in_table').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('custom_fields_entity_key_uq').on(t.entity, t.key)]);

// ---------- Template & snippet ----------

export const snippets = pgTable('snippets', {
  id: uuid('id').primaryKey().defaultRandom(),
  folder: text('folder').notNull().default('Umum'),
  name: text('name').notNull(),
  shortcut: text('shortcut').notNull(),
  body: text('body').notNull(),
  useCount: integer('use_count').notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('snippets_shortcut_uq').on(t.shortcut)]);

export const proposalTemplates = pgTable('proposal_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  segment: text('segment').notNull().default(''),
  sections: jsonb('sections').$type<{ title: string; body: string }[]>().notNull().default([]),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const proposals = pgTable('proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  templateId: uuid('template_id').references(() => proposalTemplates.id, { onDelete: 'set null' }),
  pricePerPax: bigint('price_per_pax', { mode: 'number' }).notNull(),
  discountPct: integer('discount_pct').notNull().default(0),
  needsApproval: boolean('needs_approval').notNull().default(false),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  filePath: text('file_path'),
  status: text('status').$type<'draft' | 'waiting_approval' | 'sent'>().notNull().default('draft'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const waTemplates = pgTable('wa_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  language: text('language').notNull().default('id'),
  category: text('category').notNull().default('UTILITY'),
  body: text('body').notNull(),
  folder: text('folder').notNull().default('Umum'),
  status: text('status').$type<'APPROVED' | 'PENDING' | 'REJECTED' | 'LOCAL'>().notNull().default('LOCAL'),
  // Isi otomatis tiap {{n}}: varMap[n-1] = kunci field CRM (lihat services/templates.ts), '' = diketik manual
  varMap: jsonb('var_map').$type<string[]>().notNull().default([]),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('wa_templates_name_lang_uq').on(t.name, t.language)]);

// ---------- Tugas & notifikasi ----------

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('Follow-up'),
  dueAt: ts('due_at').notNull(),
  doneAt: ts('done_at'),
  auto: boolean('auto').notNull().default(false),
  ruleKey: text('rule_key'), // supaya aturan pengingat tidak membuat tugas ganda
  remindedAt: ts('reminded_at'), // notifikasi "sebentar lagi jatuh tempo" sudah dikirim
  createdAt: createdAt(),
}, (t) => [
  index('tasks_user_due_idx').on(t.userId, t.dueAt),
  uniqueIndex('tasks_rule_uq').on(t.leadId, t.ruleKey),
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'sla' | 'lead' | 'ai' | 'tugas' | 'sistem'>().notNull(),
  text: text('text').notNull(),
  link: text('link'),
  readAt: ts('read_at'),
  createdAt: createdAt(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)]);

// ---------- AI ----------

export const promptVersions = pgTable('prompt_versions', {
  id: serial('id').primaryKey(),
  version: integer('version').notNull(),
  content: text('content').notNull(),
  note: text('note'),
  active: boolean('active').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const aiCalls = pgTable('ai_calls', {
  id: serial('id').primaryKey(),
  task: text('task').notNull(), // responder, extract, guard, summary, test
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costIdr: integer('cost_idr').notNull().default(0),
  ok: boolean('ok').notNull(),
  error: text('error'),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  at: createdAt(),
}, (t) => [index('ai_calls_at_idx').on(t.at)]);

export const guardrailLogs = pgTable('guardrail_logs', {
  id: serial('id').primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  layer: integer('layer').notNull(),
  reason: text('reason').notNull(),
  text: text('text').notNull(),
  at: createdAt(),
}, (t) => [index('guardrail_at_idx').on(t.at)]);

// ---------- Antrian job (dipakai worker) ----------

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  runAt: ts('run_at').notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  status: text('status').$type<'pending' | 'running' | 'done' | 'failed'>().notNull().default('pending'),
  lastError: text('last_error'),
  createdAt: createdAt(),
}, (t) => [index('jobs_pending_idx').on(t.status, t.runAt)]);

// ---------- Import data ----------

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').$type<'contacts' | 'leads' | 'snippets' | 'chats'>().notNull(),
  filename: text('filename').notNull(),
  status: text('status').$type<'preview' | 'done' | 'cancelled'>().notNull().default('preview'),
  rows: jsonb('rows').$type<Record<string, string>[]>().notNull(),
  mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
  result: jsonb('result').$type<Record<string, unknown>>(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

// Bobot distribusi lead per sales
export const distributionMembers = pgTable('distribution_members', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull().default('default'),
  weight: integer('weight').notNull().default(1),
  included: boolean('included').notNull().default(true),
  assignedCount: integer('assigned_count').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.channel] })]);

// Langganan web push (notifikasi ke HP/laptop) per pengguna & perangkat
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  keys: jsonb('keys').$type<{ p256dh: string; auth: string }>().notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  lastOkAt: ts('last_ok_at'),
}, (t) => [uniqueIndex('push_endpoint_uq').on(t.endpoint), index('push_user_idx').on(t.userId)]);

// Target omzet per bulan. scope = 'team' atau id pengguna (sales).
export const targets = pgTable('targets', {
  period: text('period').notNull(), // YYYY-MM
  scope: text('scope').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.period, t.scope] })]);

// Laporan AI (PDF / PPTX)
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  periodLabel: text('period_label').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  audience: text('audience').notNull(),
  format: text('format').$type<'pdf' | 'pptx'>().notNull(),
  notes: text('notes'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  narrative: jsonb('narrative').$type<{ summary: string; findings: string[]; recommendations: string[] }>().notNull(),
  aiUsed: boolean('ai_used').notNull().default(false),
  filePath: text('file_path'),
  scheduleId: uuid('schedule_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [index('reports_created_idx').on(t.createdAt)]);

export const reportSchedules = pgTable('report_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  audience: text('audience').notNull(),
  format: text('format').$type<'pdf' | 'pptx'>().notNull(),
  frequency: text('frequency').$type<'monthly' | 'weekly'>().notNull(),
  dayOfMonth: integer('day_of_month').notNull().default(1),
  dayOfWeek: integer('day_of_week').notNull().default(1), // 0 = Minggu
  time: text('time').notNull().default('07:00'),
  recipientIds: jsonb('recipient_ids').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  lastRunAt: ts('last_run_at'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

// ---------- Fase 3: integrasi platform & pemasaran ----------

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(), // meta_ads | instagram | facebook | tiktok | gbp | ga4 | gsc | uptime
  accountId: text('account_id').notNull(), // id di platform (act_123, id IG, properties/123, sc-domain:..., locations/..)
  accountName: text('account_name').notNull(),
  accountType: text('account_type'),
  status: text('status').$type<'connected' | 'error' | 'disconnected'>().notNull().default('connected'),
  syncOn: boolean('sync_on').notNull().default(true),
  credEnc: text('cred_enc'), // token terenkripsi (AES-GCM), tidak pernah dikirim ke browser
  expiresAt: ts('expires_at'),
  lastSyncAt: ts('last_sync_at'),
  lastError: text('last_error'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  connectedBy: uuid('connected_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('integrations_provider_account_uq').on(t.provider, t.accountId)]);

/** Angka harian dari platform (pengunjung web, impresi, belanja iklan per kampanye, dst.). */
export const metricDaily = pgTable('metric_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  // id koneksi (integrations.id) supaya dua properti/akun sejenis tidak saling menimpa; '' = manual/lainnya
  account: text('account').notNull().default(''),
  metric: text('metric').notNull(),
  dim: text('dim').notNull().default(''), // mis. id kampanye, halaman, kata kunci, sumber trafik
  day: date('day').notNull(),
  value: doublePrecision('value').notNull(),
  manual: boolean('manual').notNull().default(false),
}, (t) => [uniqueIndex('metric_daily_uq').on(t.provider, t.account, t.metric, t.dim, t.day), index('metric_daily_day_idx').on(t.day)]);

export const adCampaigns = pgTable('ad_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  integrationId: uuid('integration_id').references(() => integrations.id, { onDelete: 'set null' }),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
  objective: text('objective'),
  status: text('status').notNull().default('ACTIVE'),
  adIds: jsonb('ad_ids').$type<string[]>().notNull().default([]),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('ad_campaigns_ext_uq').on(t.externalId)]);

export const socialPosts = pgTable('social_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(), // instagram | tiktok | facebook
  externalId: text('external_id').notNull(),
  caption: text('caption').notNull().default(''),
  mediaType: text('media_type'),
  permalink: text('permalink'),
  publishedAt: ts('published_at').notNull(),
  likes: integer('likes').notNull().default(0),
  comments: integer('comments').notNull().default(0),
  shares: integer('shares').notNull().default(0),
  saves: integer('saves').notNull().default(0),
  views: integer('views').notNull().default(0),
  impressions: integer('impressions').notNull().default(0),
  reach: integer('reach').notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('social_posts_uq').on(t.provider, t.externalId), index('social_posts_pub_idx').on(t.publishedAt)]);

export const postSchedules = pgTable('post_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  platforms: jsonb('platforms').$type<string[]>().notNull(),
  caption: text('caption').notNull(),
  mediaPath: text('media_path'),
  mediaName: text('media_name'),
  scheduledAt: ts('scheduled_at').notNull(),
  status: text('status').$type<'scheduled' | 'published' | 'partial' | 'failed' | 'manual' | 'cancelled'>().notNull().default('scheduled'),
  results: jsonb('results').$type<Record<string, { ok: boolean; id?: string; error?: string }>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [index('post_schedules_at_idx').on(t.scheduledAt)]);

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull().default('gbp'), // gbp | manual
  externalId: text('external_id').notNull(),
  author: text('author').notNull().default('Anonim'),
  rating: integer('rating').notNull(),
  text: text('text').notNull().default(''),
  reviewedAt: ts('reviewed_at').notNull(),
  replyText: text('reply_text'),
  repliedAt: ts('replied_at'),
  replyStatus: text('reply_status').$type<'none' | 'draft' | 'scheduled' | 'sent' | 'failed'>().notNull().default('none'),
  replyDueAt: ts('reply_due_at'), // balasan AI otomatis dikirim pada waktu ini (bisa dibatalkan SPV)
  replyError: text('reply_error'),
  sentiment: text('sentiment').$type<'positif' | 'netral' | 'negatif'>(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('reviews_ext_uq').on(t.provider, t.externalId), index('reviews_at_idx').on(t.reviewedAt)]);

export const competitors = pgTable('competitors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  mapsUrl: text('maps_url'),
  rating: doublePrecision('rating'),
  reviewCount: integer('review_count'),
  notes: text('notes'), // kutipan ulasan publik yang ditempel, bahan analisa AI
  analysis: jsonb('analysis').$type<{ strengths: string[]; weaknesses: string[]; opportunities: string[] } | null>(),
  analyzedAt: ts('analyzed_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  createdAt: createdAt(),
});

export const broadcasts = pgTable('broadcasts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  segment: jsonb('segment').$type<Record<string, unknown>>().notNull(),
  segmentLabel: text('segment_label').notNull(),
  templateName: text('template_name').notNull(),
  templateLanguage: text('template_language').notNull().default('id'),
  params: jsonb('params').$type<string[]>().notNull().default([]),
  scheduledAt: ts('scheduled_at').notNull(),
  status: text('status').$type<'scheduled' | 'sending' | 'done' | 'cancelled' | 'failed'>().notNull().default('scheduled'),
  costPerMsg: integer('cost_per_msg').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
  createdAt: createdAt(),
}, (t) => [index('broadcasts_sched_idx').on(t.scheduledAt)]);

export const broadcastRecipients = pgTable('broadcast_recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  broadcastId: uuid('broadcast_id').notNull().references(() => broadcasts.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  status: text('status').$type<'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped'>().notNull().default('queued'),
  skipReason: text('skip_reason'),
  waMessageId: text('wa_message_id'),
  error: text('error'),
  sentAt: ts('sent_at'),
  repliedAt: ts('replied_at'),
  replyText: text('reply_text'),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
}, (t) => [uniqueIndex('broadcast_recipients_uq').on(t.broadcastId, t.contactId), index('broadcast_recipients_wa_idx').on(t.waMessageId), index('broadcast_recipients_contact_idx').on(t.contactId)]);

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'phone' | 'email' | 'number' | 'date' | 'select' | 'textarea';
  required: boolean;
  options?: string[];
  mapTo: string | null; // name | phone | email | company | eventType | eventDate | location | pax | budget | note | custom:<key> | null
}

export const forms = pgTable('forms', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  status: text('status').$type<'active' | 'draft' | 'archived'>().notNull().default('draft'),
  purpose: text('purpose').$type<'lead' | 'other'>().notNull().default('lead'),
  fields: jsonb('fields').$type<FormField[]>().notNull().default([]),
  sourceId: uuid('source_id').references(() => leadSources.id, { onDelete: 'set null' }),
  settings: jsonb('settings').$type<{ title?: string; intro?: string; thankYou?: string; submitLabel?: string; notifyUserIds?: string[]; createTask?: boolean; waTemplate?: string | null; destination?: string }>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('forms_slug_uq').on(t.slug)]);

export const formSubmissions = pgTable('form_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  formId: uuid('form_id').notNull().references(() => forms.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  page: text('page'),
  utm: jsonb('utm').$type<Record<string, string>>(),
  createdAt: createdAt(),
}, (t) => [index('form_submissions_form_idx').on(t.formId, t.createdAt)]);
