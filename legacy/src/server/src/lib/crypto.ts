import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM. Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
export class SecretBox {
  private key: Buffer;

  constructor(keyB64: string | undefined) {
    if (keyB64) {
      const k = Buffer.from(keyB64, 'base64');
      if (k.length !== 32) throw new Error('APP_ENCRYPTION_KEY harus 32 byte (base64)');
      this.key = k;
    } else {
      // Hanya untuk development/test. Production wajib mengisi APP_ENCRYPTION_KEY.
      this.key = createHash('sha256').update('sk-crm-dev-only-key').digest();
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
  }

  decrypt(box: string): string {
    const [v, iv, tag, data] = box.split(':');
    if (v !== 'v1' || !iv || !tag || !data) throw new Error('Format data terenkripsi tidak dikenal');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const last4 = (s: string) => (s.length <= 4 ? '••••' : '••••' + s.slice(-4));
