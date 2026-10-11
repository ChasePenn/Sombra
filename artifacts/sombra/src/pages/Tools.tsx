import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronRight, Clock, HeartPulse, PhoneCall, Droplet, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { useSession } from '../lib/session';
import { currentMode, fill } from '../lib/copy';
import { featureCopy } from '../lib/features-copy';
import { getRiskFactors, isGroupEnabled, setGroupEnabled } from '../lib/local';

function ToolCard({ href, Icon, tone, title, body, badge }: { href: string; Icon: LucideIcon; tone: string; title: string; body: string; badge?: string }) {
  return (
    <Link href={href} className={`tool-card ${tone}`}>
      <span className="mode-choice-icon"><Icon size={24} strokeWidth={2.2} aria-hidden="true" /></span>
      <span className="tool-copy">
        <strong>{title}</strong>
        <small>{body}</small>
        {badge && <em className="tool-badge">{badge}</em>}
      </span>
      <ChevronRight size={20} aria-hidden="true" className="landing-mode-arrow" />
    </Link>
  );
}

export default function Tools() {
  const { lang } = useSession();
  const f = featureCopy[lang];
  const group = currentMode(lang).group;
  const [groupOn, setGroupOn] = useState(isGroupEnabled);
  const [, setLocation] = useLocation();
  const riskOn = getRiskFactors().length > 0;

  useEffect(() => {
    const sync = () => setGroupOn(isGroupEnabled());
    window.addEventListener('sombra:local', sync);
    return () => window.removeEventListener('sombra:local', sync);
  }, []);

  return (
    <AppShell>
      <div className="page">
        <header className="page-head">
          <h1>{f.toolsTitle}</h1>
          <p>{f.toolsSub}</p>
        </header>
        <div className="tool-list">
          <ToolCard href="/app/best-time" Icon={Clock} tone="tone-orange" title={f.bestTitle} body={f.bestCard} />
          <ToolCard href="/app/cool-spots" Icon={Droplet} tone="tone-blue" title={f.coolTitle} body={f.coolCard} />
          <ToolCard href="/app/check-on" Icon={PhoneCall} tone="tone-green" title={f.careTitle} body={f.careCard} />
          <ToolCard href="/app/profile" Icon={HeartPulse} tone="tone-red" title={f.profileTitle} body={f.profileCard} badge={riskOn ? f.profileOn : undefined} />
          {groupOn ? (
            <ToolCard href="/app/crew" Icon={Users} tone="tone-brown" title={group} body={fill(f.groupCardOn, { group: group.toLowerCase() })} />
          ) : (
            <div className="tool-card tone-brown">
              <span className="mode-choice-icon"><Users size={24} strokeWidth={2.2} aria-hidden="true" /></span>
              <span className="tool-copy">
                <strong>{f.groupTitleOff}</strong>
                <small>{fill(f.groupCardOff, { group: group.toLowerCase() })}</small>
              </span>
              <button type="button" className="btn btn-secondary tool-btn" onClick={() => { setGroupEnabled(true); setLocation('/app/crew'); }}>{f.groupTurnOn}</button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
