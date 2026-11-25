import { Truck } from "lucide-react";
import { brandAsset } from "../context/brand";
export default function BrandMark({brand,size=20}){
  const logo=brandAsset(brand,"logo"),dark=brandAsset(brand,"dark-logo");
  return logo||dark?<span className="grid size-10 place-items-center rounded-lg bg-panel">
    <img className={`size-9 object-contain ${dark?"brand-logo-light":""}`} src={logo||dark} alt="" />
    {dark&&<img className="brand-logo-dark hidden size-9 object-contain" src={dark} alt="" />}
  </span>:<Truck size={size} aria-hidden="true" />;
}
