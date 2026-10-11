import { useEffect, useRef, useState } from 'react';
import type { Lang } from './copy';

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> ; resultIndex: number }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type RecCtor = new () => Rec;

function ctor(): RecCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeech(lang: Lang, onText: (text: string) => void) {
  const [supported] = useState(() => typeof window !== 'undefined' && !!ctor());
  const [listening, setListening] = useState(false);
  const [failed, setFailed] = useState(false);
  const recRef = useRef<Rec | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => () => recRef.current?.abort(), []);

  const start = () => {
    const C = ctor();
    if (!C) return;
    setFailed(false);
    try {
      const r = new C();
      r.lang = lang === 'es' ? 'es-US' : 'en-US';
      r.interimResults = false;
      r.continuous = false;
      r.onresult = (e) => {
        let text = '';
        for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
        if (text.trim()) cb.current(text.trim());
      };
      r.onerror = () => setFailed(true);
      r.onend = () => setListening(false);
      recRef.current = r;
      r.start();
      setListening(true);
    } catch {
      setFailed(true);
      setListening(false);
    }
  };
  const stop = () => { recRef.current?.stop(); setListening(false); };
  return { supported, listening, failed, start, stop };
}
