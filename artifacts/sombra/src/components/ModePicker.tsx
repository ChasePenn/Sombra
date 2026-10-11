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
          <span className="mode-choice-copy"><strong>{mode.name}</strong><small>{mode.description}</small></span>
          <span className="mode-choice-mark" aria-hidden="true">{selected === mode.id ? '✓' : ''}</span>
        </button>
      ))}
    </div>
  );
}
