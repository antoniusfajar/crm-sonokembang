ALTER TABLE "wa_templates" ADD COLUMN "var_map" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Template bawaan: isi variabel otomatis dari data CRM.
UPDATE "wa_templates" SET "var_map" = '["customer.firstName","sender.firstName"]'::jsonb WHERE "name" = 'follow_up_umum' AND "var_map" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "wa_templates" SET "var_map" = '["customer.firstName",""]'::jsonb WHERE "name" IN ('promo_menu_baru', 'penawaran_musiman') AND "var_map" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "wa_templates" SET "var_map" = '["customer.firstName","review.link"]'::jsonb WHERE "name" = 'minta_ulasan_google' AND "var_map" = '[]'::jsonb;
