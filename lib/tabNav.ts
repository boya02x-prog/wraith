// A tap on the bottom tab bar is a TAB switch. Whatever screen it leaves and whatever screen it opens, the new screen eases in the same short way
// (components/RouteFade.tsx reads this; the sideways slide is only for going INTO a screen, or back out of one).
let target: string | null = null;
let at = 0;

/** Called by the tab bar on every tap, before the navigation starts, with the screen the tab opens. */
export const markTabTap = (href: string) => { target = href; at = Date.now(); };

/**
 * Is the screen that just opened the one a tab bar tap asked for? RouteFade asks this once per screen change, so the answer is used up: a tap that
 * only switched a section of the home screen (no screen change) is forgotten after 1.5 s, and never turns a later "open a token" into a tab switch.
 */
export const takeTabTap = (path: string) => {
  const yes = target === path && Date.now() - at < 1500;
  target = null;
  return yes;
};
