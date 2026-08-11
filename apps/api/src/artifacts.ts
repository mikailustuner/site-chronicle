import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newId, sha256, type EvidenceRef } from '@sitechronicle/core';
import type { Database } from './db.js';
import { config } from './config.js';

export class ArtifactStore {
  constructor(private readonly database: Database, private readonly root = config.artifactsPath) {}

  async put(input: {
    auditId: string;
    pageId?: string;
    kind: EvidenceRef['kind'];
    mimeType: string;
    data: string | Uint8Array;
    extension: string;
    pageUrl?: string;
    selector?: string;
    metadata?: Record<string, unknown>;
  }): Promise<EvidenceRef> {
    const bytes = typeof input.data === 'string' ? new TextEncoder().encode(input.data) : input.data;
    const digest = sha256(bytes);
    const relativePath = path.join(input.auditId, digest.slice(0, 2), `${digest}.${sanitizeExtension(input.extension)}`);
    const absolutePath = this.resolve(relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const existing = await this.database<Array<Record<string, unknown>>>`
      SELECT * FROM evidence WHERE audit_id = ${input.auditId} AND sha256 = ${digest} AND kind = ${input.kind} LIMIT 1
    `;
    if (existing[0]) return rowToEvidence(existing[0]);
    const id = newId('evidence');
    const rows = await this.database<Array<Record<string, unknown>>>`
      INSERT INTO evidence (id, audit_id, page_id, kind, sha256, mime_type, relative_path, page_url, selector, metadata)
      VALUES (${id}, ${input.auditId}, ${input.pageId ?? null}, ${input.kind}, ${digest}, ${input.mimeType}, ${relativePath}, ${input.pageUrl ?? null}, ${input.selector ?? null}, ${this.database.json((input.metadata ?? {}) as never)})
      RETURNING *
    `;
    return rowToEvidence(rows[0]!);
  }

  async read(relativePath: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(relativePath)));
  }

  resolve(relativePath: string): string {
    const root = path.resolve(this.root);
    const target = path.resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid artifact path');
    return target;
  }
}

function sanitizeExtension(value: string): string {
  const clean = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean || 'bin';
}

function rowToEvidence(row: Record<string, unknown>): EvidenceRef {
  return {
    id: String(row.id), kind: row.kind as EvidenceRef['kind'], sha256: String(row.sha256),
    mimeType: String(row.mime_type), relativePath: String(row.relative_path),
    ...(row.page_url ? { pageUrl: String(row.page_url) } : {}),
    ...(row.selector ? { selector: String(row.selector) } : {}),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}
