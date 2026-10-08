-- Nama lead otomatis: [pipeline]_[nama depan]_[tgl acara]_[lokasi].
-- Nama depan diambil dari nama pemesan (lead.customer_name), atau nama profil WhatsApp kontak.
-- Sapaan (Bu, Pak, Mbak, Kak, ...) dan emoji dibuang. Bagian yang kosong dilewati.
CREATE OR REPLACE FUNCTION sk_lead_name(p_pipeline uuid, p_contact uuid, p_customer text, p_date date, p_date_text text, p_location text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  pipe text;
  cname text;
  cphone text;
  first text;
  d text;
  loc text;
  parts text[] := '{}';
  months text[] := ARRAY['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
BEGIN
  SELECT name INTO pipe FROM pipelines WHERE id = p_pipeline;
  SELECT name, wa_phone INTO cname, cphone FROM contacts WHERE id = p_contact;
  first := coalesce(nullif(btrim(p_customer), ''), nullif(btrim(cname), ''), '');
  first := regexp_replace(first, '[^[:alpha:][:space:]''-]', ' ', 'g');
  first := btrim(regexp_replace(first, '\s+', ' ', 'g'));
  first := regexp_replace(first, '^(ibu|bu|bapak|pak|mbak|mba|mas|kak|kakak|bunda|mama|mami|papa|papi|om|tante|mr|mrs|ms|miss|dr|drg|hj|h|ir)\s+', '', 'i');
  first := split_part(first, ' ', 1);
  IF first = '' THEN
    first := 'Customer ' || right(coalesce(cphone, ''), 4);
  ELSE
    first := initcap(first);
  END IF;
  parts := array_append(parts, coalesce(pipe, 'Lead'));
  parts := array_append(parts, first);
  IF p_date IS NOT NULL THEN
    d := extract(day FROM p_date)::int || ' ' || months[extract(month FROM p_date)::int] || ' ' || extract(year FROM p_date)::int;
  ELSIF nullif(btrim(p_date_text), '') IS NOT NULL THEN
    d := left(btrim(p_date_text), 25);
  END IF;
  IF d IS NOT NULL THEN
    parts := array_append(parts, d);
  END IF;
  loc := left(btrim(split_part(coalesce(p_location, ''), ',', 1)), 40);
  IF loc <> '' THEN
    parts := array_append(parts, loc);
  END IF;
  RETURN array_to_string(parts, '_');
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sk_leads_set_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.name := sk_lead_name(NEW.pipeline_id, NEW.contact_id, NEW.customer_name, NEW.event_date, NEW.event_date_text, NEW.location);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER leads_set_name BEFORE INSERT OR UPDATE OF pipeline_id, contact_id, customer_name, event_date, event_date_text, location ON leads
FOR EACH ROW EXECUTE FUNCTION sk_leads_set_name();
--> statement-breakpoint
-- Nama profil WA kontak atau nama pipeline berubah → nama lead ikut diperbarui.
CREATE OR REPLACE FUNCTION sk_refresh_lead_names() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'contacts' THEN
    UPDATE leads SET name = sk_lead_name(pipeline_id, contact_id, customer_name, event_date, event_date_text, location) WHERE contact_id = NEW.id;
  ELSE
    UPDATE leads SET name = sk_lead_name(pipeline_id, contact_id, customer_name, event_date, event_date_text, location) WHERE pipeline_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER contacts_refresh_lead_names AFTER UPDATE OF name, wa_phone ON contacts
FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.wa_phone IS DISTINCT FROM NEW.wa_phone) EXECUTE FUNCTION sk_refresh_lead_names();
--> statement-breakpoint
CREATE TRIGGER pipelines_refresh_lead_names AFTER UPDATE OF name ON pipelines
FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION sk_refresh_lead_names();
--> statement-breakpoint
UPDATE leads SET name = sk_lead_name(pipeline_id, contact_id, customer_name, event_date, event_date_text, location);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leads_name_idx ON leads (name);
