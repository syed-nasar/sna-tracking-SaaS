export default function FleetGroupFilter({ vehicles, value, onChange }) {
  const groups = new Map(vehicles.filter(({ groupId }) => groupId).map(({ groupId, groupName }) => [groupId, groupName]));
  return (
    <select aria-label="Vehicle group" value={value} onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2.5 text-sm text-white">
      <option value="">All groups</option>
      <option value="ungrouped">Ungrouped</option>
      {[...groups].sort(([, a], [, b]) => a.localeCompare(b)).map(([id, name]) => (
        <option key={id} value={id}>{name}</option>
      ))}
    </select>
  );
}
