import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@rheinraum/shared';
import { ApiError } from '../errors.js';
import type { Db } from '../db/pool.js';
import type { TokenService } from './tokens.js';

export interface AuthUser {
  id: string;
  companyId: string;
  role: Role;
  hrAccess: boolean;
  firstName: string;
  lastName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthUser;
  }
}

/**
 * Prüft das Access-Token und lädt den Benutzer bei jeder Anfrage frisch aus der Datenbank,
 * damit Deaktivierungen und Rollenänderungen sofort wirken.
 */
export function makeAuthenticate(db: Db, tokens: TokenService) {
  return async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new ApiError('UNAUTHORIZED');
    let claims;
    try {
      claims = await tokens.verify(header.slice(7));
    } catch {
      throw new ApiError('UNAUTHORIZED');
    }
    const { rows } = await db.query(
      `SELECT id, company_id, role, hr_access, active, first_name, last_name FROM users WHERE id = $1`,
      [claims.sub],
    );
    const u = rows[0];
    if (!u || !u.active || u.company_id !== claims.cid) throw new ApiError('UNAUTHORIZED');
    req.auth = {
      id: u.id,
      companyId: u.company_id,
      role: u.role,
      hrAccess: u.hr_access,
      firstName: u.first_name,
      lastName: u.last_name,
    };
  };
}

export function requireRole(...roles: Role[]) {
  return async function (req: FastifyRequest): Promise<void> {
    if (!roles.includes(req.auth.role)) throw new ApiError('FORBIDDEN');
  };
}

/** Krankmeldungen und Wohnadressen: nur Administratoren mit ausdrücklicher HR-Berechtigung. */
export async function requireHrAccess(req: FastifyRequest): Promise<void> {
  if (req.auth.role !== 'admin' || !req.auth.hrAccess) throw new ApiError('FORBIDDEN');
}
