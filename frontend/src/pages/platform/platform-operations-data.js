import { useEffect, useState } from "react";
import { platformApi } from "../../services/api";

export const panel = "min-w-0 space-y-3 rounded-panel border border-line bg-panel p-4";
export const field = "field-control";
export const date = value => value ? new Date(value).toLocaleString() : "Unavailable";
export const label = value => value?.replaceAll("_"," ") ?? "Unavailable";

export function usePlatformRead(path, params = "", delay = 0) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const key = JSON.stringify([path,params,revision]);
  useEffect(()=>{
    const controller = new AbortController();
    const timer = setTimeout(async()=>{
      try {
        const {data}=await platformApi.get(path,{params:new URLSearchParams(params),signal:controller.signal,timeout:12000});
        if (!controller.signal.aborted) setResult({key,data});
      } catch (error) {
        if (!controller.signal.aborted) setResult({key,error:error.response?.data?.message || "Could not connect to the platform API."});
      }
    },delay);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[path,params,delay,key]);
  return {...(result?.key===key?result:{loading:true}),refresh:()=>setRevision(value=>value+1)};
}
