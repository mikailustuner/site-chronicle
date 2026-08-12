import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { AuditCategory, Finding, ScanProfile } from '@sitechronicle/core';
import { api, patch, post } from './api';

type Row = Record<string, any>;
type View =
  | { name: 'dashboard' }
  | { name: 'audits' }
  | { name: 'opportunities' }
  | { name: 'traffic' }
  | { name: 'automations' }
  | { name: 'chat' }
  | { name: 'settings' }
  | { name: 'rules' }
  | { name: 'domain'; id: string }
  | { name: 'audit'; id: string }
  | { name: 'compare'; domainId: string };
type DomainTab = 'overview' | 'opportunities' | 'traffic' | 'history' | 'profiles' | 'automation' | 'ownership' | 'settings';
type AuditTab = 'summary' | 'findings' | 'pages' | 'evidence';

const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [view, setView] = useState<View>(() => parseView());

  useEffect(() => {
    api<{ authenticated: boolean }>('/api/session')
      .then((result) => setAuthenticated(result.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    const handler = () => setView(parseView());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const go = (next: View) => {
    const path = next.name === 'dashboard'
      ? '/'
      : next.name === 'audits'
        ? '/audits'
        : next.name === 'opportunities'
          ? '/opportunities'
          : next.name === 'traffic'
            ? '/traffic'
            : next.name === 'automations'
              ? '/automations'
              : next.name === 'chat'
                ? '/chat'
                : next.name === 'settings'
                  ? '/settings'
        : next.name === 'rules'
          ? '/rules'
          : next.name === 'domain'
            ? `/domains/${next.id}`
            : next.name === 'audit'
              ? `/audits/${next.id}`
              : `/domains/${next.domainId}/compare`;
    history.pushState({}, '', path);
    setView(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (authenticated === null) return <Splash />;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;

  return (
    <Shell view={view} go={go} onLogout={async () => {
      await api('/api/session', { method: 'DELETE' });
      setAuthenticated(false);
    }}>
      {view.name === 'dashboard' ? <Dashboard go={go} />
        : view.name === 'audits' ? <AuditExplorer go={go} />
          : view.name === 'opportunities' ? <OpportunityHub go={go} />
            : view.name === 'traffic' ? <TrafficHub go={go} />
              : view.name === 'automations' ? <AutomationHub go={go} />
                : view.name === 'chat' ? <AIChat go={go} />
                  : view.name === 'settings' ? <SettingsPage go={go} />
          : view.name === 'rules' ? <RuleLibrary />
            : view.name === 'domain' ? <DomainDetail id={view.id} go={go} />
              : view.name === 'audit' ? <AuditDetail id={view.id} go={go} />
                : <Compare domainId={view.domainId} go={go} />}
    </Shell>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/api/session', { password });
      onLogin();
    } catch {
      setError('Authentication failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login">
      <section>
        <Logo />
        <div className="login-card">
          <p className="eyebrow">Private workspace</p>
          <h1>Welcome back.</h1>
          <p className="muted">Your evidence archive and audit history stay on this server.</p>
          <form onSubmit={submit}>
            <label>Password<input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {error && <div className="alert danger">{error}</div>}
            <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Splash() {
  return <main className="splash"><Logo /><span>Loading evidence workspace…</span></main>;
}

function Shell({ children, view, go, onLogout }: { children: ReactNode; view: View; go: (view: View) => void; onLogout: () => void }) {
  const current = view.name === 'domain' || view.name === 'compare' ? 'dashboard' : view.name === 'audit' ? 'audits' : view.name;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav aria-label="Primary navigation">
          <span className="nav-label">Intelligence</span>
          <NavButton active={current === 'dashboard'} icon="grid" onClick={() => go({ name: 'dashboard' })}>Portfolio</NavButton>
          <NavButton active={current === 'opportunities'} icon="spark" onClick={() => go({ name: 'opportunities' })}>Opportunities</NavButton>
          <NavButton active={current === 'traffic'} icon="trend" onClick={() => go({ name: 'traffic' })}>Traffic & vitals</NavButton>
          <NavButton active={current === 'chat'} icon="chat" onClick={() => go({ name: 'chat' })}>AI analyst</NavButton>
          <span className="nav-label">Operations</span>
          <NavButton active={current === 'automations'} icon="clock" onClick={() => go({ name: 'automations' })}>Automations</NavButton>
          <NavButton active={current === 'audits'} icon="pulse" onClick={() => go({ name: 'audits' })}>Audit history</NavButton>
          <NavButton active={current === 'rules'} icon="book" onClick={() => go({ name: 'rules' })}>Evidence rules</NavButton>
          <NavButton active={current === 'settings'} icon="sliders" onClick={() => go({ name: 'settings' })}>Settings</NavButton>
        </nav>
        <div className="side-note"><span className="status-dot" />Private by default<p>No ad platform or customer analytics account is required.</p></div>
        <button className="logout" onClick={onLogout}><Icon name="logout" />Sign out</button>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}

function NavButton({ active, icon, children, onClick }: { active: boolean; icon: string; children: ReactNode; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}><Icon name={icon} />{children}</button>;
}

function Logo() {
  return <div className="logo"><img className="logo-mark" src="/sitechronicle-mark.png" alt="" /><span><b>SiteChronicle</b><small>Private site intelligence</small></span></div>;
}

function Dashboard({ go }: { go: (view: View) => void }) {
  const [data, setData] = useState<Row | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState('');
  const [verification, setVerification] = useState('all');
  const load = () => api<Row>('/api/dashboard').then(setData);
  useEffect(() => { void load(); }, []);
  if (!data) return <Loading />;

  const counts = data.findingCounts ?? {};
  const domains = (data.domains as Row[]).filter((domain) => {
    const matchesQuery = includesText(`${domain.name} ${domain.origin} ${domain.hostname}`, query);
    const matchesVerification = verification === 'all' || (verification === 'verified' ? domain.verified_at : !domain.verified_at);
    return matchesQuery && matchesVerification;
  });
  const domainMap = Object.fromEntries((data.domains as Row[]).map((domain) => [domain.id, domain]));

  return (
    <>
      <Header eyebrow="Private intelligence" title="Every site. One clear view." subtitle="Daily technical signals, first-party observations and evidence-linked growth opportunities—without asking clients for analytics access." action={<button className="primary" onClick={() => setShowAdd(true)}>+ Add site</button>} />
      {!data.workerOnline && <div className="alert danger"><b>No active worker.</b><span>Audits cannot start until a worker heartbeat is detected.</span></div>}
      <div className="metric-grid">
        <Metric label="Active sites" value={data.domains.length} icon="domain" />
        <Metric label="Recent audits" value={data.audits.length} icon="pulse" />
        <Metric label="Open opportunities" value={(data.domains as Row[]).reduce((sum, domain) => sum + Number(domain.open_opportunities ?? 0), 0)} tone="amber" icon="spark" />
        <Metric label="Observed loads · 28d" value={(data.domains as Row[]).reduce((sum, domain) => sum + Number(domain.observed_views_28d ?? 0), 0)} icon="trend" />
      </div>
      <section className="panel">
        <div className="panel-head responsive-head">
          <div><p className="eyebrow">Portfolio</p><h2>Monitored sites</h2><p className="section-copy">Synthetic checks are always labeled separately from anonymous visitor observations.</p></div>
          <div className="compact-tools">
            <SearchInput value={query} onChange={setQuery} placeholder="Search domains…" />
            <select aria-label="Verification status" value={verification} onChange={(event) => setVerification(event.target.value)}>
              <option value="all">All properties</option>
              <option value="verified">Verified</option>
              <option value="passive">Passive only</option>
            </select>
          </div>
        </div>
        {domains.length ? <div className="domain-grid">{domains.map((domain) => (
          <button className="domain-card" key={domain.id} onClick={() => go({ name: 'domain', id: domain.id })}>
            <span className="domain-icon">{String(domain.name).slice(0, 2).toUpperCase()}</span>
            <span><b>{domain.name}</b><small>{domain.origin}</small><small className="domain-facts">{domain.open_opportunities ?? 0} opportunities · {domain.observed_views_28d ?? 0} observed loads</small></span>
            <span className={`pill ${domain.latest_status === 'completed' ? 'ok' : 'neutral'}`}>{domain.latest_status ?? 'New'}</span>
            <Icon name="arrow" />
          </button>
        ))}</div> : <Empty title="No matching domains" text="Change the search or verification filter." />}
      </section>
      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">Timeline</p><h2>Recent audit activity</h2></div><button onClick={() => go({ name: 'audits' })}>Browse all audits →</button></div>
        <AuditTable audits={data.audits} go={go} domainMap={domainMap} showDomain />
      </section>
      {showAdd && <AddDomain onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); void load(); }} />}
    </>
  );
}

function AddDomain({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [dailyMonitoring, setDailyMonitoring] = useState(true);
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await post('/api/domains', { name, origin, authorizationConfirmed: authorized, dailyMonitoring, telemetryEnabled });
      onAdded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add domain');
    }
  };
  return (
    <Modal onClose={onClose}>
      <p className="eyebrow">New property</p><h2>Add a site</h2>
      <form onSubmit={submit}>
        <label>Display name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Storefront" /></label>
        <label>Origin<input required type="url" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://example.com" /></label>
        <label className="check"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span>I own this property or have explicit authorization to audit it.</span></label>
        <label className="check"><input type="checkbox" checked={dailyMonitoring} onChange={(event) => setDailyMonitoring(event.target.checked)} /><span>Create a lightweight daily pulse automation.</span></label>
        <label className="check"><input type="checkbox" checked={telemetryEnabled} onChange={(event) => setTelemetryEnabled(event.target.checked)} /><span>Enable the anonymous, cookieless measurement tag. Installation instructions appear after adding the site.</span></label>
        {error && <div className="alert danger">{error}</div>}
        <div className="button-row"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={!authorized}>Add domain</button></div>
      </form>
    </Modal>
  );
}

function AuditExplorer({ go }: { go: (view: View) => void }) {
  const [audits, setAudits] = useState<Row[] | null>(null);
  const [domains, setDomains] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [domainId, setDomainId] = useState('all');
  const [order, setOrder] = useState('newest');

  useEffect(() => {
    void Promise.all([api<Row[]>('/api/audits?limit=200'), api<Row[]>('/api/domains')]).then(([auditRows, domainRows]) => {
      setAudits(auditRows);
      setDomains(domainRows);
    });
  }, []);
  if (!audits) return <Loading />;

  const domainMap = Object.fromEntries(domains.map((domain) => [domain.id, domain]));
  const visible = audits.filter((audit) => {
    const domain = domainMap[audit.domain_id];
    return (status === 'all' || audit.status === status)
      && (domainId === 'all' || audit.domain_id === domainId)
      && includesText(`${audit.id} ${audit.trigger} ${domain?.name ?? ''} ${domain?.origin ?? ''}`, query);
  }).sort((left, right) => order === 'newest'
    ? Date.parse(right.created_at) - Date.parse(left.created_at)
    : Date.parse(left.created_at) - Date.parse(right.created_at));
  const running = audits.filter((audit) => ['queued', 'running'].includes(audit.status)).length;
  const completed = audits.filter((audit) => audit.status === 'completed').length;
  const failed = audits.filter((audit) => audit.status === 'failed').length;

  return (
    <>
      <Header eyebrow="Audit explorer" title="Every run, one timeline." subtitle="Filter up to 200 recent scans by property, state or identifier." />
      <div className="metric-grid">
        <Metric label="Runs loaded" value={audits.length} icon="pulse" />
        <Metric label="In progress" value={running} icon="clock" />
        <Metric label="Completed" value={completed} tone="green" icon="check" />
        <Metric label="Failed" value={failed} tone="red" icon="alert" />
      </div>
      <section className="panel">
        <div className="browser-toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search ID, domain or trigger…" />
          <label><span>Property</span><select value={domainId} onChange={(event) => setDomainId(event.target.value)}><option value="all">All domains</option>{domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label>
          <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{['queued', 'running', 'completed', 'failed', 'cancelled'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Sort</span><select value={order} onChange={(event) => setOrder(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
          <button className="quiet" onClick={() => { setQuery(''); setStatus('all'); setDomainId('all'); setOrder('newest'); }}>Reset</button>
        </div>
        <ResultBar count={visible.length} total={audits.length} label="audits" />
        <AuditTable audits={visible} go={go} domainMap={domainMap} showDomain />
      </section>
    </>
  );
}

function DomainDetail({ id, go }: { id: string; go: (view: View) => void }) {
  const [domain, setDomain] = useState<Row>();
  const [profiles, setProfiles] = useState<Row[]>([]);
  const [audits, setAudits] = useState<Row[]>([]);
  const [schedules, setSchedules] = useState<Row[]>([]);
  const [trends, setTrends] = useState<Row[]>([]);
  const [tab, setTab] = useState<DomainTab>('overview');
  const [profileId, setProfileId] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [domainRows, profileRows, auditRows, scheduleRows, trendRows] = await Promise.all([
        api<Row[]>('/api/domains?includeArchived=true'), api<Row[]>(`/api/domains/${id}/profiles`), api<Row[]>(`/api/audits?domainId=${id}`),
        api<Row[]>(`/api/domains/${id}/schedules`), api<Row[]>(`/api/domains/${id}/trends`),
      ]);
      setDomain(domainRows.find((row) => row.id === id));
      setProfiles(profileRows);
      setAudits(auditRows);
      setSchedules(scheduleRows);
      setTrends(trendRows);
      setProfileId((current) => profileRows.some((profile) => profile.id === current) ? current : (profileRows[0]?.id ?? ''));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load property');
    }
  };
  useEffect(() => { void load(); }, [id]);
  if (error && !domain) return <ErrorState message={error} onRetry={load} />;
  if (!domain) return <Loading />;

  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? profiles[0];
  const run = async () => {
    if (!selectedProfile) return;
    setBusy(true);
    setError('');
    try {
      const result = await post<{ auditId: string }>(`/api/domains/${id}/audits`, { profileId: selectedProfile.id });
      go({ name: 'audit', id: result.auditId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to queue audit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Breadcrumb items={[{ label: 'Overview', onClick: () => go({ name: 'dashboard' }) }, { label: domain.name }]} />
      <Header eyebrow="Property workspace" title={domain.name} subtitle={domain.origin} action={<div className="run-cluster"><select aria-label="Scan profile" value={selectedProfile?.id ?? ''} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><button onClick={() => go({ name: 'compare', domainId: id })}>Compare runs</button><button className="primary" disabled={busy || !selectedProfile} onClick={run}>{busy ? 'Queueing…' : 'Run audit'}</button></div>} />
      {error && <div className="alert danger">{error}</div>}
      <div className="metric-grid">
        <Metric label="Audits" value={audits.length} icon="pulse" />
        <Metric label="Last status" value={audits[0]?.status ?? '—'} compact icon="clock" />
        <Metric label="Verification" value={domain.verified_at ? 'Verified' : 'Passive only'} compact icon="shield" />
        <Metric label="Profiles" value={profiles.length} icon="sliders" />
      </div>
      <Tabs value={tab} onChange={(value) => setTab(value as DomainTab)} items={[
        { value: 'overview', label: 'Overview' }, { value: 'opportunities', label: 'Opportunities' }, { value: 'traffic', label: 'Traffic & vitals' }, { value: 'history', label: 'Audit history', count: audits.length },
        { value: 'profiles', label: 'Scan profiles', count: profiles.length }, { value: 'automation', label: 'Automation', count: schedules.length },
        { value: 'ownership', label: 'Ownership' }, { value: 'settings', label: 'Settings' },
      ]} />
      {tab === 'overview' && <DomainOverview domain={domain} audits={audits} trends={trends} schedules={schedules} go={go} />}
      {tab === 'opportunities' && <OpportunityPanel domainId={id} go={go} />}
      {tab === 'traffic' && <TrafficPanel domainId={id} />}
      {tab === 'history' && <DomainAuditHistory audits={audits} go={go} />}
      {tab === 'profiles' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Configuration</p><h2>Scan profiles</h2><p className="section-copy">Choose a profile to inspect or create a variant for a different crawl scope.</p></div><button className="primary" onClick={() => setShowProfile(true)}>+ New profile</button></div><div className="profile-browser"><div className="profile-list" role="tablist">{profiles.map((profile) => <button role="tab" aria-selected={profile.id === selectedProfile?.id} className={profile.id === selectedProfile?.id ? 'active' : ''} key={profile.id} onClick={() => setProfileId(profile.id)}><span><b>{profile.name}</b><small>{profile.config.maxUrls} URLs · {profile.config.devices.join(' + ')}</small></span>{profile.is_default && <span className="pill ok">Default</span>}</button>)}</div>{selectedProfile ? <ProfileEditor profile={selectedProfile} onSaved={load} /> : <Empty title="No scan profiles" text="Create a profile before running an audit." />}</div></section>}
      {tab === 'automation' && <SchedulePanel domainId={id} profiles={profiles} schedules={schedules} onChanged={load} />}
      {tab === 'ownership' && <VerificationPanel domain={domain} onVerified={load} />}
      {tab === 'settings' && <DomainSettings domain={domain} go={go} onChanged={load} />}
      {showProfile && selectedProfile && <NewProfile baseProfile={selectedProfile} domainId={id} onClose={() => setShowProfile(false)} onAdded={() => { setShowProfile(false); void load(); }} />}
    </>
  );
}

function DomainOverview({ domain, audits, trends, schedules, go }: { domain: Row; audits: Row[]; trends: Row[]; schedules: Row[]; go: (view: View) => void }) {
  const completed = audits.filter((audit) => audit.status === 'completed');
  const latest = completed[0];
  return (
    <>
      {!domain.verified_at && <div className="alert warn split-alert"><span><b>Ownership is not verified.</b><small>Passive authorized scans remain available according to server policy.</small></span><span className="pill neutral">Passive mode</span></div>}
      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">Score history</p><h2>Category trends</h2><p className="section-copy">Completed runs, oldest to newest. Hover a point for its exact score.</p></div>{completed.length > 1 && <button onClick={() => go({ name: 'compare', domainId: domain.id })}>Analyze changes →</button>}</div>
        <TrendChart audits={trends} />
      </section>
      <div className="two-column">
        <section className="panel"><p className="eyebrow">Latest completed run</p><h2>{latest ? formatDate(latest.completed_at ?? latest.created_at) : 'No baseline yet'}</h2>{latest ? <><div className="mini-score-list">{(latest.scores ?? []).map((score: Row) => <div key={score.category}><span>{score.category}</span><b>{score.score ?? '—'}</b><i><span style={{ width: `${score.score ?? 0}%` }} /></i></div>)}</div><button className="wide-button" onClick={() => go({ name: 'audit', id: latest.id })}>Open latest evidence →</button></> : <p className="muted">Run the first audit to establish a score baseline.</p>}</section>
        <section className="panel"><p className="eyebrow">Property health</p><h2>At a glance</h2><div className="fact-list"><Fact label="Successful runs" value={completed.length} /><Fact label="Pages in latest run" value={latest?.summary?.pagesScanned ?? '—'} /><Fact label="Active schedules" value={schedules.filter((schedule) => schedule.enabled).length} /><Fact label="Added" value={formatDate(domain.created_at)} /></div></section>
      </div>
    </>
  );
}

function TrendChart({ audits }: { audits: Row[] }) {
  const recent = audits.slice(-30);const latest=recent.at(-1);const signature=(audit:Row)=>`${audit.manifest?.profileHash??''}:${JSON.stringify(audit.manifest?.scannerVersions??{})}`;const latestSignature=latest?signature(latest):'';const comparableRuns=recent.filter(audit=>signature(audit)===latestSignature);const runs = comparableRuns.slice(-10);const excluded=recent.length-comparableRuns.length;
  const categories = Array.from(new Set(runs.flatMap((audit) => (audit.scores ?? []).map((score: Row) => score.category)))) as string[];
  if (!runs.length || !categories.length) return <Empty title="No trend data yet" text="Completed audits will appear here as a comparable timeline." />;
  const width = 760;
  const height = 220;
  const pad = 30;
  const x = (index: number) => runs.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (runs.length - 1);
  const y = (score: number) => pad + ((100 - score) * (height - pad * 2)) / 100;
  return (
    <>{excluded>0&&<div className="alert warn">{excluded} run(s) with a different profile or scanner toolchain were excluded from this trend.</div>}<div className="trend-wrap">
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Audit category score history">
        {[0, 25, 50, 75, 100].map((score) => <g key={score}><line x1={pad} y1={y(score)} x2={width - pad} y2={y(score)} /><text x="2" y={y(score) + 4}>{score}</text></g>)}
        {categories.map((category, categoryIndex) => {
          const points = runs.map((audit, index) => {
            const score = (audit.scores ?? []).find((item: Row) => item.category === category)?.score;
            return score === null || score === undefined ? null : { x: x(index), y: y(score), score, audit };
          }).filter(Boolean) as Array<{ x: number; y: number; score: number; audit: Row }>;
          const color = chartColor(categoryIndex);
          return <g key={category}>{points.length > 1 && <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} style={{ stroke: color }} />}{points.map((point) => <circle key={point.audit.id} cx={point.x} cy={point.y} r="4" style={{ fill: color }}><title>{category}: {point.score} · {formatDate(point.audit.created_at)}</title></circle>)}</g>;
        })}
      </svg>
      <div className="chart-legend">{categories.map((category, index) => <span key={category}><i style={{ background: chartColor(index) }} />{category}</span>)}</div>
    </div></>
  );
}

function DomainAuditHistory({ audits, go }: { audits: Row[]; go: (view: View) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const visible = audits.filter((audit) => (status === 'all' || audit.status === status) && includesText(`${audit.id} ${audit.trigger}`, query));
  return <section className="panel"><div className="panel-head responsive-head"><div><p className="eyebrow">History</p><h2>Audit runs</h2></div><div className="compact-tools"><SearchInput value={query} onChange={setQuery} placeholder="Search audit ID…" /><select aria-label="Audit status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{['queued', 'running', 'completed', 'failed', 'cancelled'].map((value) => <option key={value}>{value}</option>)}</select></div></div><ResultBar count={visible.length} total={audits.length} label="audits" /><AuditTable audits={visible} go={go} /></section>;
}

function VerificationPanel({ domain, onVerified }: { domain: Row; onVerified: () => void }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const verify = async (method: 'dns' | 'file') => {
    setBusy(method);
    setMessage('');
    try {
      await post(`/api/domains/${domain.id}/verify`, { method });
      onVerified();
    } catch {
      setMessage('Verification record was not found yet. Check propagation and try again.');
    } finally {
      setBusy('');
    }
  };
  if (domain.verified_at) return <section className="panel ownership-success"><div className="success-mark"><Icon name="check" /></div><div><p className="eyebrow">Ownership</p><h2>Property verified</h2><p className="muted">Verified with {domain.verification_method} on {formatDate(domain.verified_at)}. Profiles requiring explicit proof can now be used.</p></div></section>;
  return (
    <section className="panel verification">
      <div><p className="eyebrow">Optional ownership proof</p><h2>Unlock explicitly verified scans</h2><p className="muted">Publish either record, then verify. Passive authorized scans remain available according to server policy.</p></div>
      <div className="verification-options">
        <div><span className="step-number">1</span><b>DNS TXT record</b><small>Host</small><code>_sitechronicle.{domain.hostname}</code><small>Value</small><code>{domain.verification_token}</code><button onClick={() => verify('dns')} disabled={Boolean(busy)}>{busy === 'dns' ? 'Checking…' : 'Verify DNS'}</button></div>
        <div><span className="step-number">2</span><b>Well-known file</b><small>Path</small><code>/.well-known/sitechronicle-verification.txt</code><small>Contents</small><code>{domain.verification_token}</code><button onClick={() => verify('file')} disabled={Boolean(busy)}>{busy === 'file' ? 'Checking…' : 'Verify file'}</button></div>
      </div>
      {message && <div className="alert warn">{message}</div>}
    </section>
  );
}

function SchedulePanel({ domainId, profiles, schedules, onChanged }: { domainId: string; profiles: Row[]; schedules: Row[]; onChanged: () => void }) {
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
  const [cron, setCron] = useState('0 3 * * 1');
  const [timezone, setTimezone] = useState('Europe/Istanbul');
  const [error, setError] = useState('');
  useEffect(() => { if (!profileId && profiles[0]) setProfileId(profiles[0].id); }, [profiles, profileId]);
  const add = async () => {
    setError('');
    try {
      await post(`/api/domains/${domainId}/schedules`, { profileId, cron, timezone });
      onChanged();
    } catch {
      setError('Cron expression or timezone is invalid.');
    }
  };
  return (
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">Automation</p><h2>Audit schedule</h2><p className="section-copy">Run a chosen profile automatically in its local timezone.</p></div></div>
      <div className="schedule-form">
        <label>Scan profile<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <label>Cron expression<input value={cron} onChange={(event) => setCron(event.target.value)} /></label>
        <label>Timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
        <button className="primary" disabled={!profileId} onClick={add}>Add schedule</button>
      </div>
      <div className="preset-row"><span>Quick presets:</span><button onClick={() => setCron('0 3 * * *')}>Daily 03:00</button><button onClick={() => setCron('0 3 * * 1')}>Weekly Monday</button><button onClick={() => setCron('0 3 1 * *')}>Monthly</button></div>
      {error && <div className="alert danger">{error}</div>}
      {schedules.length ? schedules.map((schedule) => <div className="schedule-row" key={schedule.id}><span className="schedule-glyph"><Icon name="clock" /></span><span><b>{schedule.cron}</b><small>{schedule.profile_name} · {schedule.timezone} · next {formatDate(schedule.next_run_at)}</small>{schedule.last_error && <small className="danger-text">{schedule.last_error}</small>}</span><span className={`pill ${schedule.enabled ? 'ok' : 'neutral'}`}>{schedule.enabled ? 'Enabled' : 'Paused'}</span><button onClick={async () => { await patch(`/api/schedules/${schedule.id}`, { enabled: !schedule.enabled }); onChanged(); }}>{schedule.enabled ? 'Pause' : 'Enable'}</button><button className="danger-button" onClick={async () => { await api(`/api/schedules/${schedule.id}`, { method: 'DELETE' }); onChanged(); }}>Delete</button></div>) : <Empty title="No schedules yet" text="Add a schedule to keep the evidence timeline current." />}
    </section>
  );
}

function NewProfile({ baseProfile, domainId, onClose, onAdded }: { baseProfile: Row; domainId: string; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState(`${baseProfile.name} copy`);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await post(`/api/domains/${domainId}/profiles`, { name, config: baseProfile.config });
      onAdded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create profile');
    }
  };
  return <Modal onClose={onClose}><p className="eyebrow">New scan profile</p><h2>Duplicate configuration</h2><p className="muted">Start from <b>{baseProfile.name}</b>, then tune the copy independently.</p><form onSubmit={submit}><label>Profile name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>{error && <div className="alert danger">{error}</div>}<div className="button-row"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Create profile</button></div></form></Modal>;
}

function ProfileEditor({ profile, onSaved }: { profile: Row; onSaved: () => void }) {
  const [name, setName] = useState(profile.name);
  const [value, setValue] = useState<ScanProfile>(profile.config);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setName(profile.name); setValue(profile.config); setMessage(''); }, [profile.id]);
  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await patch(`/api/profiles/${profile.id}`, { name, config: value });
      setMessage('Profile saved.');
      onSaved();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to save profile');
    } finally {
      setBusy(false);
    }
  };
  const toggleArray = <T extends string>(items: T[], item: T): T[] => items.includes(item) ? (items.length === 1 ? items : items.filter((value) => value !== item)) : [...items, item];
  return (
    <div className="profile-editor">
      <div className="profile-editor-head"><div><p className="eyebrow">Editing profile</p><h3>{profile.name}</h3></div><span className="pill neutral">Read-only navigation</span></div>
      <div className="profile-form">
        <label className="span-2">Profile name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Maximum crawl URLs<input type="number" min="1" max="50000" value={value.maxUrls} onChange={(event) => setValue({ ...value, maxUrls: Number(event.target.value) })} /></label>
        <label>Browser pages<input type="number" min="1" max="200" value={value.maxBrowserPages} onChange={(event) => setValue({ ...value, maxBrowserPages: Number(event.target.value) })} /></label>
        <label>Performance runs<input type="number" min="1" max="5" value={value.performanceRuns} onChange={(event) => setValue({ ...value, performanceRuns: Number(event.target.value) })} /></label>
        <label>Crawl requests/sec<input type="number" min="0.1" max="10" step="0.1" value={value.crawlRatePerSecond} onChange={(event) => setValue({ ...value, crawlRatePerSecond: Number(event.target.value) })} /></label>
        <label>Wait after load (ms)<input type="number" min="0" max="30000" step="100" value={value.waitAfterLoadMs} onChange={(event) => setValue({ ...value, waitAfterLoadMs: Number(event.target.value) })} /></label>
        <label>Locale<input value={value.locale} onChange={(event) => setValue({ ...value, locale: event.target.value })} /></label>
        <label>Timezone<input value={value.timezone} onChange={(event) => setValue({ ...value, timezone: event.target.value })} /></label>
        <fieldset><legend>Devices</legend>{(['mobile', 'desktop'] as const).map((device) => <label className="check" key={device}><input type="checkbox" checked={value.devices.includes(device)} onChange={() => setValue({ ...value, devices: toggleArray(value.devices, device) })} />{device}</label>)}</fieldset>
        <fieldset><legend>Session states</legend>{(['fresh-session', 'returning-session', 'popup-closed'] as const).map((state) => <label className="check" key={state}><input type="checkbox" checked={value.states.includes(state)} onChange={() => setValue({ ...value, states: toggleArray(value.states, state) })} />{state}</label>)}</fieldset>
        <div className="toggle-stack span-2">
          <Toggle checked={value.respectRobots} onChange={(checked) => setValue({ ...value, respectRobots: checked })} title="Respect robots.txt" text="Keep crawler discovery within published robot directives." />
          <Toggle checked={value.includeCrux} onChange={(checked) => setValue({ ...value, includeCrux: checked })} title="Request CrUX field data" text="Used only when a CrUX API key is configured." />
          <Toggle checked={value.includeSecurityBaseline} onChange={(checked) => setValue({ ...value, includeSecurityBaseline: checked })} title="Passive security baseline" text="Inspect headers, cookies and TLS without active attacks." />
        </div>
      </div>
      <div className="editor-footer"><span className={message === 'Profile saved.' ? 'save-message success-text' : 'save-message'}>{message}</span><button onClick={() => { setName(profile.name); setValue(profile.config); setMessage(''); }}>Reset changes</button><button className="primary" disabled={busy || !name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save profile'}</button></div>
    </div>
  );
}

function AuditDetail({ id, go }: { id: string; go: (view: View) => void }) {
  const [data, setData] = useState<Row>();
  const [tab, setTab] = useState<AuditTab>('summary');
  const [error, setError] = useState('');
  const load = () => api<Row>(`/api/audits/${id}`).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load audit'));
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!data || ['queued', 'running'].includes(data.audit?.status)) void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [id, data?.audit?.status]);
  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Loading />;

  const audit = data.audit;
  const scores = (audit.scores ?? []) as Array<{ category: AuditCategory; score: number | null }>;
  const report = async (format: 'html' | 'pdf') => {
    const result = await post<{ evidenceId: string }>(`/api/audits/${id}/reports`, { format });
    window.open(`/api/evidence/${result.evidenceId}`, '_blank', 'noopener,noreferrer');
  };
  const cancel = async () => {
    await post(`/api/audits/${id}/cancel`, {});
    await load();
  };
  const remove = async () => { if (!window.confirm('Permanently delete this audit and its artifacts?')) return; await api(`/api/audits/${id}`, { method: 'DELETE' }); go({ name: 'audits' }); };
  return (
    <>
      <Breadcrumb items={[{ label: 'All audits', onClick: () => go({ name: 'audits' }) }, { label: audit.domain_name, onClick: () => go({ name: 'domain', id: audit.domain_id }) }, { label: id.slice(-10) }]} />
      <Header eyebrow={`Audit · ${audit.status}`} title={audit.domain_name} subtitle={`${formatDate(audit.created_at)} · ${id}`} action={<div className="button-row">{['queued', 'running'].includes(audit.status) && <button className="danger-button" onClick={cancel}>Cancel run</button>}{!['queued','running'].includes(audit.status) && <button className="danger-button" onClick={remove}>Delete</button>}<button onClick={() => report('html')} disabled={audit.status !== 'completed'}>HTML report</button><button className="primary" onClick={() => report('pdf')} disabled={audit.status !== 'completed'}>PDF report</button></div>} />
      {audit.status === 'failed' && <div className="alert danger"><b>Audit failed.</b><pre>{audit.error}</pre></div>}
      {['queued', 'running'].includes(audit.status) && <Progress status={audit.status} />}
      <div className="score-grid">{scores.length ? scores.map((score) => <Score key={score.category} label={score.category} value={score.score} />) : <div className="score-placeholder">Scores appear when measurements finish.</div>}</div>
      <Tabs value={tab} onChange={(value) => setTab(value as AuditTab)} items={[
        { value: 'summary', label: 'Summary' }, { value: 'findings', label: 'Findings', count: data.findings.length },
        { value: 'pages', label: 'Page browser', count: data.pages.length }, { value: 'evidence', label: 'Evidence', count: data.evidence.length },
      ]} />
      {tab === 'summary' ? <AuditSummary data={data} /> : tab === 'findings' ? <FindingList findings={data.findings} /> : tab === 'pages' ? <PageList pages={data.pages} evidence={data.evidence} /> : <EvidenceList evidence={data.evidence} />}
    </>
  );
}

function AuditSummary({ data }: { data: Row }) {
  const audit = data.audit;
  const counts = (data.findings as Finding[]).reduce<Record<string, number>>((result, finding) => ({ ...result, [finding.severity]: (result[finding.severity] ?? 0) + 1 }), {});
  const templates = (data.pages as Row[]).reduce<Record<string, number>>((result, page) => ({ ...result, [page.template]: (result[page.template] ?? 0) + 1 }), {});
  const manifest = audit.manifest ?? {};
  const warnings = Array.isArray(audit.summary?.warnings) ? audit.summary.warnings : [];
  const coverage = audit.summary?.coverage ?? {};
  return (
    <>
      {warnings.map((warning: string) => <div className="alert warn" key={warning}>{warning}</div>)}
      <div className="summary-grid">
        <section className="panel"><p className="eyebrow">Run facts</p><h2>Coverage</h2><div className="fact-list"><Fact label="Status" value={audit.status} badge /><Fact label="Trigger" value={audit.trigger ?? 'manual'} /><Fact label="Pages captured" value={data.pages.length} /><Fact label="Browser states" value={coverage.browser ? `${coverage.browser.completed}/${coverage.browser.expected}` : '—'} /><Fact label="Lighthouse profiles" value={coverage.lighthouse ? `${coverage.lighthouse.completed}/${coverage.lighthouse.expected}` : '—'} /><Fact label="Evidence objects" value={data.evidence.length} /><Fact label="Duration" value={formatDuration(audit.started_at, audit.completed_at)} /></div></section>
        <section className="panel"><p className="eyebrow">Finding distribution</p><h2>{data.findings.length} total findings</h2><div className="severity-bars">{['critical', 'high', 'medium', 'low', 'info'].map((severity) => <div key={severity}><span className={`severity ${severity}`}>{severity}</span><i><span className={severity} style={{ width: `${data.findings.length ? ((counts[severity] ?? 0) / data.findings.length) * 100 : 0}%` }} /></i><b>{counts[severity] ?? 0}</b></div>)}</div></section>
      </div>
      <div className="two-column">
        <section className="panel"><p className="eyebrow">Page inventory</p><h2>Templates discovered</h2>{Object.keys(templates).length ? <div className="template-cloud">{Object.entries(templates).sort((a, b) => b[1] - a[1]).map(([template, count]) => <span key={template}><b>{count}</b>{template}</span>)}</div> : <Empty title="No pages captured" text="The inventory will populate as discovery progresses." />}</section>
        <section className="panel"><p className="eyebrow">Reproducibility</p><h2>Run manifest</h2><div className="fact-list"><Fact label="Profile hash" value={shortHash(manifest.profileHash)} mono /><Fact label="Worker" value={manifest.workerId ?? '—'} mono /><Fact label="Platform" value={manifest.environment?.platform ?? '—'} /><Fact label="Node" value={manifest.environment?.node ?? '—'} /><Fact label="Ruleset" value={manifest.scannerVersions?.ruleset ?? '—'} /></div><details className="json-details"><summary>View profile snapshot</summary><pre>{JSON.stringify(manifest.profile ?? {}, null, 2)}</pre></details></section>
      </div>
    </>
  );
}

function FindingList({ findings }: { findings: Finding[] }) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const [category, setCategory] = useState('all');
  const [confidence, setConfidence] = useState('all');
  const [order, setOrder] = useState('severity');
  const categories = Array.from(new Set(findings.map((finding) => finding.category))).sort();
  const visible = useMemo(() => findings.filter((finding) =>
    (severity === 'all' || finding.severity === severity)
    && (category === 'all' || finding.category === category)
    && (confidence === 'all' || finding.confidenceLevel === confidence)
    && includesText(`${finding.title} ${finding.observation} ${finding.recommendation} ${finding.ruleId} ${finding.pageUrl ?? ''}`, query),
  ).sort((left, right) => order === 'severity'
    ? (severityOrder[left.severity] ?? 99) - (severityOrder[right.severity] ?? 99) || right.confidence - left.confidence
    : order === 'confidence' ? right.confidence - left.confidence : left.title.localeCompare(right.title)), [findings, query, severity, category, confidence, order]);
  return (
    <section className="panel">
      <div className="browser-toolbar finding-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search findings, rules or URLs…" />
        <label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option>{['critical', 'high', 'medium', 'low', 'info'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Confidence</span><select value={confidence} onChange={(event) => setConfidence(event.target.value)}><option value="all">Any confidence</option>{['confirmed', 'likely', 'unknown'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Sort</span><select value={order} onChange={(event) => setOrder(event.target.value)}><option value="severity">Severity</option><option value="confidence">Confidence</option><option value="title">Title A–Z</option></select></label>
      </div>
      <ResultBar count={visible.length} total={findings.length} label="findings" onClear={() => { setQuery(''); setSeverity('all'); setCategory('all'); setConfidence('all'); setOrder('severity'); }} />
      {visible.length ? <div className="finding-list">{visible.map((finding) => { const aiReview=(finding as Finding & {aiReview?:{clarification:string;confidence:number;evidenceIds:string[]}}).aiReview;return <details className="finding" key={finding.id}><summary><div className="finding-top"><span className={`severity ${finding.severity}`}>{finding.severity}</span><span className="category">{finding.category}</span>{finding.measurementContext && <span className="pill neutral">{finding.measurementContext}</span>}<span className="confidence">{Math.round(finding.confidence * 100)}% · {finding.confidenceLevel}</span></div><h3>{finding.title}</h3><p>{finding.observation}</p><span className="expand-label">View analysis <Icon name="chevron" /></span></summary><div className="finding-body"><dl><dt>Observed</dt><dd>{finding.observation}</dd><dt>Why it matters</dt><dd>{finding.impactHypothesis}<small>{finding.impactStatus}</small></dd><dt>Probable cause</dt><dd>{finding.probableCause}</dd><dt>Recommended change</dt><dd>{finding.recommendation}</dd><dt>Acceptance</dt><dd><ul>{finding.acceptanceCriteria.map((item) => <li key={item}>{item}</li>)}</ul></dd>{aiReview&&<><dt>AI evidence review</dt><dd>{aiReview.clarification}<small>Advisory only · {Math.round(aiReview.confidence*100)}% · {aiReview.evidenceIds.length} scoped evidence reference(s)</small></dd></>}{finding.pageUrl && <><dt>Affected page</dt><dd><a href={finding.pageUrl} target="_blank" rel="noreferrer">{finding.pageUrl}</a></dd></>}</dl><footer><code>{finding.ruleId}</code><span>{finding.evidenceIds.length} evidence reference(s)</span></footer></div></details>;})}</div> : <Empty title="No matching findings" text="Change or clear the active filters." />}
    </section>
  );
}

function PageList({ pages, evidence }: { pages: Row[]; evidence: Row[] }) {
  const [query, setQuery] = useState('');
  const [template, setTemplate] = useState('all');
  const [status, setStatus] = useState('all');
  const [order, setOrder] = useState('url');
  const [selected, setSelected] = useState<Row>();
  const templates = Array.from(new Set(pages.map((page) => page.template))).sort();
  const visible = useMemo(() => pages.filter((page) => {
    const group = statusGroup(Number(page.status_code));
    return (template === 'all' || page.template === template)
      && (status === 'all' || group === status)
      && includesText(`${page.normalized_url} ${page.title} ${page.description} ${(page.h1 ?? []).join(' ')}`, query);
  }).sort((left, right) => order === 'status' ? Number(left.status_code) - Number(right.status_code) : order === 'size' ? Number(right.raw_html_bytes) - Number(left.raw_html_bytes) : String(left.normalized_url).localeCompare(String(right.normalized_url))), [pages, query, template, status, order]);
  return (
    <section className="panel page-browser-panel">
      <div className="browser-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search URL, title or heading…" />
        <label><span>Template</span><select value={template} onChange={(event) => setTemplate(event.target.value)}><option value="all">All templates</option>{templates.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Response</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All responses</option><option value="success">2xx success</option><option value="redirect">3xx redirect</option><option value="error">4xx / 5xx error</option></select></label>
        <label><span>Sort</span><select value={order} onChange={(event) => setOrder(event.target.value)}><option value="url">URL A–Z</option><option value="status">Status code</option><option value="size">Largest HTML</option></select></label>
      </div>
      <ResultBar count={visible.length} total={pages.length} label="pages" onClear={() => { setQuery(''); setTemplate('all'); setStatus('all'); setOrder('url'); }} />
      {visible.length ? <div className={`page-browser ${selected ? 'with-detail' : ''}`}><div className="table-wrap"><table><thead><tr><th>URL & title</th><th>Status</th><th>Template</th><th>HTML</th><th></th></tr></thead><tbody>{visible.map((page) => <tr key={page.id} className={selected?.id === page.id ? 'selected-row' : ''}><td className="url"><b>{urlPath(page.normalized_url)}</b><small>{page.title || page.normalized_url}</small></td><td><span className={`pill ${statusGroup(page.status_code) === 'success' ? 'ok' : statusGroup(page.status_code) === 'error' ? 'bad' : 'neutral'}`}>{page.status_code}</span></td><td><span className="category">{page.template}</span></td><td>{formatBytes(page.raw_html_bytes)}</td><td><button aria-label={`Inspect ${page.normalized_url}`} onClick={() => setSelected(page)}>Inspect →</button></td></tr>)}</tbody></table></div>{selected && <PageDetail page={selected} evidence={evidence.filter((item) => item.page_id === selected.id || item.page_url === selected.normalized_url || item.page_url === selected.url)} onClose={() => setSelected(undefined)} />}</div> : <Empty title="No matching pages" text="Change or clear the active filters." />}
    </section>
  );
}

function PageDetail({ page, evidence, onClose }: { page: Row; evidence: Row[]; onClose: () => void }) {
  const resources = Array.isArray(page.resources) ? page.resources : [];
  const thirdParty = resources.filter((resource: Row) => resource.thirdParty);
  return (
    <section className="detail-drawer" aria-label="Page details">
      <div className="drawer-head"><div><p className="eyebrow">Page inspector</p><h3>{urlPath(page.normalized_url)}</h3></div><button aria-label="Close details" onClick={onClose}>×</button></div>
      <a className="external-link" href={page.final_url || page.url} target="_blank" rel="noreferrer">Open live page ↗</a>
      <div className="drawer-stats"><span><b>{page.status_code}</b>HTTP</span><span><b>{formatBytes(page.raw_html_bytes)}</b>HTML</span><span><b>{resources.length}</b>resources</span><span><b>{thirdParty.length}</b>third-party</span></div>
      <div className="detail-section"><h4>Document metadata</h4><Fact label="Title" value={page.title || '—'} /><Fact label="Description" value={page.description || '—'} /><Fact label="Canonical" value={page.canonical || '—'} mono /><Fact label="Language" value={page.language || '—'} /><Fact label="Robots" value={page.robots || '—'} /><Fact label="H1" value={(page.h1 ?? []).join(' · ') || '—'} /></div>
      <details className="json-details" open><summary>Captured metrics</summary><pre>{JSON.stringify(page.metrics ?? {}, null, 2)}</pre></details>
      <details className="json-details"><summary>Response headers ({Object.keys(page.headers ?? {}).length})</summary><pre>{JSON.stringify(page.headers ?? {}, null, 2)}</pre></details>
      <details className="json-details"><summary>Resources ({resources.length})</summary><div className="resource-list">{resources.slice(0, 50).map((resource: Row, index: number) => <div key={`${resource.url}-${index}`}><span className={`pill ${resource.thirdParty ? 'neutral' : 'ok'}`}>{resource.type}</span><span title={resource.url}>{urlHost(resource.url)}<small>{urlPath(resource.url)}</small></span><b>{formatBytes(resource.transferBytes ?? resource.encodedBytes)}</b></div>)}</div></details>
      <div className="detail-section"><h4>Related evidence ({evidence.length})</h4>{evidence.length ? evidence.map((item) => <a className="evidence-line" href={`/api/evidence/${item.id}`} target="_blank" rel="noreferrer" key={item.id}><span className="evidence-kind">{item.kind}</span><code>{shortHash(item.sha256)}</code><Icon name="arrow" /></a>) : <p className="muted">No page-specific artifacts were linked.</p>}</div>
    </section>
  );
}

function EvidenceList({ evidence }: { evidence: Row[] }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const kinds = Array.from(new Set(evidence.map((item) => item.kind))).sort();
  const visible = evidence.filter((item) => (kind === 'all' || item.kind === kind) && includesText(`${item.kind} ${item.page_url ?? ''} ${item.sha256} ${item.mime_type}`, query));
  return (
    <section className="panel">
      <div className="browser-toolbar evidence-toolbar"><SearchInput value={query} onChange={setQuery} placeholder="Search page, hash or kind…" /><label><span>Artifact type</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All types</option>{kinds.map((value) => <option key={value}>{value}</option>)}</select></label><div className="view-toggle" aria-label="View style"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view"><Icon name="grid" /></button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view"><Icon name="list" /></button></div></div>
      <ResultBar count={visible.length} total={evidence.length} label="artifacts" onClear={() => { setQuery(''); setKind('all'); }} />
      {visible.length ? <div className={`evidence-grid ${view === 'list' ? 'list' : ''}`}>{visible.map((item) => <article key={item.id} className="evidence-card"><div><span className="evidence-kind">{item.kind}</span><span className="pill neutral">{String(item.mime_type ?? '').split(';')[0]}</span></div><b title={item.page_url}>{item.page_url ? urlPath(item.page_url) : item.kind}</b><small>{item.page_url ? urlHost(item.page_url) : 'Audit-level artifact'}</small><code>{shortHash(item.sha256)}</code><footer><span>{formatDate(item.created_at)}</span><a href={`/api/evidence/${item.id}`} target="_blank" rel="noreferrer">Open ↗</a></footer></article>)}</div> : <Empty title="No matching evidence" text="Change or clear the active filters." />}
    </section>
  );
}

function Compare({ domainId, go }: { domainId: string; go: (view: View) => void }) {
  const [audits, setAudits] = useState<Row[]>([]);
  const [domain, setDomain] = useState<Row>();
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [result, setResult] = useState<Row>();
  const [tab, setTab] = useState<'scores' | 'findings' | 'pages' | 'causes'>('scores');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([api<Row[]>(`/api/audits?domainId=${domainId}`), api<Row[]>('/api/domains')]).then(([rows, domains]) => {
      const complete = rows.filter((row) => row.status === 'completed');
      setAudits(complete);
      setDomain(domains.find((item) => item.id === domainId));
      setAfter(complete[0]?.id ?? '');
      setBefore(complete[1]?.id ?? '');
    });
  }, [domainId]);
  const run = async () => {
    setBusy(true);
    try { setResult(await post('/api/comparisons', { baselineAuditId: before, currentAuditId: after })); } finally { setBusy(false); }
  };
  const report = async (format: 'html' | 'pdf') => {
    if (!result) return;
    const value = await post<{ evidenceId: string }>(`/api/comparisons/${result.id}/reports`, { format });
    window.open(`/api/evidence/${value.evidenceId}`, '_blank', 'noopener,noreferrer');
  };
  return (
    <>
      <Breadcrumb items={[{ label: 'Overview', onClick: () => go({ name: 'dashboard' }) }, { label: domain?.name ?? 'Property', onClick: () => go({ name: 'domain', id: domainId }) }, { label: 'Compare' }]} />
      <Header eyebrow="Change intelligence" title="What changed, and why?" subtitle="Compare equivalent profiles for decision-grade deltas and evidence-backed cause candidates." />
      <section className="panel compare-picker">
        <label>Baseline<select value={before} onChange={(event) => { setBefore(event.target.value); setResult(undefined); }}>{audits.map((audit) => <option key={audit.id} value={audit.id}>{formatDate(audit.created_at)} · {audit.id.slice(-8)}</option>)}</select></label><span className="compare-arrow">→</span>
        <label>Current<select value={after} onChange={(event) => { setAfter(event.target.value); setResult(undefined); }}>{audits.map((audit) => <option key={audit.id} value={audit.id}>{formatDate(audit.created_at)} · {audit.id.slice(-8)}</option>)}</select></label>
        <button className="primary" disabled={!before || !after || before === after || busy} onClick={run}>{busy ? 'Comparing…' : 'Compare runs'}</button>
      </section>
      {!result && audits.length < 2 && <Empty title="Two completed audits required" text="Run another audit with the same profile to unlock reliable change analysis." />}
      {result && <>
        <div className="button-row right report-actions"><span className={`pill ${result.comparable ? 'ok' : 'neutral'}`}>{result.comparable ? 'Comparable runs' : 'Review warnings'}</span><button onClick={() => report('html')}>HTML report</button><button className="primary" onClick={() => report('pdf')}>PDF report</button></div>
        {result.warnings?.map((warning: string) => <div className="alert warn" key={warning}>{warning}</div>)}
        <Tabs value={tab} onChange={(value) => setTab(value as typeof tab)} items={[
          { value: 'scores', label: 'Score deltas' }, { value: 'findings', label: 'Finding lifecycle', count: result.findings.added.length + result.findings.resolved.length },
          { value: 'pages', label: 'Page changes', count: result.pages.filter((page: Row) => page.status !== 'unchanged').length }, { value: 'causes', label: 'Cause candidates', count: result.causes.length },
        ]} />
        {tab === 'scores' && <div className="score-grid">{result.scoreDeltas.map((delta: Row) => <div className="delta-card" key={delta.category}><span>{delta.category}</span><b>{delta.before ?? '—'} <i>→</i> {delta.after ?? '—'}</b><em className={(delta.delta ?? 0) >= 0 ? 'up' : 'down'}>{delta.delta === null ? '—' : `${delta.delta > 0 ? '+' : ''}${delta.delta}`}</em></div>)}</div>}
        {tab === 'findings' && <ComparisonFindings findings={result.findings} />}
        {tab === 'pages' && <ComparisonPages pages={result.pages} />}
        {tab === 'causes' && <section className="panel"><p className="eyebrow">Cause candidates</p><h2>Why metrics changed</h2>{result.causes.length ? result.causes.map((cause: Row) => <article className="cause" key={`${cause.pageUrl}-${cause.metric}`}><div><span className={`pill ${cause.level === 'confirmed' ? 'ok' : 'neutral'}`}>{cause.level}</span><b>{cause.summary}</b><em>{Math.round(cause.confidence * 100)}%</em></div><p>{cause.explanation}</p>{cause.pageUrl && <small>{cause.pageUrl}</small>}<details><summary>Evidence trail</summary><pre>{JSON.stringify(cause.evidence, null, 2)}</pre></details></article>) : <Empty title="No reliable cause established" text="The system will not invent a cause when captured artifacts are insufficient." />}</section>}
      </>}
    </>
  );
}

function ComparisonFindings({ findings }: { findings: Row }) {
  const [section, setSection] = useState<'added' | 'resolved' | 'persistent'>('added');
  const rows = findings[section] ?? [];
  return <section className="panel"><div className="segmented"><button className={section === 'added' ? 'active' : ''} onClick={() => setSection('added')}>New <span>{findings.added.length}</span></button><button className={section === 'resolved' ? 'active' : ''} onClick={() => setSection('resolved')}>Resolved <span>{findings.resolved.length}</span></button><button className={section === 'persistent' ? 'active' : ''} onClick={() => setSection('persistent')}>Persistent <span>{findings.persistent.length}</span></button></div>{rows.length ? rows.map((entry: Row) => { const finding = section === 'persistent' ? entry.after : entry; return <article className="compact-finding" key={finding.id}><span className={`severity ${finding.severity}`}>{finding.severity}</span><span><b>{finding.title}</b><small>{finding.category} · {finding.ruleId}</small></span>{section === 'persistent' && entry.severityChanged && <span className="pill neutral">Severity changed</span>}</article>; }) : <Empty title={`No ${section} findings`} text="Nothing in this lifecycle state for the selected pair." />}</section>;
}

function ComparisonPages({ pages }: { pages: Row[] }) {
  const [status, setStatus] = useState('changed');
  const visible = status === 'all' ? pages : pages.filter((page) => page.status === status);
  return <section className="panel"><div className="filter-row">{['changed', 'added', 'removed', 'unchanged', 'all'].map((value) => <button className={status === value ? 'active' : ''} onClick={() => setStatus(value)} key={value}>{value}</button>)}</div><ResultBar count={visible.length} total={pages.length} label="pages" />{visible.length ? visible.map((page) => <details className="page-change" key={page.normalizedUrl}><summary><span className={`pill ${page.status === 'unchanged' ? 'neutral' : page.status === 'added' ? 'ok' : page.status === 'removed' ? 'bad' : 'running'}`}>{page.status}</span><b>{page.normalizedUrl}</b><span>{page.changes.length} fields</span></summary><div className="change-table">{page.changes.map((change: Row) => <div key={change.field}><b>{change.field}</b><code>{displayValue(change.before)}</code><span>→</span><code>{displayValue(change.after)}</code>{change.delta !== undefined && <em>{change.delta > 0 ? '+' : ''}{change.delta}</em>}</div>)}</div></details>) : <Empty title="No pages in this state" text="Choose another lifecycle filter." />}</section>;
}

function OpportunityHub({ go }: { go: (view: View) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [domains, setDomains] = useState<Row[]>([]);
  const [domainId, setDomainId] = useState('all');
  const [status, setStatus] = useState('open');
  const [query, setQuery] = useState('');
  const load = () => Promise.all([api<Row[]>('/api/opportunities?status=all&limit=500'), api<Row[]>('/api/domains')]).then(([items, sites]) => { setRows(items); setDomains(sites); });
  useEffect(() => { void load(); }, []);
  if (!rows) return <Loading />;
  const visible = rows.filter((item) => (domainId === 'all' || item.domain_id === domainId) && (status === 'all' || item.status === status) && includesText(`${item.title} ${item.observation} ${item.recommendation} ${item.domain_name}`, query));
  return <>
    <Header eyebrow="Opportunity engine" title="Work on what matters next." subtitle="Priority combines severity, evidence confidence and—when the private tag is installed—observed page exposure. It never represents guaranteed uplift." />
    <div className="metric-grid">
      <Metric label="Open" value={rows.filter((row) => row.status === 'open').length} icon="spark" />
      <Metric label="Planned" value={rows.filter((row) => row.status === 'planned').length} icon="clock" />
      <Metric label="Testing" value={rows.filter((row) => row.status === 'testing').length} icon="pulse" />
      <Metric label="Validated" value={rows.filter((row) => row.status === 'validated').length} tone="green" icon="check" />
    </div>
    <section className="panel">
      <div className="browser-toolbar"><SearchInput value={query} onChange={setQuery} placeholder="Search opportunities…" /><label><span>Site</span><select value={domainId} onChange={(event) => setDomainId(event.target.value)}><option value="all">All sites</option>{domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{['open','planned','testing','validated','resolved','dismissed','all'].map((value) => <option key={value}>{value}</option>)}</select></label></div>
      <ResultBar count={visible.length} total={rows.length} label="opportunities" />
      <OpportunityCards rows={visible} onChanged={load} onOpenDomain={(id) => go({name:'domain',id})} showDomain />
    </section>
  </>;
}

function OpportunityPanel({ domainId, go }: { domainId: string; go: (view: View) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = () => api<Row[]>(`/api/opportunities?domainId=${encodeURIComponent(domainId)}&status=all&limit=500`).then(setRows);
  useEffect(() => { void load(); }, [domainId]);
  if (!rows) return <Loading />;
  return <section className="panel"><div className="panel-head"><div><p className="eyebrow">Evidence to action</p><h2>Growth opportunities</h2><p className="section-copy">Measured conditions and hypotheses stay visibly separate through implementation and validation.</p></div><button onClick={() => go({name:'opportunities'})}>Open portfolio view →</button></div><OpportunityCards rows={rows} onChanged={load} onOpenDomain={() => undefined} /></section>;
}

function OpportunityCards({ rows, onChanged, onOpenDomain, showDomain=false }: { rows: Row[]; onChanged: () => void; onOpenDomain: (id:string) => void; showDomain?: boolean }) {
  if (!rows.length) return <Empty title="No opportunities in this view" text="Run a completed audit or change the active filters." />;
  return <div className="opportunity-list">{rows.map((item) => <article className="opportunity-card" key={item.id}>
    <div className="opportunity-score"><b>{item.priority}</b><span>priority</span></div>
    <div className="opportunity-main">
      <div className="finding-top"><span className="category">{item.category}</span><span className={`pill ${item.impact_status === 'measured' ? 'ok' : 'neutral'}`}>{item.impact_status}</span><span className="confidence">{Math.round(Number(item.confidence) * 100)}% confidence · {item.effort} effort</span></div>
      <h3>{item.title}</h3>{showDomain && <button className="text-button" onClick={() => onOpenDomain(item.domain_id)}>{item.domain_name} ↗</button>}
      <p>{item.observation}</p>
      <details><summary>Evidence-based plan</summary><dl><dt>Why it matters</dt><dd>{item.rationale}</dd><dt>Recommended change</dt><dd>{item.recommendation}</dd><dt>Validation</dt><dd>{item.validation_plan}</dd><dt>Acceptance</dt><dd><ul>{(item.acceptance_criteria ?? []).map((value:string) => <li key={value}>{value}</li>)}</ul></dd><dt>Evidence</dt><dd>{(item.evidence_ids ?? []).map((id:string) => id.startsWith('telemetry:') ? <code className="evidence-chip" key={id}>{id}</code> : <a className="evidence-chip" key={id} href={`/api/evidence/${id}`} target="_blank" rel="noreferrer">{id}</a>)}</dd>{(item.source_urls ?? []).length > 0 && <><dt>Research / standards</dt><dd>{item.source_urls.map((url:string) => <a key={url} href={url} target="_blank" rel="noreferrer">Source ↗</a>)}</dd></>}</dl></details>
    </div>
    <select aria-label="Opportunity status" value={item.status} onChange={async(event) => { await patch(`/api/opportunities/${item.id}`,{status:event.target.value});onChanged(); }}>{['open','planned','testing','validated','resolved','dismissed'].map((value) => <option key={value}>{value}</option>)}</select>
  </article>)}</div>;
}

function TrafficHub({ go }: { go: (view: View) => void }) {
  const [domains, setDomains] = useState<Row[] | null>(null);const [domainId,setDomainId]=useState('');
  useEffect(()=>{void api<Row[]>('/api/domains').then((rows)=>{setDomains(rows);setDomainId((current)=>current||rows[0]?.id||'')})},[]);
  if(!domains)return <Loading/>;
  return <><Header eyebrow="First-party measurement" title="Traffic, without the surveillance stack." subtitle="Cookieless page-load counts and field Web Vitals are collected without visitor IDs, IP storage or query strings." action={<select aria-label="Site" value={domainId} onChange={(event)=>setDomainId(event.target.value)}>{domains.map((domain)=><option key={domain.id} value={domain.id}>{domain.name}</option>)}</select>}/>{domainId?<TrafficPanel domainId={domainId}/>:<Empty title="No sites yet" text="Add a site to begin independent measurement."/>}<button className="text-button" onClick={()=>domainId&&go({name:'domain',id:domainId})}>Open site workspace →</button></>;
}

function TrafficPanel({ domainId }: { domainId: string }) {
  const [data,setData]=useState<Row|null>(null);const [days,setDays]=useState(28);
  const load=()=>api<Row>(`/api/domains/${domainId}/traffic?days=${days}`).then(setData);
  useEffect(()=>{setData(null);void load()},[domainId,days]);
  if(!data)return <Loading/>;
  const total=(data.daily as Row[]).reduce((sum,row)=>sum+Number(row.views),0);const max=Math.max(1,...(data.daily as Row[]).map((row)=>Number(row.views)));
  return <>
    <div className="metric-grid"><Metric label={`Observed loads · ${days}d`} value={total} icon="trend"/><Metric label="Measured days" value={data.daily.length} icon="clock"/><Metric label="Vital samples" value={(data.vitals as Row[]).reduce((sum,row)=>sum+Number(row.samples),0)} icon="pulse"/><Metric label="Persistent identifiers" value="None" compact tone="green" icon="shield"/></div>
    {!data.domain.telemetry_enabled&&<div className="alert warn"><b>Visitor measurement is off.</b> Synthetic audit scores remain available, but they are not real traffic.</div>}
    <div className="two-column traffic-columns"><section className="panel"><div className="panel-head"><div><p className="eyebrow">Anonymous observations</p><h2>Page loads over time</h2></div><select value={days} onChange={(event)=>setDays(Number(event.target.value))}>{[7,28,90,365].map((value)=><option key={value} value={value}>{value} days</option>)}</select></div>{data.daily.length?<div className="bar-chart">{data.daily.map((row:Row)=><div key={row.day}><i style={{height:`${Math.max(4,Number(row.views)/max*100)}%`}}/><span>{new Date(row.day).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span><b>{row.views}</b></div>)}</div>:<Empty title="No visitor observations" text="Enable and install the private measurement tag below."/>}</section>
      <section className="panel"><p className="eyebrow">Field experience</p><h2>Web Vitals</h2>{data.vitals.length?<div className="vital-list">{data.vitals.map((vital:Row)=><div key={vital.metric}><span><b>{vital.metric}</b><small>{vital.samples} anonymous samples</small></span><strong>{formatVital(vital.metric,vital.p75)}</strong><span className={`pill ${Number(vital.poor)>0?'neutral':'ok'}`}>{vital.poor} poor</span></div>)}</div>:<Empty title="No field vital samples" text="Vitals arrive from real page loads after tag installation."/>}</section></div>
    <div className="two-column"><section className="panel"><p className="eyebrow">Content exposure</p><h2>Most observed paths</h2>{data.pages.length?<div className="fact-list">{data.pages.slice(0,10).map((row:Row)=><Fact key={row.path} label={row.path} value={`${row.views} loads`}/>)}</div>:<Empty title="No paths yet" text="Path query strings are intentionally discarded."/>}</section><section className="panel"><p className="eyebrow">Discovery</p><h2>Referrer hosts</h2>{data.referrers.length?<div className="fact-list">{data.referrers.slice(0,10).map((row:Row)=><Fact key={row.referrer} label={row.referrer} value={`${row.views} loads`}/>)}</div>:<Empty title="No referrers yet" text="Only aggregate host names are retained."/>}</section></div>
    <TrackerPanel domainId={domainId} data={data.domain} onChanged={load}/>
  </>;
}

function TrackerPanel({domainId,data,onChanged}:{domainId:string;data:Row;onChanged:()=>void}){
  const [tracker,setTracker]=useState<Row|null>(null);const [copied,setCopied]=useState(false);
  useEffect(()=>{void api<Row>(`/api/domains/${domainId}/tracker`).then(setTracker)},[domainId,data.telemetry_enabled]);
  return <section className="panel tracker-panel"><div className="panel-head"><div><p className="eyebrow">Private measurement tag</p><h2>Measure independently</h2><p className="section-copy">No cookies, visitor IDs, IP storage or URL query strings. The tag records page loads and field performance only.</p></div><button className={data.telemetry_enabled?'danger-button':'primary'} onClick={async()=>{await patch(`/api/domains/${domainId}/telemetry`,{enabled:!data.telemetry_enabled});onChanged()}}>{data.telemetry_enabled?'Disable tag':'Enable tag'}</button></div>{tracker&&<div className="code-copy"><code>{tracker.snippet}</code><button onClick={async()=>{await navigator.clipboard.writeText(tracker.snippet);setCopied(true);window.setTimeout(()=>setCopied(false),1500)}}>{copied?'Copied':'Copy'}</button></div>}<p className="privacy-note"><Icon name="shield"/> Install this one line before <code>&lt;/head&gt;</code>. Synthetic checks continue even without it; real page-load measurement cannot.</p></section>;
}

function AutomationHub({go}:{go:(view:View)=>void}){
  const [rows,setRows]=useState<Row[]|null>(null);const load=()=>api<Row[]>('/api/automations').then(setRows);useEffect(()=>{void load()},[]);if(!rows)return <Loading/>;
  return <><Header eyebrow="Automation control" title="Daily, quiet, reliable." subtitle="Lightweight daily pulse scans and deeper profiles share the same evidence-preserving queue."/><div className="metric-grid"><Metric label="Automations" value={rows.length} icon="clock"/><Metric label="Enabled" value={rows.filter(row=>row.enabled).length} tone="green" icon="check"/><Metric label="Paused" value={rows.filter(row=>!row.enabled).length} icon="pause"/><Metric label="Errors" value={rows.filter(row=>row.last_error).length} tone="red" icon="alert"/></div><section className="panel">{rows.length?rows.map(row=><div className="schedule-row" key={row.id}><span className="schedule-glyph"><Icon name="clock"/></span><span><button className="text-button" onClick={()=>go({name:'domain',id:row.domain_id})}>{row.domain_name}</button><small>{row.profile_name} · {row.cron} · next {formatDate(row.next_run_at)}</small>{row.last_error&&<small className="danger-text">{row.last_error}</small>}</span><span className={`pill ${row.enabled?'ok':'neutral'}`}>{row.enabled?'Enabled':'Paused'}</span><button onClick={async()=>{await patch(`/api/schedules/${row.id}`,{enabled:!row.enabled});load()}}>{row.enabled?'Pause':'Enable'}</button><button className="danger-button" onClick={async()=>{if(window.confirm('Delete this automation?')){await api(`/api/schedules/${row.id}`,{method:'DELETE'});load()}}}>Delete</button></div>):<Empty title="No automations" text="Add a site or create a schedule from a site workspace."/>}</section></>;
}

function AIChat({go}:{go:(view:View)=>void}){
  const [domains,setDomains]=useState<Row[]>([]);const [domainId,setDomainId]=useState('');const [messages,setMessages]=useState<Row[]>([]);const [threadId,setThreadId]=useState('');const [value,setValue]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{void api<Row[]>('/api/domains').then(setDomains)},[]);
  const send=async(event:FormEvent)=>{event.preventDefault();const question=value.trim();if(!question||busy)return;setValue('');setMessages(current=>[...current,{id:`local-${Date.now()}`,role:'user',content:question}]);setBusy(true);try{const result=await post<Row>('/api/chat',{...(threadId?{threadId}:{}),...(domainId?{domainId}:{}),message:question});setThreadId(result.threadId);setMessages(current=>[...current,result.message])}catch(error){setMessages(current=>[...current,{id:`error-${Date.now()}`,role:'assistant',content:error instanceof Error?error.message:'Unable to answer'}])}finally{setBusy(false)}};
  return <div className="chat-page"><Header eyebrow="Read-only AI analyst" title="Ask the evidence." subtitle="The analyst can read portfolio summaries, opportunities, audit scores and anonymous measurements. It cannot change a site or invent missing data."/><div className="chat-scope"><label>Analysis scope<select value={domainId} onChange={(event)=>{setDomainId(event.target.value);setThreadId('');setMessages([])}}><option value="">Entire portfolio</option>{domains.map(domain=><option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label>{domainId&&<button onClick={()=>go({name:'domain',id:domainId})}>Open site →</button>}</div><section className="chat-surface">{messages.length===0?<div className="chat-empty"><img src="/sitechronicle-mark.png" alt=""/><h2>What should we examine?</h2><p>Try “Which three opportunities have the strongest evidence?” or “Do we have real visitor data for this site?”</p><div>{['What changed in the latest audit?','Show the highest-confidence opportunities','Which claims are still hypotheses?'].map(prompt=><button key={prompt} onClick={()=>setValue(prompt)}>{prompt}</button>)}</div></div>:<div className="message-list">{messages.map(message=><article key={message.id} className={`message ${message.role}`}><span>{message.role==='user'?'You':'SC'}</span><div><p>{message.content}</p>{message.citations?.length>0&&<details><summary>{message.citations.length} evidence reference(s)</summary><div className="citation-list">{message.citations.map((citation:Row)=><code key={`${citation.type}-${citation.id}`}>{citation.label}</code>)}</div></details>}</div></article>)}{busy&&<article className="message assistant"><span>SC</span><div><p>Reading scoped evidence…</p></div></article>}</div>}<form className="chat-composer" onSubmit={send}><textarea aria-label="Ask SiteChronicle" rows={2} value={value} onChange={(event)=>setValue(event.target.value)} placeholder="Ask about evidence, priorities, changes or validation…"/><button className="primary" disabled={busy||!value.trim()}>Send ↑</button></form></section><p className="chat-disclaimer">AI output is advisory. Measured facts, hypotheses and unknowns remain distinct in stored records.</p></div>;
}

function SettingsPage({go}:{go:(view:View)=>void}){
  const [domains,setDomains]=useState<Row[]|null>(null);const load=()=>api<Row[]>('/api/domains?includeArchived=true').then(setDomains);useEffect(()=>{void load()},[]);if(!domains)return <Loading/>;const archived=domains.filter(domain=>domain.archived_at);
  return <><Header eyebrow="Workspace settings" title="Private by construction." subtitle="SiteChronicle keeps measurements on this server and exposes destructive actions explicitly."/><section className="panel"><p className="eyebrow">Data boundaries</p><h2>What the system stores</h2><div className="privacy-grid"><Fact label="Third-party analytics" value="Not required"/><Fact label="Visitor cookies" value="None"/><Fact label="IP addresses" value="Not stored"/><Fact label="URL query strings" value="Discarded"/><Fact label="Site-changing AI tools" value="Disabled"/><Fact label="Evidence artifacts" value="SHA-256 addressed"/></div></section><section className="panel"><div className="panel-head"><div><p className="eyebrow">Archive</p><h2>Removed from portfolio</h2></div></div>{archived.length?archived.map(domain=><div className="schedule-row" key={domain.id}><span className="domain-icon">{domain.name.slice(0,2).toUpperCase()}</span><span><b>{domain.name}</b><small>{domain.origin} · archived {formatDate(domain.archived_at)}</small></span><button onClick={async()=>{await post(`/api/domains/${domain.id}/restore`,{});load()}}>Restore</button><button onClick={()=>go({name:'domain',id:domain.id})}>Inspect</button></div>):<Empty title="Archive is empty" text="Archived sites can be restored without losing evidence."/>}</section></>;
}

function DomainSettings({domain,go,onChanged}:{domain:Row;go:(view:View)=>void;onChanged:()=>void}){
  const [preview,setPreview]=useState<Row|null>(null);const [confirmation,setConfirmation]=useState('');useEffect(()=>{void api<Row>(`/api/domains/${domain.id}/deletion-preview`).then(setPreview)},[domain.id]);
  return <><section className="panel"><p className="eyebrow">Measurement</p><h2>Privacy controls</h2><TrackerPanel domainId={domain.id} data={domain} onChanged={onChanged}/></section><section className="panel danger-zone"><p className="eyebrow">Danger zone</p><h2>Remove this site</h2><div className="danger-actions"><div><b>Archive from portfolio</b><p>Stops schedules and hides the site. Audits, evidence and measurements remain recoverable.</p></div><button className="danger-button" onClick={async()=>{if(window.confirm(`Archive ${domain.name}?`)){await post(`/api/domains/${domain.id}/archive`,{});go({name:'dashboard'})}}}>Archive site</button></div><div className="danger-actions"><div><b>Permanently delete</b><p>{preview?`${preview.audits} audits, ${preview.evidence} evidence objects, ${preview.telemetry_samples} telemetry samples and ${preview.opportunities} opportunities will be removed.`:'Loading deletion impact…'}</p><label>Type “{domain.name}” to confirm<input value={confirmation} onChange={(event)=>setConfirmation(event.target.value)}/></label></div><button className="danger-button" disabled={confirmation!==domain.name} onClick={async()=>{if(window.confirm('This cannot be undone. Permanently delete this site?')){await api(`/api/domains/${domain.id}`,{method:'DELETE'});go({name:'dashboard'})}}}>Delete permanently</button></div></section></>;
}

function formatVital(metric:string,value:number|string){const number=Number(value??0);if(metric==='CLS')return number.toFixed(3);return `${Math.round(number)} ms`}

function RuleLibrary() {
  const [data, setData] = useState<Row>();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  useEffect(() => { void api<Row>('/api/rules').then(setData); }, []);
  if (!data) return <Loading />;
  const visible = data.categories.filter((rule: Row) => (category === 'all' || rule.category === category) && includesText(`${rule.category} ${rule.source}`, query));
  return (
    <>
      <Header eyebrow={`Ruleset ${data.version}`} title="Know what the scanner knows." subtitle="Browse measurement sources, boundaries and interpretation rules behind every finding." />
      <section className="principle-card"><Icon name="shield" /><div><p className="eyebrow">Governing principle</p><h2>{data.principle}</h2><p>Definitive findings must point to immutable captured evidence. Hypotheses remain explicitly labeled.</p></div></section>
      <section className="panel"><div className="browser-toolbar"><SearchInput value={query} onChange={setQuery} placeholder="Search categories or sources…" /><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{data.categories.map((rule: Row) => <option key={rule.category}>{rule.category}</option>)}</select></label></div><ResultBar count={visible.length} total={data.categories.length} label="categories" /><div className="rule-grid">{visible.map((rule: Row, index: number) => <article className="rule-card" key={rule.category}><span className="rule-index">{String(index + 1).padStart(2, '0')}</span><div><span className="category">{rule.category}</span>{rule.psychological && <span className="pill neutral">Proxy signals</span>}</div><h3>{rule.category}</h3><p>{rule.source}</p><footer><Icon name="check" />Evidence-backed output</footer></article>)}</div></section>
      <div className="two-column interpretation"><section className="panel"><p className="eyebrow">Measured</p><h2>Captured directly</h2><p>Values and defects observed in the run are tied to stored artifacts, hashes and timestamps.</p></section><section className="panel"><p className="eyebrow">Hypothesis</p><h2>Kept separate</h2><p>Potential impact and local cause remain qualified until artifacts or an experiment establish them.</p></section></div>
    </>
  );
}

function Header({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <header className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}

function Breadcrumb({ items }: { items: Array<{ label: string; onClick?: () => void }> }) {
  return <nav className="breadcrumb" aria-label="Breadcrumb">{items.map((item, index) => <span key={`${item.label}-${index}`}>{index > 0 && <i>/</i>}{item.onClick ? <button onClick={item.onClick}>{item.label}</button> : <b>{item.label}</b>}</span>)}</nav>;
}

function Tabs({ value, items, onChange }: { value: string; items: Array<{ value: string; label: string; count?: number }>; onChange: (value: string) => void }) {
  return <div className="tabs" role="tablist">{items.map((item) => <button role="tab" aria-selected={value === item.value} className={value === item.value ? 'active' : ''} key={item.value} onClick={() => onChange(item.value)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</div>;
}

function Metric({ label, value, tone, compact, icon }: { label: string; value: string | number; tone?: string; compact?: boolean; icon?: string }) {
  return <div className={`metric ${tone ?? ''} ${compact ? 'compact' : ''}`}><div><span>{label}</span>{icon && <Icon name={icon} />}</div><b>{value}</b></div>;
}

function Score({ label, value }: { label: string; value: number | null }) {
  const safe = value ?? 0;
  return <div className="score-card"><div className={`score-ring ${safe >= 90 ? 'good' : safe >= 50 ? 'mid' : 'poor'}`} style={{ '--score': `${safe * 3.6}deg` } as CSSProperties}><b>{value === null ? '—' : Math.round(value)}</b></div><span>{label}</span></div>;
}

function AuditTable({ audits, go, domainMap = {}, showDomain = false }: { audits: Row[]; go: (view: View) => void; domainMap?: Record<string, Row>; showDomain?: boolean }) {
  return audits.length ? <div className="table-wrap"><table className="audit-table"><thead><tr><th>Date</th>{showDomain && <th>Property</th>}<th>Status</th><th>Trigger</th><th>Pages</th><th>Average</th><th></th></tr></thead><tbody>{audits.map((audit) => { const domain = domainMap[audit.domain_id]; return <tr key={audit.id}><td><b>{formatDate(audit.created_at)}</b><small>{audit.id.slice(-10)}</small></td>{showDomain && <td><b>{domain?.name ?? 'Unknown property'}</b><small>{domain?.hostname ?? audit.domain_id}</small></td>}<td><span className={`pill ${audit.status}`}>{audit.status}</span></td><td>{audit.trigger ?? 'manual'}</td><td>{audit.summary?.pagesScanned ?? '—'}</td><td><ScoreValue scores={audit.scores} /></td><td><button onClick={() => go({ name: 'audit', id: audit.id })}>Open →</button></td></tr>; })}</tbody></table></div> : <Empty title="No audit runs" text="Start the first evidence-preserving scan." />;
}

function ScoreValue({ scores }: { scores: Row[] | undefined }) {
  const values = (scores ?? []).map((score) => score.score).filter((score): score is number => typeof score === 'number');
  if (!values.length) return <span className="muted">—</span>;
  const average = Math.round(values.reduce((sum, score) => sum + score, 0) / values.length);
  return <span className={`score-value ${average >= 90 ? 'good' : average >= 50 ? 'mid' : 'poor'}`}>{average}</span>;
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search-box"><span className="sr-only">Search</span><Icon name="search" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />{value && <button aria-label="Clear search" onClick={() => onChange('')}>×</button>}</label>;
}

function ResultBar({ count, total, label, onClear }: { count: number; total: number; label: string; onClear?: () => void }) {
  return <div className="result-bar"><span><b>{count}</b> of {total} {label}</span>{onClear && count !== total && <button onClick={onClear}>Clear filters</button>}</div>;
}

function Fact({ label, value, mono, badge }: { label: string; value: ReactNode; mono?: boolean; badge?: boolean }) {
  return <div className="fact"><span>{label}</span>{badge ? <span className={`pill ${value}`}>{value}</span> : <b className={mono ? 'mono' : ''}>{value}</b>}</div>;
}

function Toggle({ checked, onChange, title, text }: { checked: boolean; onChange: (checked: boolean) => void; title: string; text: string }) {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" /><span><b>{title}</b><small>{text}</small></span></label>;
}

function Progress({ status }: { status: string }) {
  return <div className="progress"><span /><div><b>{status === 'queued' ? 'Waiting for a worker' : 'Audit in progress'}</b><p>Discovery, browser evidence and rule evaluation run without form submission.</p></div></div>;
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="modal" role="dialog" aria-modal="true"><button className="modal-close" aria-label="Close" onClick={onClose}>×</button>{children}</section></div>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><div>◇</div><b>{title}</b><p>{text}</p></div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="empty error-state"><div>!</div><b>Unable to load this view</b><p>{message}</p><button onClick={onRetry}>Try again</button></div>;
}

function Loading() {
  return <div className="loading"><span />Loading…</div>;
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    pulse: <><path d="M3 12h4l2-6 4 12 2-6h6" /></>, book: <><path d="M4 5a3 3 0 0 1 3-2h5v18H7a3 3 0 0 0-3 2z" /><path d="M20 5a3 3 0 0 0-3-2h-5v18h5a3 3 0 0 1 3 2z" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>, search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3" cy="6" r="1" /><circle cx="3" cy="12" r="1" /><circle cx="3" cy="18" r="1" /></>,
    check: <path d="m5 12 4 4L19 6" />, alert: <><path d="M12 3 2 21h20L12 3z" /><path d="M12 9v5M12 18h.01" /></>,
    flag: <><path d="M5 22V4" /><path d="M5 4h11l-2 4 2 4H5" /></>, domain: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, shield: <><path d="M12 3 4 6v5c0 5 3 8 8 10 5-2 8-5 8-10V6z" /><path d="m9 12 2 2 4-5" /></>,
    sliders: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="7" cy="18" r="2" /></>,
    spark: <><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></>,
    trend: <><path d="M4 17 9 12l3 3 7-8"/><path d="M14 7h5v5"/></>,
    chat: <><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></>,
    pause: <><path d="M9 6v12M15 6v12"/></>,
    chevron: <path d="m8 10 4 4 4-4" />,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? <circle cx="12" cy="12" r="8" />}</svg>;
}

function formatDate(value: string) {
  return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

function formatDuration(start: string, end: string) {
  if (!start || !end) return '—';
  const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatBytes(value: number | string | undefined) {
  const bytes = Number(value ?? 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function includesText(haystack: string, needle: string) {
  return haystack.toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
}

function shortHash(value: unknown) {
  const text = String(value ?? '');
  return text ? `${text.slice(0, 16)}…` : '—';
}

function urlPath(value: string) {
  try { const url = new URL(value); return `${url.pathname}${url.search}` || '/'; } catch { return value || '—'; }
}

function urlHost(value: string) {
  try { return new URL(value).hostname; } catch { return 'Unknown host'; }
}

function statusGroup(status: number) {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'redirect';
  return 'error';
}

function chartColor(index: number) {
  return ['#2f776d', '#b98943', '#5376a3', '#9b5f86', '#ba6559', '#66865b', '#715e9b'][index % 7];
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function parseView(): View {
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'domains' && parts[1] && parts[2] === 'compare') return { name: 'compare', domainId: parts[1] };
  if (parts[0] === 'domains' && parts[1]) return { name: 'domain', id: parts[1] };
  if (parts[0] === 'audits' && parts[1]) return { name: 'audit', id: parts[1] };
  if (parts[0] === 'audits') return { name: 'audits' };
  if (parts[0] === 'opportunities') return { name: 'opportunities' };
  if (parts[0] === 'traffic') return { name: 'traffic' };
  if (parts[0] === 'automations') return { name: 'automations' };
  if (parts[0] === 'chat') return { name: 'chat' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'rules') return { name: 'rules' };
  return { name: 'dashboard' };
}
