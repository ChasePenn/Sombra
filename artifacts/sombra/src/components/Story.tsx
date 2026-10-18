import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { useSession } from '../lib/session';
import { featureCopy } from '../lib/features-copy';
import { ChevronRight, type IconComponent } from './Icon';

// sombra follows one day in the heat.
export type Story = 'before' | 'out' | 'others' | 'you';

export const storyTone: Record<Story, string> = { before: 'tone-orange', out: 'tone-blue', others: 'tone-green', you: 'tone-red' };

export function useStoryLabel() {
  const f = featureCopy[useSession().lang];
  return (story: Story) => ({ before: f.storyBefore, out: f.storyOut, others: f.storyOthers, you: f.storyYou })[story];
}

export function PageHead({ story, title, lead, action }: { story: Story; title: string; lead?: string; action?: ReactNode }) {
  return (
    <header className={`page-head ${action ? 'page-head-split' : ''}`}>
      <div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {action}
    </header>
  );
}

/** The natural next step after this screen, in the color of the part of the day it leads to. */
export function NextStep({ href, story, Icon, children }: { href: string; story: Story; Icon: IconComponent; children: ReactNode }) {
  return (
    <Link href={href} className={`next-step ${storyTone[story]}`}>
      <span className="quick-icon"><Icon size={20} strokeWidth={2.2} aria-hidden="true" /></span>
      <span>{children}</span>
      <ChevronRight size={20} aria-hidden="true" />
    </Link>
  );
}
