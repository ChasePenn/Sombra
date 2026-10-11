import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Clock, Droplet, PhoneCall, TriangleAlert } from 'lucide-react';
import { useSession } from '../lib/session';
import { fill } from '../lib/copy';
import { featureCopy } from '../lib/features-copy';
import { getCareContacts, getLastPlace } from '../lib/local';
import { isDue } from '../lib/care';

type Alert = { event: string; kind: string; ends?: string | null };

function untilText(iso: string | null | undefined, lang: string) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(lang, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix' }).format(date);
}

/** Puts the right tool on the Today screen at the right moment. */
export function ContextCards({ maxCategory }: { maxCategory: number | null }) {
  const { lang } = useSession();
  const f = featureCopy[lang];
  const [heatAlert, setHeatAlert] = useState<Alert | null>(null);
  const dueContact = getCareContacts().find((c) => isDue(c));

  useEffect(() => {
    const place = getLastPlace();
    if (!place) return;
    let live = true;
    fetch(`/api/conditions?lat=${place.lat}&lon=${place.lon}`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { alerts: Alert[] | null } | null) => { if (live) setHeatAlert(d?.alerts?.find((a) => a.kind === 'heat') ?? null); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [maxCategory]);

  const showHot = maxCategory != null && maxCategory >= 4;
  if (!heatAlert && !showHot) return null;

  return (
    <div className="ctx-cards">
      {heatAlert && (
        <section className="ctx-card ctx-heat" aria-live="polite">
          <h2><TriangleAlert size={20} aria-hidden="true" />{fill(f.ctxHeatTitle, { event: heatAlert.event })}</h2>
          <p>{untilText(heatAlert.ends, lang) ? fill(f.ctxHeatUntil, { time: untilText(heatAlert.ends, lang) }) : f.ctxHeatBody}</p>
          <div className="ctx-actions">
            <Link href="/app/cool-spots" className="btn btn-white"><Droplet size={18} aria-hidden="true" />{f.ctxCool}</Link>
            {dueContact && <Link href="/app/check-on" className="btn btn-white"><PhoneCall size={18} aria-hidden="true" />{fill(f.ctxCheck, { name: dueContact.name })}</Link>}
          </div>
        </section>
      )}
      {showHot && !heatAlert && (
        <section className="ctx-card ctx-hot">
          <h2><Clock size={20} aria-hidden="true" />{f.ctxHotTitle}</h2>
          <p>{f.ctxHotBody}</p>
          <div className="ctx-actions">
            <Link href="/app/best-time" className="btn btn-white">{f.ctxBest}</Link>
          </div>
        </section>
      )}
    </div>
  );
}
