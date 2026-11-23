import { buttonClass, Input, Lookup, Notes, primaryClass, Select } from "./connectivity-ui";

export default function SimForm({ sim, onSave, onCancel, busy }) {
  const identifiers = [
    ["iccid", "ICCID", sim?.maskedIccid], ["imsi", "IMSI", sim?.maskedImsi], ["msisdn", "SIM phone number", sim?.maskedMsisdn],
  ];
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      for (const [name] of identifiers) {
        if (values[`clear-${name}`]) values[name] = null;
        else if (!values[name]?.trim()) delete values[name];
        delete values[`clear-${name}`];
      }
      onSave(values);
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="label" label="SIM label" value={sim?.label} required maxLength={150} />
        <Lookup path="/operators" params={{ active: "true" }} name="operatorId" label="Operator"
          value={sim?.operatorId} currentLabel={sim?.operatorName} blank="Operator unknown" />
        {identifiers.map(([name, label, masked]) => (
          <div className="space-y-1" key={name}>
            <Input name={name} label={label} inputMode="tel" maxLength={40} placeholder={masked || "Optional"} autoComplete="off" />
            {masked && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`clear-${name}`} /> Clear {label}</label>}
          </div>
        ))}
        <Select name="formFactor" label="Form factor" choices={[["physical", "Physical SIM"], ["esim", "eSIM"]]}
          value={sim?.formFactor ?? ""} blank="Unspecified" />
        <Input name="purchasedAt" label="Purchase date" type="date" value={sim?.purchasedAt} />
        <Input name="activatedAt" label="Activation date" type="date" value={sim?.activatedAt} />
        <Input name="supplierReference" label="Supplier reference" value={sim?.supplierReference} maxLength={150} />
        <Input name="purchaseCost" label="Purchase cost" type="number" min="0" step="0.01" value={sim?.purchaseCost} />
        <Input name="currency" label="Currency code" maxLength={3} value={sim?.currency} />
      </div>
      <Notes value={sim?.notes} />
      <div className="flex flex-wrap gap-2">
        <button className={primaryClass} disabled={busy}>{sim ? "Save SIM" : "Register SIM"}</button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
