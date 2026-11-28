import { createContext,useContext } from "react";
import api from "../services/api";
export const BrandContext=createContext(null);
export const BrandReadyContext=createContext(true);
export const useBrand=()=>useContext(BrandContext);
export const useBrandReady=()=>useContext(BrandReadyContext);
export function brandAsset(brand,kind){
  return brand?.assets?.includes(kind)?`${api.defaults.baseURL.replace(/\/$/,"")}/brands/${brand.slug}/assets/${kind}`:null;
}
export function brandLogin(brand){return brand?.slug?`/r/${brand.slug}/login`:"/login";}
