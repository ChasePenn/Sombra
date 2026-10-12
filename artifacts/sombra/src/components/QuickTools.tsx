import { Link } from 'wouter';
import { Clock, Droplet, HeartPulse, PhoneCall } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSession } from '../lib/session';
import { featureCopy } from '../lib/features-copy';

/** The four tools, shown up front: a compact row on Today, labeled cards on the landing page. */
export function QuickTools({ variant }: { variant: 'row' | 'cards' }) {
  const { lang } = useSession();
  const f = featureCopy[lang];
  const tools: Array<{ href: string; Icon: LucideIcon; tone: string; label: string; line: string }> = [
    { href: '/app/best-time', Icon: Clock, tone: 'tone-orange', label: f.quickBest, line: f.quickBestLine },
    { href: '/app/cool-spots', Icon: Droplet, tone: 'tone-blue', label: f.quickCool, line: f.quickCoolLine },
    { href: '/app/check-on', Icon: PhoneCall, tone: 'tone-green', label: f.quickCare, line: f.quickCareLine },
    { href: '/app/profile', Icon: HeartPulse, tone: 'tone-red', label: f.quickProfile, line: f.quickProfileLine },
  ];
  return (
    <nav className={`quick-tools quick-${variant}`} aria-label={f.quickTitle}>
      {tools.map(({ href, Icon, tone, label, line }) => (
        <Link key={href} href={href} className={`quick-tool ${tone}`}>
          <span className="quick-icon"><Icon size={variant === 'row' ? 22 : 24} strokeWidth={2.2} aria-hidden="true" /></span>
          <span className="quick-label">{label}</span>
          {variant === 'cards' && <small className="quick-line">{line}</small>}
        </Link>
      ))}
    </nav>
  );
}
