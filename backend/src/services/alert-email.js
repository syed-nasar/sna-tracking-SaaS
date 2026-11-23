const nodemailer = require("nodemailer");
const pool = require("../config/db");

function smtpEnabled() {
  return Boolean(process.env.ALERT_SMTP_HOST && process.env.ALERT_SMTP_FROM);
}

function transport() {
  const secure = process.env.ALERT_SMTP_SECURE === "true";
  return nodemailer.createTransport({
    host: process.env.ALERT_SMTP_HOST,
    port: Number(process.env.ALERT_SMTP_PORT || (secure ? 465 : 587)),
    secure,
    requireTLS: !secure,
    auth: process.env.ALERT_SMTP_USER ? {
      user: process.env.ALERT_SMTP_USER, pass: process.env.ALERT_SMTP_PASSWORD,
    } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
}

async function runDelivery(mail) {
  // A process can die after the remote server accepted mail. Record that
  // outcome for reconciliation instead of automatically resending.
  await pool.query(`UPDATE alert_email_delivery SET status='uncertain',updated_at=clock_timestamp()
    WHERE status='sending' AND updated_at<clock_timestamp()-interval '5 minutes'`);
  const { rows } = await pool.query(`UPDATE alert_email_delivery SET status='sending',
    attempts=attempts+1,updated_at=clock_timestamp() WHERE id=(
    SELECT id FROM alert_email_delivery WHERE status='pending' AND available_at<=clock_timestamp()
      ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
  const job = rows[0];
  if (!job) return;
  let status = "cancelled";
  const recipient = (await pool.query(`SELECT u.email,e.type,e.occurred_at FROM users u
    JOIN tenants t ON t.id=u.tenant_id JOIN alert_preferences p ON p.user_id=u.id
    JOIN alert_events e ON e.tenant_id=u.tenant_id AND e.id=$3
    WHERE u.id=$1 AND u.tenant_id=$2 AND u.is_active AND t.status='active' AND p.email`,
  [job.user_id,job.tenant_id,job.event_id])).rows[0];
  if (recipient && /^[^\s,@<>]+@[^\s,@<>]+$/.test(recipient.email)) {
    try {
      await mail.sendMail({
        from: process.env.ALERT_SMTP_FROM, to: recipient.email,
        messageId: `<alert-${job.id}@sna-fleet.local>`,
        subject: "SNA Fleet alert",
        text: `Alert: ${recipient.type.replaceAll("_"," ")}\nTime (UTC): ${recipient.occurred_at.toISOString()}\nSign in to SNA Fleet to see authorized details.`,
      });
      status = "sent";
    } catch (error) {
      // Retry explicit non-acceptance, never ambiguous end-of-DATA timeouts.
      const retryable = (error.responseCode >= 400 && error.responseCode < 500) ||
        ["CONN","EHLO","HELO","STARTTLS"].includes(error.command);
      status = retryable ? (job.attempts<5?"pending":"failed")
        : (error.responseCode>=500?"failed":"uncertain");
    }
  }
  await pool.query(`UPDATE alert_email_delivery SET status=$2,updated_at=clock_timestamp(),
    available_at=clock_timestamp()+make_interval(secs=>30*power(2,attempts)::integer)
    WHERE id=$1 AND status='sending'`,[job.id,status]);
}

function startAlertEmail() {
  if (!smtpEnabled()) return;
  const mail = transport();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await runDelivery(mail); }
    catch (error) { console.error("Alert email worker unavailable",error.code ?? error.name); }
    finally { busy = false; }
  },2000);
  timer.unref();
}

module.exports = { startAlertEmail, smtpEnabled, runDelivery };
