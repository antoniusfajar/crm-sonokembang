import type { DB } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export async function audit(db: DB, userId: string | null, action: string, entity: string, entityId?: string | null, data?: unknown) {
  await db.insert(auditLogs).values({ userId, action, entity, entityId: entityId ?? null, data: (data ?? null) as any });
}
