const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { transaction,fail } = require("./gps-inventory.service");
const { audit } = require("./resellers");
const { manualInvitation,configStatus,protect,unprotect,activationLink } = require("./company-invitation-email");
const { transport,deliveryFailure } = require("./mail");
const { sendBranded } = require("./brand-mail");
const hash = token => crypto.createHash("sha256").update(token).digest("hex");
const secretId = id => `reseller:${id}`;

async function invite(db,reseller,admin,actor) {
  if(!admin.enabled||admin.password_hash)fail(409,"Only enabled administrators awaiting activation can receive an invitation.");
  const {rows:[prior]}=await db.query(`SELECT i.id,i.expires_at,d.status,
    i.created_at>clock_timestamp()-interval '60 seconds' AS recent
    FROM reseller_invitations i LEFT JOIN reseller_invitation_email d ON d.invitation_id=i.id
    WHERE i.admin_id=$1 ORDER BY i.id DESC LIMIT 1`,[admin.id]);
  if(prior&&prior.expires_at>Date.now()){
    if(prior.status==="pending"||prior.status==="sending")return {id:prior.id,expiresAt:prior.expires_at,deliveryStatus:prior.status};
    if(prior.recent)fail(429,"Wait one minute before reissuing.");
  }
  await db.query(`UPDATE reseller_invitation_email d SET status='cancelled',payload=NULL,updated_at=clock_timestamp()
    FROM reseller_invitations i WHERE i.id=d.invitation_id AND i.admin_id=$1 AND d.status='pending'`,[admin.id]);
  await db.query("UPDATE reseller_invitations SET used_at=clock_timestamp() WHERE admin_id=$1 AND used_at IS NULL",[admin.id]);
  const token=crypto.randomBytes(32).toString("hex");
  const {rows:[row]}=await db.query(`INSERT INTO reseller_invitations(reseller_id,admin_id,token_hash,expires_at,created_by)
    VALUES($1,$2,$3,clock_timestamp()+interval '24 hours',$4) RETURNING id,expires_at`,[reseller.id,admin.id,hash(token),actor.adminId]);
  let deliveryStatus=configStatus();
  if(deliveryStatus==="ready"){
    await db.query("INSERT INTO reseller_invitation_email(invitation_id,status,payload) VALUES($1,'pending',$2)",[row.id,protect(token,secretId(row.id))]);
    deliveryStatus="pending";
  }
  await audit(db,reseller.id,actor,prior?"admin.invitation_reissued":"admin.invited",row.id);
  return {id:row.id,expiresAt:row.expires_at,deliveryStatus,...manualInvitation(token,reseller.slug,true)};
}

async function accept(req,res) {
  const {token,password,brandSlug}=req.body??{};
  if(typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token)||typeof password!=="string"||
    password.length<12||Buffer.byteLength(password)>72||
    (brandSlug!=null&&(typeof brandSlug!=="string"||brandSlug.length>80)))fail(400,"Invalid invitation or password.");
  const digest=hash(token);
  const passwordHash=await bcrypt.hash(password,12);
  await transaction(async db=>{
    const {rows:[hint]}=await db.query("SELECT reseller_id,admin_id FROM reseller_invitations WHERE token_hash=$1",[digest]);
    if(!hint)fail(400,"Invalid or expired invitation.");
    const {rows:[r]}=await db.query("SELECT status,slug FROM resellers WHERE id=$1 FOR SHARE",[hint.reseller_id]);
    const {rows:[admin]}=await db.query("SELECT * FROM reseller_admins WHERE id=$1 FOR UPDATE",[hint.admin_id]);
    const {rows:[inv]}=await db.query("SELECT * FROM reseller_invitations WHERE token_hash=$1 FOR UPDATE",[digest]);
    if(r?.status!=="active"||(brandSlug!=null&&r.slug!==brandSlug)||!admin?.enabled||admin.password_hash||!inv||inv.used_at||inv.expires_at<=Date.now()){
      fail(400,"Invalid or expired invitation.");
    }
    await db.query("UPDATE reseller_admins SET password_hash=$2 WHERE id=$1",[admin.id,passwordHash]);
    await db.query("UPDATE reseller_invitations SET used_at=clock_timestamp() WHERE id=$1",[inv.id]);
    await db.query("UPDATE reseller_invitation_email SET status='cancelled',payload=NULL WHERE invitation_id=$1 AND status='pending'",[inv.id]);
  });
  res.json({accountActivated:true});
}

