import { useEffect, useRef } from "react";
import { CircleAlert, Search } from "lucide-react";

const tones = {
  positive: "bg-positive-soft text-positive",
  caution: "bg-caution-soft text-caution",
  negative: "bg-negative-soft text-negative",
  accent: "bg-accent-soft text-accent",
  special: "bg-special-soft text-special",
  neutral: "bg-hover text-muted",
};

export function StatusBadge({ children, tone = "neutral", dot = true }) {
  return <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${tones[tone] ?? tones.neutral}`}>
    {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
    {children}
  </span>;
}

export function MetricCard({ title, value, description, icon: Icon, busy, tone = "accent" }) {
  return <div className="min-w-0 rounded-panel border border-line bg-panel p-4 shadow-panel">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-medium text-muted">{title}</p>
      {Icon && <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>
        <Icon size={17} aria-hidden="true" />
      </span>}
    </div>
    {busy ? <p role="status" className="mt-2 h-8 w-16 animate-pulse rounded bg-hover"><span className="sr-only">Loading {title}</span></p>
      : <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>}
    {description && <p className="mt-1 text-xs text-muted">{description}</p>}
  </div>;
}

export function PageHeader({ title, description, children, compact = false }) {
  return <div className={`flex flex-wrap items-end justify-between gap-3 ${compact ? "mb-4" : "mb-6"}`}>
    <div className="min-w-0">
      <h1 className="break-words text-[clamp(1.45rem,2.5vw,2rem)] font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
    </div>
    {children}
  </div>;
}

export function SearchField({ label, value, onChange, placeholder }) {
  return <label className="relative block min-w-0">
    <span className="sr-only">{label}</span>
    <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" size={16} aria-hidden="true" />
    <input type="search" className="field-control ps-9" value={value}
      onChange={(event) => onChange(event.target.value)} placeholder={placeholder || label} />
  </label>;
}

export function StateNotice({ children, error = false, loading = false }) {
  if (error) return <div role="alert" className="flex items-start gap-2 rounded-lg border border-negative-line bg-negative-soft p-3 text-sm text-negative">
    <CircleAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />{children}
  </div>;
  if (loading) return <div role="status" className="space-y-2 p-4 text-sm text-muted">
    <span>{children || "Loading…"}</span>
    <div aria-hidden="true" className="h-2 w-2/3 animate-pulse rounded-full bg-hover" />
    <div aria-hidden="true" className="h-2 w-2/5 animate-pulse rounded-full bg-hover" />
  </div>;
  return <p className="px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

export function Modal({ labelId, onClose, busy, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement;
    if (!node.open) node.showModal();
    return () => {
      requestAnimationFrame(() => {
        if (!node.isConnected && previous?.isConnected) previous.focus();
      });
    };
  }, []);
  return <dialog ref={dialog} aria-labelledby={labelId} onClose={onClose}
    onCancel={(event) => { if (busy) event.preventDefault(); }}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-panel border border-line bg-panel text-ink shadow-panel">
    {children}
  </dialog>;
}
