import { useEffect,useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import api,{tenantApi} from "../services/api";
import { BrandContext,brandAsset } from "./brand";

export default function BrandProvider({children}){
  const {session}=useAuth();
  const {pathname}=useLocation();
  const slug=pathname.match(/^\/r\/([a-z0-9-]+)\//)?.[1];
  const ordinaryPublic=["/","/login","/accept-invitation"].includes(pathname);
  const source=session?.type==="tenant"?"/tenant-brand":session?.type==="platform"?null:
    session?.type==="reseller"?`/brands/${session.profile.slug}`:slug?`/brands/${slug}`:
    ordinaryPublic&&/[a-z]/i.test(window.location.hostname)&&window.location.hostname.includes(".")?
      `/brands/host/${encodeURIComponent(window.location.hostname)}`:null;
  const sessionId=session?.id;
  const [value,setValue]=useState(null);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const refresh=()=>setRevision(n=>n+1);
    window.addEventListener("sna:brand-updated",refresh);
    return ()=>window.removeEventListener("sna:brand-updated",refresh);
  },[]);
  useEffect(()=>{
    if(!source)return;
    const abort=new AbortController();
    const client=source==="/tenant-brand"?tenantApi:api;
    client.get(source,{signal:abort.signal}).then(({data})=>{
      if(!abort.signal.aborted)setValue({source,sessionId,brand:data.brand});
    }).catch(()=>{if(!abort.signal.aborted)setValue({source,sessionId,brand:null});});
    return ()=>abort.abort();
  },[source,sessionId,revision]);
  const brand=value?.source===source&&value?.sessionId===sessionId?value.brand:null;
  useEffect(()=>{
    const icon=document.querySelector('link[rel="icon"]');
    const title=document.title;
    const href=icon?.getAttribute("href");
    if(brand){document.title=brand.display_name;const custom=brandAsset(brand,"favicon");if(custom)icon?.setAttribute("href",custom);}
    return ()=>{document.title=title;if(icon&&href)icon.setAttribute("href",href);};
  },[brand]);
  const style=brand?{"--brand-primary":brand.primary_color??"#2459bf","--brand-highlight":brand.accent_color??brand.primary_color??"#2459bf"}:undefined;
  return <BrandContext.Provider value={brand}><div className={brand?"reseller-branded":undefined} style={style}>{children}</div></BrandContext.Provider>;
}
