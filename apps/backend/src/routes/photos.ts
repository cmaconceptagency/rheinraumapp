import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { ApiError } from '../errors.js';
import { Scope } from '../services/scope.js';

/** Geschützte Auslieferung privater Fotos. Sichtbar für Ersteller, Admins der Firma und zuständige Bauleiter. */
export async function photoRoutes(app: FastifyInstance, deps: AppDeps) {
  app.addHook('preHandler', deps.authenticate);

  app.get('/:id/file', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const scope = new Scope(req.auth, [id]);
    const { rows } = await deps.db.query(
      `SELECT p.storage_key, p.mime FROM photos p JOIN reports r ON r.id = p.report_id
        WHERE p.id = $1 AND ${scope.records('r')}`,
      scope.params,
    );
    if (!rows[0]) throw new ApiError('NOT_FOUND');
    const data = await deps.storage.read(rows[0].storage_key);
    return reply
      .header('Content-Type', rows[0].mime)
      .header('Cache-Control', 'private, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', 'inline')
      .send(data);
  });
}
