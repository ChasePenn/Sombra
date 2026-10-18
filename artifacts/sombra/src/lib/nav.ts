/*
  Back buttons should stay inside the app. We count screen changes since the app
  loaded; with none, "back" would leave sombra (or land on a blank tab), so we go
  to a sensible screen instead.
*/
let screensVisited = 0;

export function noteScreenChange() {
  screensVisited += 1;
}

export function goBack(navigate: (to: string) => void, fallback: string) {
  if (screensVisited > 1) window.history.back();
  else navigate(fallback);
}

/*
  A new screen opens at the top. Going back (browser or phone back button) leaves the
  scroll alone so you return to where you were. Links to a section (#privacy) handle
  their own scrolling.
*/
let cameBack = false;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { cameBack = true; });

export function scrollForNewScreen() {
  const back = cameBack;
  cameBack = false;
  if (back || window.location.hash) return;
  window.scrollTo(0, 0);
}
