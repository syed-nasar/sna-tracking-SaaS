import { StateNotice } from "../../components/WorkspaceUi";
import { field, label } from "./platform-operations-data";

export function ReadState({ result, children }) {
  if (result.loading) return <StateNotice loading>Loading…</StateNotice>;
  if (result.error) return <StateNotice error>{result.error} <button className="control" onClick={result.refresh}>Retry</button></StateNotice>;
  return children(result.data);
}

export function Paging({ pagination, change }) {
  return <div className="flex flex-wrap items-center gap-2">
    <button className="control" disabled={!pagination.offset} onClick={()=>change(Math.max(0,pagination.offset-pagination.limit))}>Previous</button>
    <button className="control" disabled={!pagination.hasMore} onClick={()=>change(pagination.offset+pagination.limit)}>Next</button>
  </div>;
}

export function Filter({ name,title,value,onChange,values,blank="All" }) {
  return <label className="grid gap-1 text-sm">{title}<select className={field} name={name} value={onChange ? value??"" : undefined} onChange={onChange}>
    <option value="">{blank}</option>{values.map(v=><option key={Array.isArray(v)?v[0]:v} value={Array.isArray(v)?v[0]:v}>
      {Array.isArray(v)?v[1]:label(v)}</option>)}
  </select></label>;
}

export function Table({ columns, rows, empty, rowKey = row => row.id }) {
  if (!rows.length) return <StateNotice>{empty}</StateNotice>;
  return <div className="overflow-x-auto" tabIndex={0}>
    <table className="w-full text-left text-sm"><thead className="bg-hover"><tr>
      {columns.map(([title])=><th key={title} scope="col" className="px-3 py-2">{title}</th>)}
    </tr></thead><tbody>{rows.map(row=><tr key={rowKey(row)} className="border-b border-line">
      {columns.map(([title,render])=><td key={title} className="px-3 py-2">{render(row)}</td>)}
    </tr>)}</tbody></table>
  </div>;
}
