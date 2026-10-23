import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@rheinraum/shared';

export interface AccessClaims {
  sub: string;
  cid: string;
  role: Role;
}

export class TokenService {
  private key: Uint8Array;
  constructor(
    secret: string,
    private ttlMin: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  sign(claims: AccessClaims): Promise<string> {
    return new SignJWT({ cid: claims.cid, role: claims.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('rheinraum')
      .setExpirationTime(`${this.ttlMin}m`)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.key, { issuer: 'rheinraum', algorithms: ['HS256'] });
    return { sub: String(payload.sub), cid: String(payload.cid), role: payload.role as Role };
  }
}
