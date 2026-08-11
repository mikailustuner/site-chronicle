import path from 'node:path';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { newId, sha256, type EvidenceRef } from '@sitechronicle/core';
import type { Database } from './db.js';
import { config } from './config.js';

export class ArtifactStore {
  constructor(private readonly database: Database) {}
  async put(input: { auditId: string; pageId?: string; kind: EvidenceRef['kind']; mimeType: string; data: string | Uint8Array; extension: string; pageUrl?: string; selector?: string; metadata?: Record<string,unknown> }): Promise<EvidenceRef> {
    const bytes = typeof input.data === 'string' ? new TextEncoder().encode(input.data) : input.data;
    const digest = sha256(bytes);
    const relativePath = path.join(input.auditId, digest.slice(0,2), `${digest}.${input.extension.replace(/[^a-z0-9]/gi,'').toLowerCase() || 'bin'}`);
    const root = path.resolve(config.artifactsPath); const absolute = path.resolve(root, relativePath);
    if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error('Artifact path escaped root');
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error;if(sha256(await readFile(absolute))!==digest)throw new Error('Existing content-addressed artifact failed its integrity check'); });
    const id = newId('evidence');
    const rows = await this.database<Array<Record<string,unknown>>>`INSERT INTO evidence (id,audit_id,page_id,kind,sha256,mime_type,relative_path,page_url,selector,metadata) VALUES (${id},${input.auditId},${input.pageId ?? null},${input.kind},${digest},${input.mimeType},${relativePath},${input.pageUrl ?? null},${input.selector ?? null},${this.database.json((input.metadata ?? {}) as never)}) RETURNING *`;
    return toEvidence(rows[0]!);
  }
  async removeAudit(auditId:string):Promise<void>{
    if(!/^audit_[a-f0-9]{32}$/.test(auditId))throw new Error('Invalid audit artifact identifier');
    const root=path.resolve(config.artifactsPath);const target=path.resolve(root,auditId);if(!target.startsWith(`${root}${path.sep}`))throw new Error('Artifact removal escaped root');
    const stat=await lstat(target).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error});if(!stat)return;if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Audit artifact target is not a regular directory');await rm(target,{recursive:true,force:false});
  }
}
function toEvidence(row: Record<string,unknown>): EvidenceRef { return { id:String(row.id),kind:row.kind as EvidenceRef['kind'],sha256:String(row.sha256),mimeType:String(row.mime_type),relativePath:String(row.relative_path),...(row.page_url?{pageUrl:String(row.page_url)}:{}),...(row.selector?{selector:String(row.selector)}:{}),metadata:(row.metadata??{}) as Record<string,unknown> }; }
