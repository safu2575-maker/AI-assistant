import { createHash, randomBytes } from 'node:crypto';
import { ReportState } from './report-state.js';
export const REMEMBER_MS = 15 * 24 * 60 * 60 * 1000;
export class SignInRequired extends Error {}
export type RememberedIdentity = { identity: string; token: string; refreshToken: string; accessExpires: number; expires: number };
type Config = { clientId: string; clientSecret: string; tenantId: string };
/** Device secrets are opaque bearer credentials. Only their hashes identify encrypted files.
 * Entra access/refresh tokens never leave the server. Absolute expiry is not extended by use. */
export class RememberedSessions {
  private locks = new Map<string, Promise<unknown>>();
  constructor(private storage: ReportState, private config: Config, private fetcher: typeof fetch = fetch, private now = Date.now) {}
  private key(secret: unknown) {
    if (typeof secret !== 'string' || !/^[\w-]{43}$/.test(secret)) throw new SignInRequired('Sign in to continue.');
    return `remembered:${createHash('sha256').update(secret).digest('hex')}`;
  }
  private async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const promise = (this.locks.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    this.locks.set(key, promise);
    try { return await promise; } finally { if (this.locks.get(key) === promise) this.locks.delete(key); }
  }
  async create(identity: string, token: string, refreshToken: string, accessExpires: number) {
    const secret = randomBytes(32).toString('base64url'), expires = this.now() + REMEMBER_MS;
    await this.storage.write(this.key(secret), { identity, token, refreshToken, accessExpires, expires });
    return { secret, expires };
  }
  async revoke(secret: unknown) {
    const key = this.key(secret);
    await this.locked(key, async () => { if (await this.storage.read(key)) await this.storage.write(key, { revoked: true }); });
  }
  async get(secret: unknown): Promise<RememberedIdentity> {
    const key = this.key(secret);
    return this.locked(key, async () => {
      const value = await this.storage.read(key) as RememberedIdentity | null;
      if (!value || !value.identity?.startsWith(this.config.tenantId + ':') || !value.refreshToken || value.expires <= this.now()) {
        if (value) await this.storage.write(key, { revoked: true });
        throw new SignInRequired('Your remembered sign-in has ended. Please sign in again.');
      }
      if (value.accessExpires > this.now() + 60000) return value;
      const response = await this.fetcher(`https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: 'refresh_token', refresh_token: value.refreshToken }), signal: AbortSignal.timeout(20000)
      });
      const data = await response.json() as any;
      if (!response.ok) {
        if (['invalid_grant', 'interaction_required', 'consent_required'].includes(data.error)) {
          await this.storage.write(key, { revoked: true });
          throw new SignInRequired('Microsoft requires a new sign-in. Your saved reports and connections are still available.');
        }
        throw new Error('Microsoft sign-in is temporarily unavailable. Try again.');
      }
      if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 60) throw new Error('Invalid token renewal response');
      value.token = data.access_token; value.refreshToken = data.refresh_token || value.refreshToken;
      value.accessExpires = this.now() + data.expires_in * 1000;
      await this.storage.write(key, value);
      return value;
    });
  }
}
