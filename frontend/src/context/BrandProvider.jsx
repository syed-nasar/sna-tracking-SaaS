import { useEffect,useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import api,{tenantApi} from "../services/api";
import { BrandContext,BrandReadyContext,brandAsset } from "./brand";

export default function BrandProvider({children}){
  const {session}=useAuth();
  const {pathname}=useLocation();
  const slug=pathname.match(/^\/r\/([a-z0-9-]+)\//)?.[1];
  const ordinaryPublic=["/","/login","/reseller/login","/accept-invitation"].includes(pathname);
  const hostSource=ordinaryPublic&&/[a-z]/i.test(window.location.hostname)&&window.location.hostname.includes(".")?
    `/brands/host/${encodeURIComponent(window.location.hostname)}`:null;
  const source=slug?`/brands/${slug}`:hostSource??(session?.type==="tenant"?"/tenant-brand":
    session?.type==="reseller"?`/brands/${session.profile.slug}`:null);
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
      if(!abort.signal.aborted)setValue({source,sessionId,brand:data.brand,resolved:true});
    }).catch(error=>{
      if(!abort.signal.aborted)setValue({source,sessionId,brand:null,resolved:error.response?.status===404});
    });
    return ()=>abort.abort();
  },[source,sessionId,revision]);
  const matches=value?.source===source&&value?.sessionId===sessionId;
  const brand=matches?value.brand:null;
  const ready=!source||(matches&&value.resolved);
  useEffect(()=>{
    const icon=document.querySelector('link[rel="icon"]');
    const title=document.title;
    const href=icon?.getAttribute("href");
    if(brand){document.title=brand.display_name;const custom=brandAsset(brand,"favicon");if(custom)icon?.setAttribute("href",custom);}
    return ()=>{document.title=title;if(icon&&href)icon.setAttribute("href",href);};
  },[brand]);
  const style=brand?{"--brand-primary":brand.primary_color??"#2459bf","--brand-highlight":brand.accent_color??brand.primary_color??"#2459bf"}:undefined;
  return <BrandReadyContext.Provider value={ready}><BrandContext.Provider value={brand}>
    <div className={brand?"reseller-branded":undefined} style={style}>{children}</div>
  </BrandContext.Provider></BrandReadyContext.Provider>;
}
