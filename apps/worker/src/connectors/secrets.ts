import { createDecipheriv, createHash } from 'node:crypto';
import { config } from '../config.js';

function key(): Buffer {
  if (!config.connectorMasterKey) throw new Error('CONNECTOR_MASTER_KEY is not configured on the worker');
  return createHash('sha256').update(config.connectorMasterKey, 'utf8').digest();
}

export interface ConnectorCredentials extends Record<string, string> { apiKey: string; login: string; password: string }

export function decryptCredentials(value: string): ConnectorCredentials {
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported encrypted credential payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as ConnectorCredentials;
}
