import { describe, expect, it } from 'vitest';
import { consumeLoginAttempt, clearLoginAttempts } from '../apps/api/src/security/session.js';
import { analyzeSecurity, inspectTls } from '../apps/worker/src/scanners/security.js';
import { buildLighthouseOptions } from '../apps/worker/src/scanners/lighthouse.js';
import type { CrawledPage } from '../apps/worker/src/crawler.js';

describe('operational security invariants',()=>{
  it('rate limits repeated login attempts and can clear a successful client',()=>{
    const key=`test-${crypto.randomUUID()}`;for(let index=0;index<5;index+=1)expect(consumeLoginAttempt(key)).toBeNull();expect(consumeLoginAttempt(key)).toBeGreaterThan(0);clearLoginAttempts(key);expect(consumeLoginAttempt(key)).toBeNull();clearLoginAttempts(key);
  });

  it('checks every Set-Cookie value rather than accepting one secure cookie for all',()=>{
    const page: CrawledPage={url:'https://example.com',normalizedUrl:'https://example.com/',finalUrl:'https://example.com/',statusCode:200,headers:{},html:'<html></html>',title:'Example title',description:'Description',canonical:'https://example.com/',h1:['Example'],language:'en',robots:'',contentHash:'hash',template:'home',links:[],setCookies:['safe=1; Secure; HttpOnly; SameSite=Lax','unsafe=1']};
    const result=analyzeSecurity({auditId:'audit',pageId:'page',page,headersEvidenceId:'headers'});const cookie=result.findings.filter(finding=>finding.ruleId.startsWith('SEC-COOKIE-'));expect(cookie).toHaveLength(3);expect(cookie.every(finding=>finding.observation.includes('unsafe'))).toBe(true);
  });

  it('treats cleartext HTTP as a failed TLS measurement',async()=>{
    await expect(inspectTls('http://example.com')).rejects.toThrow(/does not use HTTPS/);
  });

  it('keeps Lighthouse form factor and screen emulation aligned',()=>{
    expect(buildLighthouseOptions(1234,'desktop')).toMatchObject({formFactor:'desktop',screenEmulation:{mobile:false,width:1440}});
    expect(buildLighthouseOptions(1234,'mobile')).toMatchObject({formFactor:'mobile',screenEmulation:{mobile:true,width:390}});
  });
});
