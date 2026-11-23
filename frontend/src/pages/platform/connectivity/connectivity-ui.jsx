import { useState } from "react";
import { useConnectivityGet } from "./connectivity-data";

export const fieldClass = "w-full min-w-0 rounded-lg border border-white/15 bg-[#090d16] px-3 py-2 text-sm";
export const panelClass = "min-w-0 space-y-4 rounded-xl border border-white/10 bg-[#111827] p-4 sm:p-5";
export const buttonClass = "rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-50";
export const primaryClass = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50";


export function ReadState({ data, error, empty = false, emptyText = "No records found." }) {
  if (error) return <p role="alert" className="break-words text-sm text-red-300">{error}</p>;
  if (!data) return <p role="status" className="text-sm text-slate-400">Loading…</p>;
  if (empty) return <p className="text-sm text-slate-400">{emptyText}</p>;
  return null;
}

export function Pagination({ result, offset, onChange }) {
  if (!result) return null;
  const { limit, hasMore } = result.pagination;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={!offset} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</button>
      <button type="button" className={buttonClass} disabled={!hasMore} onClick={() => onChange(offset + limit)}>Next</button>
    </div>
  );
}

export function Input({ name, label, value, type = "text", ...props }) {
  return (
    <label className="block min-w-0 space-y-1 text-sm">{label}
      <input className={fieldClass} name={name} type={type} defaultValue={value ?? ""} {...props} />
    </label>
  );
}

export function Select({ name, label, choices, value = "", blank, ...props }) {
  return (
    <label className="block min-w-0 space-y-1 text-sm">{label}
      <select className={fieldClass} name={name} defaultValue={value} {...props}>
        {blank && <option value="">{blank}</option>}
        {choices.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
      </select>
    </label>
  );
}

export function Notes({ name = "notes", label = "Internal notes", value, maxLength = 2000 }) {
  return (
    <label className="block space-y-1 text-sm">{label}
      <textarea className={fieldClass} name={name} defaultValue={value ?? ""} rows={3} maxLength={maxLength} />
    </label>
  );
}

export function Lookup({ path, params, name, label, value, currentLabel, onChange, disabled, required, blank = "Select a record", apiRoot, formatOption }) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(value ? { id: value, name: currentLabel || `#${value}` } : null);
  const { data, error } = useConnectivityGet(path, { ...params, q: query, offset }, 0, apiRoot);
  const rows = data?.data ?? [];
  const options = selected && !rows.some((row) => row.id === selected.id) ? [selected, ...rows] : rows;
  return (
    <div className="min-w-0 space-y-2">
      <label className="block text-sm">Search {label.toLowerCase()}
        <input className={fieldClass} value={query} maxLength={150} disabled={disabled}
          onChange={(event) => { setQuery(event.target.value); setOffset(0); }} />
      </label>
      <label className="block text-sm">{label}
        <select className={fieldClass} name={name} required={required} disabled={disabled} value={selected?.id ?? ""}
          onChange={(event) => {
            const next = options.find((row) => row.id === event.target.value);
            setSelected(next ?? null);
            onChange?.(next ?? null);
          }}>
          <option value="">{blank}</option>
          {options.map((row) => <option value={row.id} key={row.id}>
            {formatOption ? formatOption(row) : row.name}{row.tenantName ? ` · ${row.tenantName}` : ""}
            {row.simLabel ? ` · SIM ${row.simLabel}` : ""}
          </option>)}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {data && (offset > 0 || data.pagination.hasMore) && <Pagination result={data} offset={offset} onChange={setOffset} />}
    </div>
  );
}

