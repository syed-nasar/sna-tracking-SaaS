import { useEffect,useRef,useState } from "react";
import { platformApi,tenantApi } from "../../services/api";

export const platformRoot = "/platform/billing";
export const tenantRoot = "/billing";
export const utcDay = () => new Date().toISOString().slice(0,10);
export const title = (value) => value?.replaceAll("_"," ") ?? "—";
export function money(value,currency) {
  if (value == null) return "—";
  const [whole,fraction=""] = String(value).split(".");
  const scale = currency==="PKR" ? 2 :
    new Intl.NumberFormat("en",{ style:"currency",currency }).resolvedOptions().maximumFractionDigits;
  const shown = fraction.replace(/0+$/,"").padEnd(scale,"0");
  return `${currency} ${whole}${shown ? "."+shown : ""}`;
}
export const dataFrom = (event) => Object.fromEntries(new FormData(event.currentTarget));
export const errorMessage = (error) => error.response?.data?.message || "Could not complete the billing request.";

export function useBillingGet(path, params, revision = 0, platform = true) {
  const [result,setResult] = useState({ key:null,data:null,error:"" });
  const key = path ? JSON.stringify([path,params,revision,platform]) : null;
  useEffect(() => {
    if (!key) return;
    const [url,query,,admin] = JSON.parse(key);
    const controller = new AbortController();
    (admin ? platformApi : tenantApi).get((admin ? platformRoot : tenantRoot) + url,{ params:query,signal:controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setResult({ key,data,error:"" }); })
      .catch((error) => { if (!controller.signal.aborted) setResult({ key,data:null,error:errorMessage(error) }); });
    return () => controller.abort();
  },[key]);
  return result.key === key ? result : { data:null,error:"" };
}

export function useBillingWrite(onChanged) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const inFlight = useRef(false);
  async function submit(method,path,data,onSaved) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await platformApi.request({ method,url:platformRoot+path,data });
      setNotice(response.data.replayed ? "This request was already recorded." : "Saved.");
      onSaved?.(response.data);
      onChanged?.();
      return response.data;
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy,error,notice,submit };
}

export function useRequestKey() {
  const value = useRef(null);
  return {
    prepare(payload) {
      const signature = JSON.stringify(payload);
      if (value.current?.signature !== signature) value.current = { signature,key:crypto.randomUUID() };
      return { ...payload, requestKey:value.current.key };
    },
    reset() { value.current = null; },
  };
}
