import { useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { useSession } from '../lib/session';
import { featureCopy } from '../lib/features-copy';
import { getRiskFactors, RISK_FACTORS, setRiskFactors, type RiskFactor } from '../lib/local';

export default function HeatProfile() {
  const { lang } = useSession();
  const f = featureCopy[lang];
  const [selected, setSelected] = useState<RiskFactor[]>(getRiskFactors);

  const toggle = (factor: RiskFactor) => {
    const next = selected.includes(factor) ? selected.filter((x) => x !== factor) : [...selected, factor];
    setSelected(next);
    setRiskFactors(next);
  };

  return (
    <AppShell>
      <div className="page">
        <header className="page-head">
          <h1>{f.profileTitle}</h1>
          <p>{f.profileSub}</p>
        </header>
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
        <p className={selected.length ? 'status-on' : 'notice'} role="status">{selected.length ? f.profileActive : f.profileNone}</p>
        <p className="fine-print">{f.profileNote}</p>
      </div>
    </AppShell>
  );
}
