-- Warna pipeline bawaan diganti ke varian yang lolos cek buta warna (hanya bila belum diubah Admin).
UPDATE "pipelines" SET "color" = '#46701a' WHERE "color" = '#6c8f3a';
--> statement-breakpoint
UPDATE "pipelines" SET "color" = '#c8861f' WHERE "color" = '#c9a06a';
