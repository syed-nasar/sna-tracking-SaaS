const express=require("express");
const bcrypt=require("bcryptjs");
const crypto=require("node:crypto");
const { Resolver }=require("node:dns/promises");
const multer=require("multer");
const { PNG }=require("pngjs");
const rateLimit=require("express-rate-limit");
const pool=require("../config/db");
const { changeCustomerStatus }=require("../services/customer-lifecycle.service");
const { page }=require("../services/platform-customers.service");
const { requireAuth }=require("../middleware/auth.middleware");
const { requirePlatformAuth }=require("../middleware/platform-auth.middleware");
const { fail,parseId,transaction,changeAllocation,requireProvisioned,respondError }=require("../services/gps-inventory.service");
const R=require("../services/resellers");
const { configStatus }=require("../services/company-invitation-email");
const invitations=require("../services/reseller-invitations");
const { onboard }=require("./platform-onboarding.routes");
const { invitationStatus,reissue }=require("./platform-invitation.routes");

const platform=express.Router(),reseller=express.Router(),publicApi=express.Router(),tenant=express.Router();
const run=handler=>async(req,res)=>{try{await handler(req,res);}catch(error){respondError(res,error);}};
const id=value=>parseId(value)||fail(400,"Invalid resource ID.");
const clean=(req,res,next)=>{res.set("Cache-Control","no-store");next();};
const limiter=rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:"draft-7",legacyHeaders:false});
const q=async(db,sql,params)=>(await db.query(sql,params)).rows;
const fallback=bcrypt.hashSync(crypto.randomBytes(32).toString("hex"),12);
const partner=req=>req.resellerAuth.resellerId;
const paged=(items,limit,offset)=>({items:items.slice(0,limit),pagination:{limit,offset,hasMore:items.length>limit}});
platform.use(requirePlatformAuth,clean);
reseller.use(clean);
tenant.use(requireAuth,clean);

reseller.post("/auth/login",limiter,run(async(req,res)=>{
  const {slug,email,password}=req.body??{};
  if(typeof slug!=="string"||slug.length>80||typeof email!=="string"||email.length>255||
    typeof password!=="string"||Buffer.byteLength(password)>1024)fail(400,"Invalid credentials.");
  const [a]=await q(pool,`SELECT a.*,r.slug,r.status FROM reseller_admins a JOIN resellers r ON r.id=a.reseller_id
    WHERE r.slug=$1 AND a.email=$2`,[slug,email.trim().toLowerCase()]);
  const ok=await bcrypt.compare(password,a?.password_hash??fallback);
  if(!ok||!a?.enabled||!a.password_hash||a.status!=="active")fail(401,"Invalid credentials.");
  res.json({accessToken:R.resellerToken(a),user:{id:a.id,reseller_id:a.reseller_id,full_name:a.full_name,email:a.email,slug:a.slug}});
}));
reseller.post("/auth/accept",limiter,run(invitations.accept));
reseller.use(R.requireReseller);
reseller.get("/auth/me",(req,res)=>{
  const {id,reseller_id,full_name,email,slug,display_name}=req.resellerAuth.profile;
  res.json({id,reseller_id,full_name,email,slug,display_name});
});

