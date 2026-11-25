const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { fail, parseId, transaction } = require("./gps-inventory.service");
const audience = "sna-fleet-resellers";
const issuer = "sna-fleet-api";
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function text(value,max,required=false) {
  if(value==null||value==="") { if(required)fail(400,"A required field is missing.");return null; }
  if(typeof value!=="string"||!value.trim()||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value)) fail(400,"Invalid text field.");
  return value.trim();
}
function email(value,required=false) {
  const address=text(value,255,required);
  if(address&&!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z0-9]+$/i.test(address))fail(400,"Invalid email address.");
  return address?.toLowerCase()??null;
}
function slug(value) {
  if(typeof value!=="string"||value.length>80||!slugPattern.test(value))fail(400,"Invalid reseller slug.");
  return value;
}
function color(value) {
  const normalized=text(value,7);
  if(normalized&&!/^#[0-9a-f]{6}$/i.test(normalized))fail(400,"Use a six-digit hexadecimal color.");
  return normalized;
}
function website(value) {
  const raw=text(value,500);
  if(!raw)return null;
  let result;
  try{result=new URL(raw);}catch{fail(400,"Use an HTTPS support website.");}
  if(result.protocol!=="https:"||result.username||result.password)fail(400,"Use an HTTPS support website.");
  return raw;
}

function resellerToken(admin) {
  return jwt.sign({version:admin.token_version},process.env.JWT_SECRET,{
    subject:admin.id,issuer,audience,algorithm:"HS256",expiresIn:"8h",
  });
}
const accountSql=`SELECT a.id,a.full_name,a.email,a.reseller_id,a.enabled,a.token_version,
  (a.password_hash IS NOT NULL) AS activated,r.status,r.slug,r.display_name
  FROM reseller_admins a JOIN resellers r ON r.id=a.reseller_id WHERE a.id=$1`;
async function requireReseller(req,res,next) {
  const auth=req.get("Authorization");
  let payload;
  try {
    if(!auth?.startsWith("Bearer "))throw Error();
    payload=jwt.verify(auth.slice(7),process.env.JWT_SECRET,{issuer,audience,algorithms:["HS256"]});
  } catch {return res.status(401).json({message:"Reseller authentication required."});}
  if(!parseId(payload.sub))return res.status(401).json({message:"Invalid reseller session."});
  try {
    const {rows:[a]}=await pool.query(accountSql,[payload.sub]);
    if(!a?.enabled||!a.activated||a.status!=="active"||a.token_version!==payload.version) {
      return res.status(401).json({message:"Reseller session is unavailable."});
    }
    req.resellerAuth={id:a.id,resellerId:a.reseller_id,version:a.token_version,profile:a};
    next();
  }catch(error){next(error);}
}
async function lockReseller(db,auth) {
  const org=await db.query("SELECT id FROM resellers WHERE id=$1 AND status='active' FOR SHARE",[auth.resellerId]);
  if(!org.rowCount)fail(401,"Reseller session is unavailable.");
  const {rowCount}=await db.query(`SELECT id FROM reseller_admins WHERE id=$1 AND reseller_id=$2
    AND enabled AND password_hash IS NOT NULL AND token_version=$3 FOR SHARE`,[auth.id,auth.resellerId,auth.version]);
  if(!rowCount)fail(401,"Reseller session is unavailable.");
}
const audit=(db,resellerId,actor,action,target=null)=>db.query(`INSERT INTO reseller_audit
  (reseller_id,platform_admin_id,reseller_admin_id,action,target_id) VALUES($1,$2,$3,$4,$5)`,
[resellerId,actor.adminId??null,actor.resellerAdminId??null,action,target]);
const fields=`r.id,r.slug,r.legal_name,r.display_name,r.contact_email,r.contact_phone,r.status,
  r.primary_color,r.accent_color,r.support_email,r.support_phone,r.support_website,r.welcome,r.created_at,r.updated_at`;
async function publicBrand(db,filter,value) {
  const {rows:[brand]}=await db.query(`SELECT r.slug,r.display_name,r.primary_color,r.accent_color,
    r.support_email,r.support_phone,r.support_website,r.welcome,
    ARRAY(SELECT a.kind FROM reseller_brand_assets a WHERE a.reseller_id=r.id) AS assets
    FROM resellers r WHERE ${{
      slug:"r.slug=$1",
      host:"EXISTS (SELECT 1 FROM reseller_domains d WHERE d.reseller_id=r.id AND d.hostname=$1 AND d.status='verified')",
      tenant:"EXISTS (SELECT 1 FROM tenants t WHERE t.reseller_id=r.id AND t.id=$1)",
      id:"r.id=$1",
    }[filter]}`,[value]);
  return brand??null;
}
async function saveBrand(db,id,b) {
  return db.query(`UPDATE resellers SET display_name=$2,primary_color=$3,accent_color=$4,support_email=$5,
    support_phone=$6,support_website=$7,welcome=$8,updated_at=clock_timestamp() WHERE id=$1`,
  [id,text(b.display_name,100,true),color(b.primary_color),color(b.accent_color),email(b.support_email),
    text(b.support_phone,30),website(b.support_website),text(b.welcome,500)]);
}
const manage=(req,id,work)=>transaction(async db=>{
  if(req.resellerAuth)await lockReseller(db,req.resellerAuth);
  return work(db,req.platformAuth??{resellerAdminId:req.resellerAuth.id},id);
});
module.exports={text,email,slug,resellerToken,requireReseller,lockReseller,audit,publicBrand,fields,saveBrand,manage};
