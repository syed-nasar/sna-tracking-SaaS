export function reportFeedback({ totals, omitted, zeroDurationIntervals, vehicles }) {
  const messages = [];
  if (omitted > 0) {
    messages.push(omitted === 1
      ? "1 interval was omitted because it did not meet reporting validation requirements."
      : `${omitted} intervals were omitted because they did not meet reporting validation requirements.`);
  }
  if (totals.partialDistance) messages.push("GPS-derived distance is incomplete.");
  if (vehicles.some((vehicle) => !vehicle.historyAvailable)) {
    messages.push("Vehicles without a verified installation have no historical telemetry.");
  }
  if (zeroDurationIntervals > 0 && totals.activeVehicles === 0) {
    messages.push("There are too few verified GPS observations to establish a trip or stop duration.");
  }
  return messages;
}
