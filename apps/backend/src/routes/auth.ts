import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { ApiError } from '../errors.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../auth/crypto.js';
import { tx } from '../db/pool.js';
import { toUser } from '../services/mappers.js';

const REFRESH_COOKIE = 'rr_refresh';
// Gleich lange Prüfung auch für unbekannte E-Mail-Adressen (gegen Benutzer-Enumeration).
const DUMMY_HASH = bcrypt.hashSync(randomToken(), 12);

const password = z.string().min(10, 'Mindestens 10 Zeichen').max(200);

export async function authRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, config, tokens } = deps;
  const isWeb = (req: FastifyRequest) => req.headers['x-client'] === 'web';

  async function issueTokens(req: FastifyRequest, reply: FastifyReply, userId: string) {
    const { rows } = await db.query(
      `SELECT u.*, c.name AS company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1`,
      [userId],
    );
    const u = rows[0];
    const refreshToken = randomToken();
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
      [userId, sha256(refreshToken), config.REFRESH_TOKEN_TTL_DAYS],
    );
    const accessToken = await tokens.sign({ sub: u.id, cid: u.company_id, role: u.role });
    const body: Record<string, unknown> = { accessToken, user: toUser(u) };
    if (isWeb(req)) {
      // Admin-Web: Refresh-Token nur als httpOnly-Cookie, nie für JavaScript lesbar.
      reply.setCookie(REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.NODE_ENV === 'production',
        path: '/api/auth',
        maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400,
      });
    } else {
      // Mobile App: speichert das Refresh-Token im SecureStore (Keychain/Keystore).
      body.refreshToken = refreshToken;
    }
    return body;
  }

  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/login', limited, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const { rows } = await db.query('SELECT id, password_hash, active FROM users WHERE lower(email) = lower($1)', [
      body.email,
    ]);
    const u = rows[0];
    const ok = await verifyPassword(body.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !u.password_hash || !ok) throw new ApiError('INVALID_CREDENTIALS');
    if (!u.active) throw new ApiError('ACCOUNT_INACTIVE');
    return issueTokens(req, reply, u.id);
  });

  app.post('/refresh', limited, async (req, reply) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    const token = body.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (!token) throw new ApiError('UNAUTHORIZED');
    // Rotation: altes Token wird widerrufen; Wiederverwendung eines widerrufenen Tokens sperrt alle Sitzungen.
    const userId = await tx(db, async (client) => {
      const { rows } = await client.query(
        `SELECT rt.id, rt.user_id, rt.revoked_at, rt.expires_at, u.active
           FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
          WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
        [sha256(token)],
      );
      const rt = rows[0];
      if (!rt) return null;
      if (rt.revoked_at) {
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
          rt.user_id,
        ]);
        return null;
      }
      if (rt.expires_at < new Date() || !rt.active) return null;
      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [rt.id]);
      return rt.user_id as string;
    });
    if (!userId) throw new ApiError('UNAUTHORIZED');
    return issueTokens(req, reply, userId);
  });

  app.post('/logout', async (req, reply) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    const token = body.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (token) await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  /** Einladung annehmen: E-Mail + Einladungscode + neues Passwort. */
  app.post('/accept-invite', limited, async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), code: z.string().min(6).max(64), password })
      .parse(req.body);
    const code = body.code.trim().toUpperCase();
    const passwordHash = await hashPassword(body.password);
    const userId = await tx(db, async (client) => {
      const { rows } = await client.query(
        `SELECT i.id, i.user_id FROM invites i JOIN users u ON u.id = i.user_id
          WHERE i.token_hash = $1 AND lower(u.email) = lower($2) AND i.used_at IS NULL
            AND i.expires_at > now() AND u.active
          FOR UPDATE OF i`,
        [sha256(code), body.email],
      );
      const invite = rows[0];
      if (!invite) return null;
      await client.query('UPDATE invites SET used_at = now() WHERE id = $1', [invite.id]);
      await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
        invite.user_id,
        passwordHash,
      ]);
      return invite.user_id as string;
    });
    if (!userId) throw new ApiError('INVITE_INVALID');
    return issueTokens(req, reply, userId);
  });
}
