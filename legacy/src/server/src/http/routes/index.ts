import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../context.js';
import { coreRoutes } from './core.js';
import { inboxRoutes } from './inbox.js';
import { leadRoutes } from './leads.js';
import { workRoutes } from './work.js';
import { aiRoutes } from './ai.js';
import { importRoutes } from './import.js';
import { channelRoutes } from './channels.js';
import { analyticsRoutes } from './analytics.js';
import { customerRoutes } from './customers.js';
import { reportRoutes } from './reports.js';
import { integrationRoutes } from './integrations.js';
import { broadcastRoutes } from './broadcasts.js';
import { formRoutes } from './forms.js';
import { reputationRoutes } from './reputation.js';
import { marketingRoutes } from './marketing.js';

export async function registerRoutes(app: FastifyInstance, ctx: Ctx) {
  coreRoutes(app, ctx);
  inboxRoutes(app, ctx);
  leadRoutes(app, ctx);
  workRoutes(app, ctx);
  aiRoutes(app, ctx);
  importRoutes(app, ctx);
  channelRoutes(app, ctx);
  analyticsRoutes(app, ctx);
  customerRoutes(app, ctx);
  reportRoutes(app, ctx);
  integrationRoutes(app, ctx);
  broadcastRoutes(app, ctx);
  formRoutes(app, ctx);
  reputationRoutes(app, ctx);
  marketingRoutes(app, ctx);
}
