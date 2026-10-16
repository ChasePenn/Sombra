import { intensities, type Intensity, type Lang } from '../lib/copy';

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function IntensityPicker({ lang, label, value, onChange }: { lang: Lang; label: string; value: Intensity; onChange: (v: Intensity) => void }) {
  const opts = intensities(lang);
  const ex = opts.find((o) => o.value === value)?.example;
  return (
    <div>
      <Segmented label={label} value={value} options={opts.map((o) => ({ value: o.value, label: o.label }))} onChange={onChange} />
      {ex && <p className="seg-hint">{ex}</p>}
    </div>
  );
}

export function LanguagePicker({ label, value, onChange }: { label: string; value: Lang; onChange: (v: Lang) => void }) {
  return <Segmented label={label} value={value} options={[{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }]} onChange={onChange} />;
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="switch-hit">
      <button type="button" role="switch" className="switch" aria-checked={Boolean(checked)} aria-label={label} onClick={() => onChange(!checked)} />
    </span>
  );
}
