import { useEffect, useState } from "react";
import { platformApi } from "../../services/api";

export default function useInvitationStatus(tenantId, revision) {
  const [result,setResult] = useState(null);
  useEffect(()=>{
    if (!tenantId) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const {data} = await platformApi.get(`/platform/tenants/${tenantId}/invitations/status`,{signal:controller.signal});
        if (!controller.signal.aborted) setResult({tenantId,invitation:data.invitation});
      } catch {
        if (!controller.signal.aborted) setResult({tenantId,error:true});
      }
    };
    void refresh();
    const timer = setInterval(refresh,5000);
    return ()=>{controller.abort();clearInterval(timer);};
  },[tenantId,revision]);
  return result?.tenantId===tenantId ? result : null;
}
