// Back buttons should stay inside the app.
let screensVisited = 0;

export function noteScreenChange() {
  screensVisited += 1;
}

export function goBack(navigate: (to: string) => void, fallback: string) {
  if (screensVisited > 1) window.history.back();
  else navigate(fallback);
}

// A new screen opens at the top.
let cameBack = false;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { cameBack = true; });

export function scrollForNewScreen() {
  const back = cameBack;
  cameBack = false;
  if (back || window.location.hash) return;
  window.scrollTo(0, 0);
}
