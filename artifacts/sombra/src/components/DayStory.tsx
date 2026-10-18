import { Link } from 'wouter';
import { useSession } from '../lib/session';
import { featureCopy } from '../lib/features-copy';
import { Calendar, Clock, Drop, Heart, Phone, Thermometer, type IconComponent } from './Icon';

type Tool = { href: string; Icon: IconComponent; label: string; tone: 'orange' | 'ink' };

// Everything sombra does, in the order of a day outside.
export function DayStory() {
  const f = featureCopy[useSession().lang];
  const tools: Tool[] = [
    { href: '/app', Icon: Calendar, label: f.quickPlan, tone: 'orange' },
    { href: '/app/best-time', Icon: Clock, label: f.quickBest, tone: 'orange' },
    { href: '/app/check-in', Icon: Thermometer, label: f.quickCheck, tone: 'ink' },
    { href: '/app/cool-spots', Icon: Drop, label: f.quickCool, tone: 'ink' },
    { href: '/app/check-on', Icon: Phone, label: f.quickCare, tone: 'orange' },
    { href: '/app/profile', Icon: Heart, label: f.quickProfile, tone: 'ink' },
  ];
  return (
    <ul className="day-tools-list">
      {tools.map(({ href, Icon, label, tone }) => (
        <li key={href}>
          <Link href={href} className="quick-tool">
            <span className={`badge badge-${tone}`}><Icon size={22} strokeWidth={2.4} aria-hidden="true" /></span>
            <span className="quick-label">{label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
