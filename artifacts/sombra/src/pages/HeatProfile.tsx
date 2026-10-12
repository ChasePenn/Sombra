import { useState } from 'react';
import { CalendarClock, Check, ChevronRight, Info, Lock, Settings } from 'lucide-react';
import { Link } from 'wouter';
import { AppShell } from '../components/AppShell';
import { NextStep, PageHead } from '../components/Story';
import { useSession } from '../lib/session';
import { featureCopy } from '../lib/features-copy';
import { getRiskFactors, RISK_FACTORS, setRiskFactors, type RiskFactor } from '../lib/local';

export default function HeatProfile() {
  const { lang, t } = useSession();
  const f = featureCopy[lang];
  const [selected, setSelected] = useState<RiskFactor[]>(getRiskFactors);
  const [failed, setFailed] = useState(false);

  const toggle = (factor: RiskFactor) => {
    const next = selected.includes(factor) ? selected.filter((x) => x !== factor) : [...selected, factor];
    // Only show the change if it was actually saved, so the plan and this screen agree.
    if (!setRiskFactors(next)) { setFailed(true); return; }
    setFailed(false);
    setSelected(next);
  };

  return (
    <AppShell>
      <div className="page">
        <PageHead story="you" title={f.profileTitle} lead={f.profileSub} />
        <p className="privacy-note"><Lock size={16} aria-hidden="true" />{f.profilePrivacy}</p>
        <div className="check-list" role="group" aria-label={f.profileTitle}>
          {RISK_FACTORS.map((factor) => {
            const on = selected.includes(factor);
            return (
              <div key={factor} className={`check-wrap ${on ? 'is-on' : ''}`}>
                <button type="button" className="check-item" aria-pressed={on} onClick={() => toggle(factor)}>
                  <span className="check-box" aria-hidden="true">{on && <Check size={18} strokeWidth={3} />}</span>
                  {f.risk[factor]}
                </button>
                {on && <p className="check-tip">{f.tips[factor]}</p>}
              </div>
            );
          })}
        </div>
        {failed && <p className="error" role="alert">{f.saveFailed}</p>}
        <p className={selected.length ? 'status-on' : 'notice'} role="status">{selected.length ? f.profileActive : f.profileNone}</p>
        <p className="fine-print">{f.profileNote}</p>
        <NextStep href="/app" story="before" Icon={CalendarClock}>{f.nextProfile}</NextStep>
        {/* Settings and About live here, so the top bar stays simple. */}
        <nav className="link-list" aria-label={t.settings}>
          <Link href="/settings"><Settings size={20} aria-hidden="true" /><span>{t.settings}</span><ChevronRight size={20} aria-hidden="true" /></Link>
          <Link href="/about"><Info size={20} aria-hidden="true" /><span>{t.aboutSombra}</span><ChevronRight size={20} aria-hidden="true" /></Link>
        </nav>
      </div>
    </AppShell>
  );
}