async function addAdmin(db,r,input,actor) {
  const [a]=await q(db,`INSERT INTO reseller_admins(reseller_id,full_name,email)
    VALUES($1,$2,$3) RETURNING id,full_name,email,enabled,password_hash`,
  [r.id,R.text(input.full_name,150,true),R.email(input.email,true)]);
  const invitation=await invitations.invite(db,r,a,actor);
  delete a.password_hash;
  return {admin:a,invitation};
}
platform.get("/",run(async(req,res)=>{
  const [limit,offset]=page(req.query,50);
  const search=R.text(req.query.q,100)??"";
  const status=req.query.status??"";
  if(!["","active","suspended"].includes(status))fail(400,"Invalid reseller status.");
  const items=await q(pool,`SELECT ${R.fields},
    (SELECT count(*)::int FROM tenants t WHERE t.reseller_id=r.id) AS customers,
    (SELECT count(*)::int FROM gps_devices d WHERE d.reseller_id=r.id) AS devices
    FROM resellers r WHERE ($1='' OR strpos(lower(r.display_name),lower($1))>0 OR strpos(r.slug,lower($1))>0)
    AND ($2='' OR r.status=$2) ORDER BY r.id DESC LIMIT $3 OFFSET $4`,[search,status,limit+1,offset]);
  res.json(paged(items,limit,offset));
}));
platform.post("/",run(async(req,res)=>{
  const b=req.body??{};
  const result=await transaction(async db=>{
    const [r]=await q(db,`INSERT INTO resellers(slug,legal_name,display_name,contact_email,contact_phone)
      VALUES($1,$2,$3,$4,$5) RETURNING id,slug`,[R.slug(b.slug),R.text(b.legal_name,150,true),R.text(b.display_name,100,true),
      R.email(b.contact_email,true),R.text(b.contact_phone,30)]);
    await R.audit(db,r.id,req.platformAuth,"reseller.created",r.id);
    return {...r,...await addAdmin(db,r,b.administrator??{},req.platformAuth)};
  });
  res.status(201).json(result);
}));
async function details(rid,includeAdmins,query) {
  const [limit,auditOffset]=page({offset:query.auditOffset},25);
  const [,adminOffset]=page({offset:query.adminOffset},25);
  const [r]=await q(pool,`SELECT ${R.fields} FROM resellers r WHERE r.id=$1`,[rid]);
  if(!r)fail(404,"Reseller not found.");
  const [counts]=await q(pool,`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE customer_type='personal')::int AS personal,
    count(*) FILTER(WHERE customer_type='business')::int AS business,
    count(*) FILTER(WHERE status='active')::int AS active,
    count(*) FILTER(WHERE status='suspended')::int AS suspended,
    count(*) FILTER(WHERE status='inactive')::int AS inactive FROM tenants WHERE reseller_id=$1`,[rid]);
  const [inventory]=await q(pool,`SELECT count(*)::int AS total,count(*) FILTER(WHERE tenant_id IS NOT NULL)::int AS allocated,
    count(*) FILTER(WHERE lifecycle_status='installed')::int AS installed,
    count(*) FILTER(WHERE lifecycle_status='available')::int AS available,
    count(*) FILTER(WHERE lifecycle_status='available' AND provisioning_status='provisioned')::int AS ready_available,
    count(*) FILTER(WHERE provisioning_status<>'provisioned')::int AS unverified FROM gps_devices WHERE reseller_id=$1`,[rid]);
  const domain=(await q(pool,"SELECT hostname,challenge,status,verified_at FROM reseller_domains WHERE reseller_id=$1",[rid]))[0]??null;
  const audit=await q(pool,`SELECT id,action,target_id,created_at,platform_admin_id,reseller_admin_id FROM reseller_audit
    WHERE reseller_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3`,[rid,limit+1,auditOffset]);
  const admins=includeAdmins?await q(pool,`SELECT a.id,a.full_name,a.email,a.enabled,(a.password_hash IS NOT NULL) AS activated,
    i.expires_at,i.delivery_status FROM reseller_admins a LEFT JOIN LATERAL (
      SELECT ri.expires_at,coalesce(m.status,'manual') AS delivery_status FROM reseller_invitations ri
      LEFT JOIN reseller_invitation_email m ON m.invitation_id=ri.id WHERE ri.admin_id=a.id ORDER BY ri.id DESC LIMIT 1
    ) i ON true WHERE a.reseller_id=$1 ORDER BY a.id LIMIT $2 OFFSET $3`,[rid,limit+1,adminOffset]):undefined;
  const adminCounts=includeAdmins?(await q(pool,`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE enabled)::int AS enabled,count(*) FILTER(WHERE NOT enabled)::int AS disabled,
    count(*) FILTER(WHERE password_hash IS NOT NULL)::int AS activated
    FROM reseller_admins WHERE reseller_id=$1`,[rid]))[0]:undefined;
  return {reseller:r,counts,inventory,domain,audit:audit.slice(0,limit),admins:admins?.slice(0,limit),adminCounts,
    auditPagination:paged(audit,limit,auditOffset).pagination,
    adminPagination:admins?paged(admins,limit,adminOffset).pagination:undefined,
    emailAvailability:configStatus(),brand:await R.publicBrand(pool,"id",rid)};
}
platform.get("/:id",run(async(req,res)=>res.json(await details(id(req.params.id),true,req.query))));
reseller.get("/dashboard",run(async(req,res)=>res.json(await details(partner(req),false,req.query))));
platform.patch("/:id",run(async(req,res)=>{
  const rid=id(req.params.id),b=req.body??{};
  const status=b.status;
  if(!["active","suspended"].includes(status))fail(400,"Invalid reseller status.");
  await R.manage(req,rid,async(db,actor)=>{
    const [prior]=await q(db,"SELECT status FROM resellers WHERE id=$1 FOR UPDATE",[rid]);
    if(!prior)fail(404,"Reseller not found.");
    await db.query(`UPDATE resellers SET legal_name=$2,contact_email=$3,contact_phone=$4,status=$5,
      updated_at=clock_timestamp() WHERE id=$1`,[rid,R.text(b.legal_name,150,true),R.email(b.contact_email,true),R.text(b.contact_phone,30),status]);
    if(prior.status!==status)await db.query("UPDATE reseller_admins SET token_version=token_version+1 WHERE reseller_id=$1",[rid]);
    await R.audit(db,rid,actor,prior.status===status?"reseller.edited":`reseller.${status}`,rid);
  });
  res.sendStatus(204);
}));
platform.post("/:id/admins",run(async(req,res)=>{
  const rid=id(req.params.id);
  const result=await R.manage(req,rid,async(db,actor)=>{
    const [r]=await q(db,"SELECT * FROM resellers WHERE id=$1 FOR UPDATE",[rid]);
    if(!r)fail(404,"Reseller not found.");
    if(r.status!=="active")fail(409,"Activate the reseller first.");
    return addAdmin(db,r,req.body??{},actor);
  });
  res.status(201).json(result);
}));
platform.post("/:id/admins/:adminId/invitation",run(async(req,res)=>{
  const rid=id(req.params.id),aid=id(req.params.adminId);
  const result=await R.manage(req,rid,async(db,actor)=>{
    const [r]=await q(db,"SELECT * FROM resellers WHERE id=$1 FOR SHARE",[rid]);
    const [a]=await q(db,"SELECT * FROM reseller_admins WHERE id=$1 AND reseller_id=$2 FOR UPDATE",[aid,rid]);
    if(!a||!r)fail(404,"Administrator not found.");
    if(r.status!=="active")fail(409,"Activate the reseller first.");
    await q(db,`SELECT d.invitation_id FROM reseller_invitation_email d JOIN reseller_invitations i ON i.id=d.invitation_id
      WHERE i.admin_id=$1 FOR UPDATE OF d`,[aid]);
    return invitations.invite(db,r,a,actor);
  });
  res.json({invitation:result});
}));
platform.patch("/:id/admins/:adminId",run(async(req,res)=>{
  const rid=id(req.params.id),aid=id(req.params.adminId),enabled=req.body?.enabled;
  if(typeof enabled!=="boolean")fail(400,"Specify administrator status.");
  await R.manage(req,rid,async(db,actor)=>{
    const result=await db.query(`UPDATE reseller_admins SET enabled=$3,token_version=token_version+1
      WHERE id=$1 AND reseller_id=$2`,[aid,rid,enabled]);
    if(!result.rowCount)fail(404,"Administrator not found.");
    await R.audit(db,rid,actor,enabled?"admin.enabled":"admin.disabled",aid);
  });
  res.sendStatus(204);
}));

