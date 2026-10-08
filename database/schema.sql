-- CRM Sonokembang — skema MySQL/MariaDB
-- Impor lewat phpMyAdmin: pilih database `crm_sonokembang` › tab Import › pilih file ini › Go.
-- Dipakai bersama oleh website (CodeIgniter 3) dan server VPS (Node.js).

SET NAMES utf8mb4;
SET time_zone = '+07:00';

-- ---------- Pengguna ----------
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('sales','marketing','spv','admin') NOT NULL DEFAULT 'sales',
  status ENUM('aktif','cuti','nonaktif') NOT NULL DEFAULT 'aktif',
  phone VARCHAR(30) NULL,
  last_active_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sesi CodeIgniter (driver database)
CREATE TABLE ci_sessions (
  id VARCHAR(128) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  timestamp INT UNSIGNED NOT NULL DEFAULT 0,
  data BLOB NOT NULL,
  PRIMARY KEY (id),
  KEY ci_sessions_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE settings (
  `key` VARCHAR(64) PRIMARY KEY,
  `value` JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(60) NULL,
  data JSON NULL,
  at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY audit_entity_idx (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Pipeline ----------
CREATE TABLE pipelines (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  color VARCHAR(10) NOT NULL DEFAULT '#db6262',
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE stages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pipeline_id INT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  kind ENUM('open','won','lost') NOT NULL DEFAULT 'open',
  probability INT NOT NULL DEFAULT 0,
  sla_days INT NULL,
  CONSTRAINT fk_stage_pipeline FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE lead_sources (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  channel VARCHAR(80) NOT NULL,
  ref_code VARCHAR(40) NULL UNIQUE,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Kontak, percakapan, pesan ----------
CREATE TABLE contacts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  wa_phone VARCHAR(20) NOT NULL UNIQUE,          -- digit saja, 62xxxxxxxx
  name VARCHAR(120) NULL,
  contact_type VARCHAR(40) NOT NULL DEFAULT 'Calon pelanggan',
  email VARCHAR(190) NULL,
  company VARCHAR(120) NULL,
  segment ENUM('Personal','Korporat','Institusi') NULL,
  source_id INT UNSIGNED NULL,
  owner_id INT UNSIGNED NULL,
  first_message_at DATETIME NULL,
  last_message_at DATETIME NULL,
  opt_out_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY contacts_owner_idx (owner_id),
  CONSTRAINT fk_contact_source FOREIGN KEY (source_id) REFERENCES lead_sources(id) ON DELETE SET NULL,
  CONSTRAINT fk_contact_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE conversations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contact_id INT UNSIGNED NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
  assignee_id INT UNSIGNED NULL,
  last_inbound_at DATETIME NULL,
  last_message_at DATETIME NULL,
  last_message_preview VARCHAR(255) NULL,
  awaiting_reply_since DATETIME NULL,          -- pesan customer yang belum dibalas
  unread_count INT NOT NULL DEFAULT 0,
  sla_level INT NOT NULL DEFAULT 0,            -- 0 aman, 1 peringatan, 2 eskalasi ke SPV
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY conv_contact_channel_uq (contact_id, channel),
  KEY conv_last_msg_idx (last_message_at),
  CONSTRAINT fk_conv_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE messages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  direction ENUM('in','out','system') NOT NULL,
  sender_type ENUM('customer','ai','user','system') NOT NULL,
  user_id INT UNSIGNED NULL,
  body TEXT NOT NULL,
  wa_message_id VARCHAR(120) NULL UNIQUE,
  status ENUM('received','queued','sent','delivered','read','failed') NOT NULL,
  error VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY messages_conv_idx (conversation_id, created_at),
  KEY messages_status_idx (status),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Lead ----------
CREATE TABLE leads (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,     -- tampil sebagai L-<id>
  contact_id INT UNSIGNED NOT NULL,
  pipeline_id INT UNSIGNED NOT NULL,
  stage_id INT UNSIGNED NOT NULL,
  owner_id INT UNSIGNED NULL,
  source_id INT UNSIGNED NULL,
  name VARCHAR(200) NOT NULL DEFAULT '',
  customer_name VARCHAR(120) NULL,
  event_type VARCHAR(60) NULL,
  event_date DATE NULL,
  location VARCHAR(160) NULL,
  pax INT NULL,
  budget BIGINT NULL,
  estimated_value BIGINT NULL,
  score INT NOT NULL DEFAULT 0,
  temperature ENUM('Hot','Warm','Cold') NOT NULL DEFAULT 'Cold',
  lost_reason VARCHAR(160) NULL,
  dp_amount BIGINT NULL,
  deal_value BIGINT NULL,
  dp_date DATE NULL,
  closed_at DATETIME NULL,
  stage_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY leads_stage_idx (stage_id),
  KEY leads_owner_idx (owner_id),
  CONSTRAINT fk_lead_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_pipeline FOREIGN KEY (pipeline_id) REFERENCES pipelines(id),
  CONSTRAINT fk_lead_stage FOREIGN KEY (stage_id) REFERENCES stages(id),
  CONSTRAINT fk_lead_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_lead_source FOREIGN KEY (source_id) REFERENCES lead_sources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE activities (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  type VARCHAR(40) NOT NULL,       -- lead_created, stage_change, message_out, note, ...
  title VARCHAR(200) NOT NULL,
  note TEXT NULL,
  at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY activities_lead_idx (lead_id, at),
  CONSTRAINT fk_act_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Tugas & notifikasi ----------
CREATE TABLE tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  kind VARCHAR(40) NOT NULL DEFAULT 'Follow-up',
  due_at DATETIME NOT NULL,
  done_at DATETIME NULL,
  auto TINYINT(1) NOT NULL DEFAULT 0,
  rule_key VARCHAR(60) NULL,
  reminded_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY tasks_user_due_idx (user_id, due_at),
  UNIQUE KEY tasks_rule_uq (lead_id, rule_key),
  CONSTRAINT fk_task_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  link VARCHAR(255) NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY notif_user_idx (user_id, read_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Broadcast (dikirim oleh server VPS) ----------
CREATE TABLE broadcasts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('draft','scheduled','sending','done','cancelled') NOT NULL DEFAULT 'draft',
  scheduled_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE broadcast_recipients (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  broadcast_id INT UNSIGNED NOT NULL,
  contact_id INT UNSIGNED NOT NULL,
  status ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  error VARCHAR(255) NULL,
  sent_at DATETIME NULL,
  UNIQUE KEY br_uq (broadcast_id, contact_id),
  CONSTRAINT fk_br_b FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
  CONSTRAINT fk_br_c FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Catatan tiap kali job cron di VPS berjalan (tampil di menu Server)
CREATE TABLE job_runs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job VARCHAR(40) NOT NULL,
  ok TINYINT(1) NOT NULL,
  info VARCHAR(255) NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NOT NULL,
  KEY job_runs_job_idx (job, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Data awal ----------
-- Login awal: admin@sonokembang.local / admin123  (WAJIB diganti setelah login)
-- 'PLAIN:' hanya untuk login pertama; saat login berhasil langsung diganti hash bcrypt.
INSERT INTO users (name, email, password_hash, role) VALUES
('Administrator', 'admin@sonokembang.local', 'PLAIN:admin123', 'admin');

INSERT INTO pipelines (id, name, color, sort_order) VALUES
(1, 'Wedding', '#db6262', 1), (2, 'Korporat', '#3b82f6', 2), (3, 'Personal', '#10b981', 3);

INSERT INTO stages (pipeline_id, name, sort_order, kind, probability, sla_days) VALUES
(1,'Lead Baru',1,'open',10,1),(1,'Kualifikasi',2,'open',25,3),(1,'Proposal',3,'open',50,5),(1,'Test Food',4,'open',70,7),(1,'DP / Menang',5,'won',100,NULL),(1,'Batal',6,'lost',0,NULL),
(2,'Lead Baru',1,'open',10,1),(2,'Kualifikasi',2,'open',25,3),(2,'Proposal',3,'open',50,5),(2,'DP / Menang',4,'won',100,NULL),(2,'Batal',5,'lost',0,NULL),
(3,'Lead Baru',1,'open',10,1),(3,'Penawaran',2,'open',50,3),(3,'DP / Menang',3,'won',100,NULL),(3,'Batal',4,'lost',0,NULL);

INSERT INTO lead_sources (name, channel, ref_code) VALUES
('WhatsApp langsung','WhatsApp',NULL),('Instagram Ads','Instagram Ads','IG'),('Website','Website','WEB'),('Pameran','Offline',NULL);

INSERT INTO settings (`key`, `value`) VALUES
('sla', JSON_OBJECT('warnMinutes', 15, 'escalateMinutes', 60)),
('reminder', JSON_OBJECT('staleLeadDays', 3));
