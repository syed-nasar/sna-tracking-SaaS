import { Link } from "react-router-dom";
import { MetricCard, PageHeader } from "../../components/WorkspaceUi";
import ConnectivitySummary from "./connectivity/ConnectivitySummary";
import { useConnectivityGet } from "./connectivity/connectivity-data";
import { BillingReport } from "../billing/BillingOverview";
import { ReadState } from "./PlatformOperationsUi";
import { date,label,panel,usePlatformRead } from "./platform-operations-data";

const groups=[
  ["Customers","customers","/platform/customers"],
  ["Resellers","resellers","/platform/resellers"],
  ["Vehicles","vehicles","/platform/vehicles"],
  ["GPS inventory","gps","/platform/devices"],
  ["GPS provisioning","provisioning","/platform/operations"],
];
const display={with_gps:"Vehicles with GPS",without_gps:"Vehicles without GPS",
  unverified_history:"Linked vehicles without verified history",legacy:"Legacy needing verification",retry:"Retry scheduled"};
const filters={
  customers:{personal:"type=personal",business:"type=business",active:"status=active",
    suspended:"status=suspended",direct:"ownership=direct",reseller_owned:"ownership=reseller"},
  resellers:{active:"status=active",suspended:"status=suspended"},
  vehicles:{active:"status=active",with_gps:"gps=installed",without_gps:"gps=uninstalled",unverified_history:"gps=unverified"},
  gps:Object.fromEntries(["available","reserved","installed","faulty","retired"].map(value=>[value,"lifecycle="+value])),
  provisioning:Object.fromEntries(["pending","processing","retry","provisioned","failed","conflict","legacy"]
    .map(value=>[value,"status="+value])),
};

export default function PlatformDashboard() {
  const result=usePlatformRead("/platform/ops/summary");
  const connectivity=useConnectivityGet("/summary");
  return <main className="mx-auto max-w-screen-2xl space-y-5 p-4 sm:p-6">
    <PageHeader title="Platform Dashboard"><div className="flex flex-wrap gap-2">
      <Link className="control" to="/platform/customers">Browse customers</Link>
      <Link className="control" to="/platform/operations">Operations Center</Link>
      <button className="control" onClick={result.refresh}>Refresh summary</button>
    </div></PageHeader>
    <ReadState result={result}>{data=><>
      <p className="text-sm text-muted">Summary generated {date(data.generatedAt)}</p>
      {groups.map(([title,key,path])=><section className={panel} key={key}>
        <h2 className="font-semibold">{title}</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          {Object.entries(key==="provisioning"?data[key].counts:data[key]).map(([name,value])=>
            <Link to={filters[key]?.[name]?path+"?"+filters[key][name]:path} key={name}>
              <MetricCard title={display[name]??label(name)} value={value}/>
            </Link>)}
        </div>
        {key==="provisioning"&&<p className="text-sm text-muted">
          {data[key].oldest_work_at?`Oldest outstanding provisioning request: ${date(data[key].oldest_work_at)}`:"No outstanding provisioning requests."}
        </p>}
      </section>)}
    </>}</ReadState>
    <ConnectivitySummary {...connectivity} compact />
    <BillingReport compact />
  </main>;
}