reseller.get("/customers",run(async(req,res)=>{
  const [limit,offset]=page(req.query,50);
  const search=R.text(req.query.q,100)??"";
  const items=await q(pool,`SELECT id,name,slug,customer_type,status,created_at FROM tenants WHERE reseller_id=$1
    AND ($2='' OR strpos(lower(name),lower($2))>0 OR strpos(slug,lower($2))>0) ORDER BY id DESC LIMIT $3 OFFSET $4`,[partner(req),search,limit+1,offset]);
  res.json(paged(items,limit,offset));
}));
reseller.post("/customers",onboard);
reseller.get("/customers/:tenantId/invitations/status",invitationStatus);
reseller.post("/customers/:tenantId/invitations/reissue",reissue);
reseller.get("/customers/:id",run(async(req,res)=>{
  const [t]=await q(pool,`SELECT id,name,slug,status,customer_type,email,phone,created_at,xmin::text AS version FROM tenants WHERE id=$1 AND reseller_id=$2`,
  [id(req.params.id),partner(req)]);
  if(!t)fail(404,"Customer not found.");
  const recent_activity=await q(pool,`SELECT id,action,created_at FROM reseller_audit
    WHERE reseller_id=$1 AND target_id=$2 AND action IN ('customer.onboarded','customer.active','customer.suspended')
    ORDER BY created_at DESC,id DESC LIMIT 12`,[partner(req),t.id]);
  res.json({...t,recent_activity});
}));
reseller.patch("/customers/:id/status",run(async(req,res)=>{
  const rid=partner(req),tid=id(req.params.id);
  const result=await R.manage(req,rid,(db,actor)=>changeCustomerStatus(db,tid,rid,req.body,
    (client,details)=>client.query(`INSERT INTO reseller_audit
      (reseller_id,reseller_admin_id,action,target_id,lifecycle_details) VALUES ($1,$2,$3,$4,$5)`,
      [rid,actor.resellerAdminId,`customer.${details.toStatus}`,tid,details])));
  res.json(result);
}));

