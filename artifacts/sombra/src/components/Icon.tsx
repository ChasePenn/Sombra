import type { CSSProperties, ReactElement } from 'react';
import { GLYPHS, type GlyphName } from '../lib/glyphs';

export type IconProps = { size?: number; strokeWidth?: number; className?: string; fill?: string; style?: CSSProperties; 'aria-hidden'?: boolean | 'true' | 'false' };
export type IconComponent = (props: IconProps) => ReactElement;

function Glyph({ name, size = 24, strokeWidth = 2, className, fill, style }: IconProps & { name: GlyphName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill === 'currentColor' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: GLYPHS[name] }}
    />
  );
}

const make = (name: GlyphName): IconComponent => {
  const C = (props: IconProps) => <Glyph name={name} {...props} />;
  C.displayName = `Icon(${name})`;
  return C;
};

// Named the way the screens use them.
export const X = make('x');
export const ChevronRight = make('chevron-right');
export const ChevronLeft = make('chevron-left');
export const ChevronDown = make('chevron-down');
export const Plus = make('plus');
export const Check = make('check');
export const Pencil = make('pencil');
export const Trash = make('trash');
export const Search = make('search');
export const Share = make('share');
export const Sliders = make('sliders');
export const Lock = make('lock');
export const Info = make('info');
export const Alert = make('alert');
export const Ban = make('ban');
export const Play = make('play');
export const Stop = make('stop');
export const Mic = make('mic');
export const MicOff = make('mic-off');
export const Clock = make('clock');
export const Calendar = make('calendar');
export const Bell = make('bell');
export const BellOff = make('bell-off');
export const BellRing = make('bell-ring');
export const MapIcon = make('map');
export const Pin = make('pin');
export const Locate = make('locate');
export const Go = make('go');
export const Phone = make('phone');
export const House = make('house');
export const Book = make('book');
export const Building = make('building');
export const Bag = make('bag');
export const Umbrella = make('umbrella');
export const Cross = make('cross');
export const Drop = make('drop');
export const Drops = make('drops');
export const Snowflake = make('snowflake');
export const Thermometer = make('thermometer');
export const Heart = make('heart');
export const Cup = make('cup');
export const Clipboard = make('clipboard');
export const User = make('user');
export const Users = make('users');

// Tab and mode icons are picked by name from the mode configs.
const byName: Record<string, GlyphName> = {
  'hard-hat': 'hard-hat',
  student: 'student',
  'sun-horizon': 'sun-horizon',
  gear: 'sliders',
  'users-three': 'users',
  check: 'check',
  map: 'map',
  you: 'user',
};

export function Icon({ name, size = 24, strokeWidth = 2 }: { name: string; size?: number; strokeWidth?: number }) {
  return <Glyph name={byName[name] ?? 'sun-horizon'} size={size} strokeWidth={strokeWidth} />;
}
