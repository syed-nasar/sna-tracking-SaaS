import { useSyncExternalStore } from "react";
import { Contrast } from "lucide-react";

const storageKey = "sna-fleet.theme";
const updateEvent = "sna-fleet-theme-change";
const media = window.matchMedia("(prefers-color-scheme: dark)");
let fallback = null;

function preference() {
  if (fallback) return fallback;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // The current tab can still change its theme when storage is unavailable.
  }
  return "system";
}

function applyTheme() {
  const selected = preference();
  document.documentElement.dataset.theme = selected === "system" ? (media.matches ? "dark" : "light") : selected;
}

function setTheme(selected) {
  fallback = selected;
  try {
    localStorage.setItem(storageKey, selected);
    fallback = null;
  } catch {
    // Preserve the preference in this tab.
  }
  applyTheme();
  window.dispatchEvent(new Event(updateEvent));
}

media.addEventListener("change", applyTheme);
window.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === null) applyTheme();
});

function subscribe(notify) {
  window.addEventListener(updateEvent, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(updateEvent, notify);
    window.removeEventListener("storage", notify);
  };
}

export default function ThemeSelector({ showLabel = false }) {
  const selected = useSyncExternalStore(subscribe, preference);
  return <label className="inline-flex max-w-full items-center gap-2 text-xs font-semibold text-muted">
    <Contrast size={16} aria-hidden="true" className={showLabel ? "" : "hidden sm:block"} />
    {showLabel && <span>Appearance</span>}
    <select aria-label="Color theme" className="control max-w-full px-2 text-xs"
      value={selected} onChange={(event) => setTheme(event.target.value)}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>;
}
