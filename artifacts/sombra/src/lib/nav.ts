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
