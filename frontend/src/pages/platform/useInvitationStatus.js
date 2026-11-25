import { useEffect, useState } from "react";
import { platformApi,resellerApi } from "../../services/api";

export default function useInvitationStatus(tenantId, revision,reseller=false) {
  const [result,setResult] = useState(null);
  useEffect(()=>{
    if (!tenantId) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const {data} = await (reseller?resellerApi:platformApi).get(`${reseller?"/reseller/customers":"/platform/tenants"}/${tenantId}/invitations/status`,{signal:controller.signal});
        if (!controller.signal.aborted) setResult({tenantId,invitation:data.invitation});
      } catch {
        if (!controller.signal.aborted) setResult({tenantId,error:true});
      }
    };
    void refresh();
    const timer = setInterval(refresh,5000);
    return ()=>{controller.abort();clearInterval(timer);};
  },[tenantId,revision,reseller]);
  return result?.tenantId===tenantId ? result : null;
}
