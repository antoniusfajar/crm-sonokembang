import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Ctx } from './context.js';
import { registerAuth } from './http/auth.js';
import { HttpError } from './lib/http.js';
import { registerRoutes } from './http/routes/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? { level: process.env.LOG_LEVEL ?? 'info' } : false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  // Simpan body mentah: dibutuhkan untuk memverifikasi tanda tangan webhook Meta.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    if (!(body as Buffer).length) return done(null, {});
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      done(new HttpError(400, 'JSON tidak valid'), undefined);
    }
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  registerAuth(app, ctx);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message, details: err.details });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Data tidak valid', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const status = (err as any).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? 'Terjadi kesalahan di server' : (err as Error).message });
  });

  app.get('/api/health', async () => ({ ok: true, wa: ctx.wa.mode }));
  await registerRoutes(app, ctx);

  // Frontend (hasil build React) + fallback SPA
  const dist = path.resolve(ctx.config.WEB_DIST);
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    await app.register(fstatic, { root: dist, prefix: '/', wildcard: true, index: false });
    app.get('/', (_req, reply) => reply.header('Cache-Control', 'no-cache').sendFile('index.html'));
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.status(404).send({ error: 'Tidak ditemukan' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }
  return app;
}
