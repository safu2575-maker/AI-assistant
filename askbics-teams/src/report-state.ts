import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
export class ReportState {
  constructor(private key: Buffer, private directory = resolve('data/reports')) { if (key.length !== 32) throw new Error('STATE_KEY must be 32 bytes encoded as hex.'); }
  private path(user: string) { return resolve(this.directory, createHash('sha256').update(user).digest('hex') + '.json.enc'); }
  async read(user: string): Promise<unknown> {
    let data: Buffer;
    try { data = await readFile(this.path(user)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12)); decipher.setAAD(Buffer.from(user)); decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
  }
  async write(user: string, state: unknown) {
    const text = JSON.stringify(state); if (!text || text.length > 500_000) throw new Error('Saved settings exceed the size limit.');
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce); cipher.setAAD(Buffer.from(user));
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]); const contents = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    await mkdir(this.directory, { recursive: true }); const file = this.path(user), temp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    await writeFile(temp, contents, { mode: 0o600 }); await rename(temp, file);
  }
}