async function deliver(mail) {
  await pool.query(`UPDATE reseller_invitation_email d SET status='cancelled',payload=NULL,updated_at=clock_timestamp()
    FROM reseller_invitations i WHERE i.id=d.invitation_id AND d.status='pending'
    AND (i.used_at IS NOT NULL OR i.expires_at<=clock_timestamp())`);
  await pool.query(`UPDATE reseller_invitation_email SET status='uncertain',payload=NULL,updated_at=clock_timestamp()
    WHERE status='sending' AND updated_at<clock_timestamp()-interval '5 minutes'`);
  if(configStatus()!=="ready")return;
  const {rows:[job]}=await pool.query(`UPDATE reseller_invitation_email SET status='sending',attempts=attempts+1,
    updated_at=clock_timestamp() WHERE invitation_id=(SELECT invitation_id FROM reseller_invitation_email WHERE status='pending'
    AND available_at<=clock_timestamp() ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
  if(!job)return;
  const {rows:[r]}=await pool.query(`SELECT a.full_name,a.email,r.display_name,r.slug,r.support_email,i.*
    FROM reseller_invitations i JOIN reseller_admins a ON a.id=i.admin_id JOIN resellers r ON r.id=i.reseller_id
    WHERE i.id=$1 AND i.used_at IS NULL AND i.expires_at>clock_timestamp() AND a.enabled AND a.password_hash IS NULL
    AND r.status='active'`,[job.invitation_id]);
  let status="cancelled";
  if(r){
    try {
      const token=unprotect(job.payload,secretId(job.invitation_id));
      if(hash(token)!==r.token_hash)throw Error();
      await sendBranded(mail,r.reseller_id,{from:process.env.ALERT_SMTP_FROM,to:r.email,
        messageId:`<reseller-invite-${job.invitation_id}@sna-fleet.local>`,subject:`Activate your ${r.display_name} reseller account`,
        text:`Hello ${r.full_name},\n\nActivate your ${r.display_name} reseller workspace:\n${activationLink(token,r.slug,true)}\n\nThis link expires ${r.expires_at.toISOString()} (UTC).\n${r.support_email||""}`},activationLink(token,r.slug,true));
      status="sent";
    }catch(error){status=deliveryFailure(error,job.attempts);}
  }
  await transaction(async db=>{
    const updated=await db.query(`UPDATE reseller_invitation_email SET status=$2,
      payload=CASE WHEN $2='pending' THEN payload ELSE NULL END,
      updated_at=clock_timestamp(),available_at=clock_timestamp()+make_interval(secs=>30*power(2,attempts)::integer)
      WHERE invitation_id=$1 AND status='sending'`,[job.invitation_id,status]);
    if(updated.rowCount&&r)await audit(db,r.reseller_id,{adminId:r.created_by},`admin.invitation_${status}`,r.id);
  });
}
function startResellerEmail() {
  let busy=false,mail;
  const timer=setInterval(async()=>{
    if(busy)return;
    busy=true;
    try{
      if(!mail&&configStatus()==="ready")mail=transport();
      await deliver(mail);
    }catch(error){console.error("Reseller mail worker unavailable",error.code??error.name);}
    finally{busy=false;}
  },2500);
  timer.unref();
}
module.exports={invite,accept,deliver,startResellerEmail};
