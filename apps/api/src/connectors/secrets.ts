import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

function key(): Buffer {
  if (!config.connectorMasterKey) {
    throw Object.assign(new Error('CONNECTOR_MASTER_KEY is required to store connector credentials'), { statusCode: 503 });
  }
  return createHash('sha256').update(config.connectorMasterKey, 'utf8').digest();
}

export function encryptCredentials(value: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function credentialHint(value: Record<string, string>): string | null {
  const secret = value.apiKey ?? value.password ?? value.login ?? Object.values(value)[0];
  return secret ? `••••${secret.slice(-4)}` : null;
}

export function decryptCredentials(value: string): Record<string, string> {
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported encrypted credential payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as Record<string, string>;
}
