export default function FleetGroupFilter({ vehicles, value, onChange }) {
  const groups = new Map(vehicles.filter(({ groupId }) => groupId).map(({ groupId, groupName }) => [groupId, groupName]));
  return (
    <select aria-label="Vehicle group" value={value} onChange={(event) => onChange(event.target.value)}
      className="field-control">
      <option value="">All groups</option>
      <option value="ungrouped">Ungrouped</option>
      {[...groups].sort(([, a], [, b]) => a.localeCompare(b)).map(([id, name]) => (
        <option key={id} value={id}>{name}</option>
      ))}
    </select>
  );
}
