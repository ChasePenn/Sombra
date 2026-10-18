import { Icon } from './Icon';
import { availableModes, type AudienceModeId, type Lang } from '../lib/copy';

export function ModePicker({
  lang,
  selected,
  onSelect,
}: {
  lang: Lang;
  selected: AudienceModeId;
  onSelect: (id: AudienceModeId) => void;
}) {
  const modes = availableModes(lang);
  return (
    <div className="mode-choice-list" role="radiogroup" aria-label={modes[0]?.welcomeQuestion ?? modes[0]?.name ?? 'Audience'}>
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          role="radio"
          aria-checked={selected === mode.id}
          className={`mode-choice tone-${({ work: 'orange', school: 'blue', everyday: 'green' } as Record<string, string>)[mode.id] ?? 'orange'}`}
          onClick={() => onSelect(mode.id)}
        >
          <span className="mode-choice-icon"><Icon name={mode.icon} size={26} /></span>
          <span className="mode-choice-copy"><strong>{mode.name}</strong></span>
          <span className="mode-choice-mark" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

// Always-visible switch on Today, so nobody mistakes sombra for a school-only.
export function ModeBar({
  lang,
  label,
  selected,
  busy,
  onSelect,
}: {
  lang: Lang;
  label: string;
  selected: AudienceModeId;
  busy?: boolean;
  onSelect: (id: AudienceModeId) => void;
}) {
  const modes = availableModes(lang);
  return (
    <div className="mode-bar">
      <span className="mode-bar-label" id="mode-bar-label">{label}</span>
      <div className="mode-bar-options" role="radiogroup" aria-labelledby="mode-bar-label" aria-busy={busy || undefined}>
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={selected === mode.id}
            disabled={busy}
            className={`mode-bar-option tone-${({ work: 'orange', school: 'blue', everyday: 'green' } as Record<string, string>)[mode.id] ?? 'orange'}`}
            onClick={() => onSelect(mode.id)}
          >
            <Icon name={mode.icon} size={18} />
            <span>{mode.shortName}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
