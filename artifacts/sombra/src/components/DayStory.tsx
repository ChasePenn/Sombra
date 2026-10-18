import { Link } from 'wouter';
import { useSession } from '../lib/session';
import { featureCopy } from '../lib/features-copy';
import { storyTone, useStoryLabel, type Story } from './Story';
import { Calendar, Clock, Drop, Heart, Phone, Thermometer, type IconComponent } from './Icon';

type Tool = { href: string; Icon: IconComponent; label: string; line: string };

/**
 * Everything sombra does, laid out as one day: before you go, while you're out, looking
 * out for others, your body. Each tool still works on its own; this shows how they fit.
 */
export function DayStory() {
  const { lang } = useSession();
  const f = featureCopy[lang];
  const label = useStoryLabel();
  const steps: Array<{ story: Story; tools: Tool[] }> = [
    { story: 'before', tools: [
      { href: '/app', Icon: Calendar, label: f.quickPlan, line: f.quickPlanLine },
      { href: '/app/best-time', Icon: Clock, label: f.quickBest, line: f.quickBestLine },
    ] },
    { story: 'out', tools: [
      { href: '/app/check-in', Icon: Thermometer, label: f.quickCheck, line: f.quickCheckLine },
      { href: '/app/cool-spots', Icon: Drop, label: f.quickCool, line: f.quickCoolLine },
    ] },
    { story: 'others', tools: [{ href: '/app/check-on', Icon: Phone, label: f.quickCare, line: f.quickCareLine }] },
    { story: 'you', tools: [{ href: '/app/profile', Icon: Heart, label: f.quickProfile, line: f.quickProfileLine }] },
  ];
  return (
    <ol className="day-story">
      {steps.map(({ story, tools }) => (
        <li key={story} className={`day-step ${storyTone[story]}`}>
          <span className="story-tag">{label(story)}</span>
          <div className="day-tools">
            {tools.map(({ href, Icon, label: name, line }) => (
              <Link key={href} href={href} className="quick-tool">
                <span className="quick-icon"><Icon size={22} strokeWidth={2.2} aria-hidden="true" /></span>
                <span className="quick-label">{name}</span>
                <small className="quick-line">{line}</small>
              </Link>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