platform.get("/:id/inventory",run(async(req,res)=>{
  const [limit,offset]=page(req.query,50);
  const rid=id(req.params.id),search=R.text(req.query.q,100)??"";
  const items=await q(pool,`SELECT id,device_name,unique_identifier,lifecycle_status,reseller_id,tenant_id,
      (provisioning_status='provisioned' AND traccar_device_id IS NOT NULL) AS allocation_ready FROM gps_devices
    WHERE (reseller_id=$1 OR (reseller_id IS NULL AND tenant_id IS NULL AND lifecycle_status='available'))
    AND ($2='' OR strpos(lower(coalesce(device_name,'')),lower($2))>0 OR strpos(lower(coalesce(unique_identifier,'')),lower($2))>0)
    ORDER BY (reseller_id=$1) DESC NULLS LAST,id DESC LIMIT $3 OFFSET $4`,[rid,search,limit+1,offset]);
  res.json(paged(items,limit,offset));
}));
platform.put("/:id/inventory/:deviceId",run(async(req,res)=>{
  const rid=id(req.params.id),did=id(req.params.deviceId),assign=req.body?.assign;
  if(typeof assign!=="boolean")fail(400,"Specify whether to assign this device.");
  await R.manage(req,rid,async(db,actor)=>{
    const [r]=await q(db,"SELECT status FROM resellers WHERE id=$1 FOR SHARE",[rid]);
    if(!r)fail(404,"Reseller not found.");
    if(assign&&r.status!=="active")fail(409,"Activate the reseller first.");
    const [device]=await q(db,`SELECT * FROM gps_devices WHERE id=$1
      AND reseller_id IS NOT DISTINCT FROM $2::bigint AND tenant_id IS NULL
      AND lifecycle_status='available' FOR UPDATE`,[did,assign?null:rid]);
    if(!device)fail(409,"Device is unavailable for this inventory change.");
    if(assign)requireProvisioned(device);
    await db.query("UPDATE gps_devices SET reseller_id=$2,updated_at=clock_timestamp() WHERE id=$1",
      [did,assign?rid:null]);
    await R.audit(db,rid,actor,assign?"inventory.assigned":"inventory.returned",did);
  });
  res.sendStatus(204);
}));
reseller.get("/inventory",run(async(req,res)=>{
  const [limit,offset]=page(req.query,50);
  const items=await q(pool,`SELECT d.id,d.device_name,d.unique_identifier,d.lifecycle_status,d.tenant_id,t.name AS customer,
    (d.provisioning_status='provisioned' AND d.traccar_device_id IS NOT NULL) AS allocation_ready
    FROM gps_devices d LEFT JOIN tenants t ON t.id=d.tenant_id AND t.reseller_id=d.reseller_id
    WHERE d.reseller_id=$1 ORDER BY d.id DESC LIMIT $2 OFFSET $3`,[partner(req),limit+1,offset]);
  res.json(paged(items,limit,offset));
}));
reseller.get("/inventory/:id/history",run(async(req,res)=>{
  const [limit,offset]=page(req.query,25);
  const items=await q(pool,`SELECT e.id,e.action,e.created_at FROM gps_device_events e JOIN gps_devices d ON d.id=e.device_id
    WHERE d.id=$1 AND d.reseller_id=$2 AND (e.details->>'toTenantId' IN (SELECT id::text FROM tenants WHERE reseller_id=$2)
      OR e.details->>'fromTenantId' IN (SELECT id::text FROM tenants WHERE reseller_id=$2)
      OR e.details->>'tenantId' IN (SELECT id::text FROM tenants WHERE reseller_id=$2))
      ORDER BY e.id DESC LIMIT $3 OFFSET $4`,[id(req.params.id),partner(req),limit+1,offset]);
  res.json(paged(items,limit,offset));
}));
reseller.post("/inventory/:id/allocation",run(async(req,res)=>{
  const rid=partner(req),did=id(req.params.id),tid=id(req.body?.tenantId);
  await changeAllocation({deviceId:did,targetTenantId:tid,action:"allocated",actor:{resellerAdminId:req.resellerAuth.id},
    authorizeAllocation:async(db,device)=>{
      await R.lockReseller(db,req.resellerAuth);
      if(device.reseller_id!==rid||!(await q(db,"SELECT id FROM tenants WHERE id=$1 AND reseller_id=$2",[tid,rid])).length){
        fail(404,"Device or customer not found.");
      }
      await R.audit(db,rid,{resellerAdminId:req.resellerAuth.id},"inventory.customer_allocated",did);
    }});
  res.sendStatus(204);
}));

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:524288,files:1}}).single("asset");
const kind=value=>["logo","dark-logo","favicon"].includes(value)?value:fail(400,"Unknown asset kind.");
function png(file,assetKind) {
  const data=file?.buffer;
  if(file?.mimetype!=="image/png"||!data||data.length<33||
    !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
    data.readUInt32BE(8)!==13||data.toString("ascii",12,16)!=="IHDR")fail(400,"Supply a valid PNG image.");
  const max=assetKind==="favicon"?128:512;
  if(!data.readUInt32BE(16)||!data.readUInt32BE(20)||data.readUInt32BE(16)>max||data.readUInt32BE(20)>max)
    fail(400,`Image dimensions must be at most ${max} × ${max}.`);
  try{return PNG.sync.write(PNG.sync.read(data,{checkCRC:true}));}catch{fail(400,"Supply a valid PNG image.");}
}
function hostname(value) {
  const host=R.text(value,253,true).toLowerCase().replace(/\.$/,"");
  const labels=host.split(".");
  let reserved=[];
  for(const raw of [process.env.PUBLIC_FRONTEND_URL,process.env.TRACCAR_BASE_URL]){
    try{reserved.push(new URL(raw).hostname);}catch{/* optional configuration */}
  }
  if(labels.length<2||!/[a-z]/.test(labels.at(-1))||labels.some(x=>! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))||
    ["localhost","local","internal","test","invalid","example","onion","arpa"].includes(labels.at(-1))||
    reserved.includes(host)||host==="sna-fleet.local")fail(400,"Enter a public DNS hostname.");
  return host;
}
function settings(router,path,resellerId) {
  router.put(path+"/branding",run(async(req,res)=>{
    const rid=resellerId(req);
    await R.manage(req,rid,async(db,actor)=>{
      if(!(await R.saveBrand(db,rid,req.body??{})).rowCount)fail(404,"Reseller not found.");
      await R.audit(db,rid,actor,"branding.edited",rid);
    });
    res.sendStatus(204);
  }));
  router.put(path+"/branding/assets/:kind",(req,res,next)=>upload(req,res,error=>{
    if(error)return res.status(400).json({message:"Upload one PNG up to 512 KiB."});next();
  }),run(async(req,res)=>{
    const rid=resellerId(req),k=kind(req.params.kind),bytes=png(req.file,k);
    await R.manage(req,rid,async(db,actor)=>{
      await db.query(`INSERT INTO reseller_brand_assets(reseller_id,kind,png) VALUES($1,$2,$3)
        ON CONFLICT(reseller_id,kind) DO UPDATE SET png=excluded.png,updated_at=clock_timestamp()`,[rid,k,bytes]);
      await R.audit(db,rid,actor,"branding.asset_saved",rid);
    });
    res.sendStatus(204);
  }));
  router.delete(path+"/branding/assets/:kind",run(async(req,res)=>{
    const rid=resellerId(req),k=kind(req.params.kind);
    await R.manage(req,rid,async(db,actor)=>{
      await db.query("DELETE FROM reseller_brand_assets WHERE reseller_id=$1 AND kind=$2",[rid,k]);
      await R.audit(db,rid,actor,"branding.asset_removed",rid);
    });
    res.sendStatus(204);
  }));
  router.put(path+"/domain",run(async(req,res)=>{
    const rid=resellerId(req),host=hostname(req.body?.hostname);
    await R.manage(req,rid,async(db,actor)=>{
      const result=await db.query(`INSERT INTO reseller_domains(reseller_id,hostname,challenge) VALUES($1,$2,$3)
        ON CONFLICT(reseller_id) DO UPDATE SET hostname=excluded.hostname,challenge=excluded.challenge,status='pending',
        verified_at=NULL,updated_at=clock_timestamp() WHERE reseller_domains.status<>'disabled' OR $4::boolean`,
      [rid,host,crypto.randomBytes(32).toString("hex"),Boolean(req.platformAuth)]);
      if(!result.rowCount)fail(409,"Platform approval is required to change a revoked domain.");
      await R.audit(db,rid,actor,"domain.challenge_created",rid);
    });
    res.sendStatus(204);
  }));
  router.post(path+"/domain/verify",limiter,run(async(req,res)=>{
    const rid=resellerId(req);
    const [d]=await q(pool,"SELECT hostname,challenge FROM reseller_domains WHERE reseller_id=$1 AND status='pending'",[rid]);
    if(!d)fail(409,"No pending domain verification.");
    let records;
    try {records=await new Resolver({timeout:1500,tries:1}).resolveTxt("_sna-fleet-verification."+d.hostname);}
    catch {fail(409,"The verification TXT record is unavailable.");}
    if(!records.some(parts=>parts.join("")===`sna-fleet=${d.challenge}`))fail(409,"The verification TXT record does not match.");
    await R.manage(req,rid,async(db,actor)=>{
      const updated=await db.query(`UPDATE reseller_domains SET status='verified',verified_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE reseller_id=$1 AND hostname=$2 AND challenge=$3 AND status='pending'`,[rid,d.hostname,d.challenge]);
      if(!updated.rowCount)fail(409,"Domain verification changed. Refresh and try again.");
      await R.audit(db,rid,actor,"domain.verified",rid);
    });
    res.sendStatus(204);
  }));
  router.delete(path+"/domain",run(async(req,res)=>{
    const rid=resellerId(req);
    await R.manage(req,rid,async(db,actor)=>{
      const result=await db.query("DELETE FROM reseller_domains WHERE reseller_id=$1 AND (status<>'disabled' OR $2::boolean)",
        [rid,Boolean(req.platformAuth)]);
      if(!result.rowCount)fail(409,"No removable domain. Contact the platform for revoked domains.");
      await R.audit(db,rid,actor,"domain.removed",rid);
    });
    res.sendStatus(204);
  }));
}
settings(platform,"/:id",req=>id(req.params.id));
settings(reseller,"",partner);
platform.patch("/:id/domain/revoke",run(async(req,res)=>{
  const rid=id(req.params.id);
  await R.manage(req,rid,async(db,actor)=>{
    const r=await db.query("UPDATE reseller_domains SET status='disabled',verified_at=NULL,updated_at=clock_timestamp() WHERE reseller_id=$1",[rid]);
    if(!r.rowCount)fail(404,"Domain not found.");
    await R.audit(db,rid,actor,"domain.revoked",rid);
  });
  res.sendStatus(204);
}));
publicApi.use(clean);
publicApi.get("/host/:hostname",run(async(req,res)=>res.json({brand:await R.publicBrand(pool,"host",hostname(req.params.hostname))})));
publicApi.get("/:slug",run(async(req,res)=>res.json({brand:await R.publicBrand(pool,"slug",R.slug(req.params.slug))})));
publicApi.get("/:slug/assets/:kind",run(async(req,res)=>{
  const [row]=await q(pool,`SELECT a.png FROM reseller_brand_assets a JOIN resellers r ON r.id=a.reseller_id
    WHERE r.slug=$1 AND a.kind=$2`,[R.slug(req.params.slug),kind(req.params.kind)]);
  if(!row)fail(404,"Brand image not found.");
  res.type("image/png").set("X-Content-Type-Options","nosniff").set("Cross-Origin-Resource-Policy","cross-origin").send(row.png);
}));
tenant.get("/",run(async(req,res)=>res.json({brand:await R.publicBrand(pool,"tenant",req.auth.tenantId)})));

module.exports={platform,reseller,publicApi,tenant};
