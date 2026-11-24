const crypto = require("node:crypto");
const pool = require("../config/db");
const { sendBranded } = require("./brand-mail");
const { smtpEnabled, transport, deliveryFailure } = require("./mail");

function frontendUrl() {
  try {
    const url = new URL(process.env.PUBLIC_FRONTEND_URL);
    const local = ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && local && process.env.NODE_ENV !== "production"))) return null;
    return new URL("accept-invitation", url.href.replace(/\/$/, "") + "/");
  } catch {
    return null;
  }
}

function key() {
  const value = process.env.INVITATION_EMAIL_KEY;
  return /^[0-9a-f]{64}$/i.test(value || "") ? Buffer.from(value,"hex") : null;
}

function configStatus() {
  if (!smtpEnabled()) return "smtp_disabled";
  return frontendUrl() && key() ? "ready" : "configuration_required";
}

function activationLink(token, brandSlug, resellerAdmin=false) {
  const url = frontendUrl();
  if (!url) return null;
  if (brandSlug) url.pathname=url.pathname.replace(/accept-invitation$/, `r/${brandSlug}/${resellerAdmin?"activate-admin":"accept-invitation"}`);
  url.hash = new URLSearchParams({token}).toString();
  return url.href;
}

function protect(token,id) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm",key(),iv);
  cipher.setAAD(Buffer.from(String(id)));
  const encrypted = Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64");
}

function unprotect(payload,id) {
  const encoded = Buffer.from(payload,"base64");
  const cipher = crypto.createDecipheriv("aes-256-gcm",key(),encoded.subarray(0,12));
  cipher.setAAD(Buffer.from(String(id)));
  cipher.setAuthTag(encoded.subarray(12,28));
  return Buffer.concat([cipher.update(encoded.subarray(28)),cipher.final()]).toString("utf8");
}

async function audit(db, id, action, status) {
  await db.query(`INSERT INTO platform_audit_logs(platform_admin_id,action,resource_type,resource_id,details)
    SELECT created_by_platform_admin_id,$2,'tenant',tenant_id,jsonb_build_object('invitationId',id,'deliveryStatus',$3::text)
    FROM user_invitations WHERE id=$1 AND created_by_platform_admin_id IS NOT NULL`,[id,action,status]);
  await db.query(`INSERT INTO reseller_audit(reseller_id,reseller_admin_id,action,target_id)
    SELECT t.reseller_id,i.created_by_reseller_admin_id,$2,i.id FROM user_invitations i
      JOIN tenants t ON t.id=i.tenant_id WHERE i.id=$1 AND i.created_by_reseller_admin_id IS NOT NULL`,[id,action]);
}

async function queueInvitation(db,id,token,business) {
  const status = business ? configStatus() : "manual";
  if (status !== "ready") return status;
  await db.query("INSERT INTO company_invitation_email(invitation_id,status,payload) VALUES($1,'pending',$2)",
    [id,protect(token,id)]);
  await audit(db,id,"tenant.invitation_email_queued","pending");
  return "pending";
}

function manualInvitation(token, brandSlug, resellerAdmin=false) {
  const development = process.env.NODE_ENV === "development" && process.env.ALLOW_DEV_INVITATION_TOKEN === "true";
  if (!development && process.env.ALLOW_MANUAL_INVITATION_TOKEN !== "true") return {};
  const acceptancePath=brandSlug
    ? `/r/${brandSlug}/${resellerAdmin?"activate-admin":"accept-invitation"}`
    : "/accept-invitation";
  return {manualToken:token,acceptancePath,activationLink:activationLink(token,brandSlug,resellerAdmin),
    ...(development?{developmentToken:token}:{})};
}

async function recordDelivery(id,status) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await db.query(`UPDATE company_invitation_email SET status=$2,
      payload=CASE WHEN $2='pending' THEN payload ELSE NULL END,updated_at=clock_timestamp(),
      available_at=clock_timestamp()+make_interval(secs=>30*power(2,attempts)::integer)
      WHERE invitation_id=$1 AND status='sending'`,[id,status]);
    if (result.rowCount) await audit(db,id,"tenant.invitation_email_attempt",status);
    await db.query("COMMIT");
  } catch(error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

async function runInvitationDelivery(mail) {
  await pool.query(`UPDATE company_invitation_email d SET status='cancelled',payload=NULL,updated_at=clock_timestamp()
    FROM user_invitations i WHERE i.id=d.invitation_id AND d.status='pending'
    AND (i.used_at IS NOT NULL OR i.expires_at<=clock_timestamp())`);
  await pool.query(`UPDATE company_invitation_email SET status='uncertain',payload=NULL,updated_at=clock_timestamp()
    WHERE status='sending' AND updated_at<clock_timestamp()-interval '5 minutes'`);
  if (configStatus() !== "ready") return;
  const {rows:[job]} = await pool.query(`UPDATE company_invitation_email d SET status='sending',
    attempts=attempts+1,updated_at=clock_timestamp() WHERE invitation_id=(
      SELECT invitation_id FROM company_invitation_email WHERE status='pending' AND available_at<=clock_timestamp()
      ORDER BY available_at,invitation_id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING d.*`);
  if (!job) return;
  const {rows:[recipient]} = await pool.query(`SELECT u.email,u.full_name,t.name,i.expires_at,i.token_hash,
    r.id AS reseller_id,r.slug AS brand_slug,r.display_name AS brand_name,r.support_email
    FROM user_invitations i JOIN tenants t ON t.id=i.tenant_id JOIN users u ON u.id=i.user_id AND u.tenant_id=t.id
    LEFT JOIN resellers r ON r.id=t.reseller_id
    WHERE i.id=$1 AND i.used_at IS NULL AND i.expires_at>clock_timestamp() AND NOT u.is_active
      AND u.role='tenant_admin' AND t.status='active' AND (t.customer_type='business' OR r.id IS NOT NULL)`,[job.invitation_id]);
  let status = "cancelled";
  if (recipient && /^[^\s,@<>]+@[^\s,@<>]+$/.test(recipient.email)) {
    try {
      const token = unprotect(job.payload,job.invitation_id);
      if (crypto.createHash("sha256").update(token).digest("hex") !== recipient.token_hash) throw new Error("Invalid outbox payload");
      await sendBranded(mail,recipient.reseller_id,{
        from:process.env.ALERT_SMTP_FROM,
        to:recipient.email,
        messageId:`<company-invitation-${job.invitation_id}@sna-fleet.local>`,
        subject:`Activate your ${recipient.brand_name||"SNA Fleet Management"} account`,
        text:`Hello ${recipient.full_name},\n\nYou have been invited to administer ${recipient.name} in ${recipient.brand_name||"SNA Fleet Management"}. Open the link and choose a password to activate your account.\n\n${activationLink(token,recipient.brand_slug)}\n\nThis one-time invitation expires at ${recipient.expires_at.toISOString()} (UTC).\n${recipient.support_email?`Support: ${recipient.support_email}\\n`:""}`,
      },activationLink(token,recipient.brand_slug));
      status = "sent";
    } catch(error) {
      status = deliveryFailure(error,job.attempts);
    }
  }
  await recordDelivery(job.invitation_id,status);
}

function startInvitationEmail() {
  let busy = false;
  let mail;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (configStatus() === "ready" && !mail) mail = transport();
      await runInvitationDelivery(mail);
    } catch(error) {
      console.error("Invitation email worker unavailable",error.code ?? error.name);
    } finally { busy = false; }
  },2000);
  timer.unref();
}

module.exports = { configStatus, queueInvitation, manualInvitation, runInvitationDelivery, startInvitationEmail, protect, unprotect, activationLink };
