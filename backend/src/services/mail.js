const nodemailer = require("nodemailer");

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

function deliveryFailure(error, attempts) {
  const retryable = (error.responseCode >= 400 && error.responseCode < 500) ||
    ["CONN", "EHLO", "HELO", "STARTTLS"].includes(error.command);
  return retryable ? (attempts < 5 ? "pending" : "failed")
    : (error.responseCode >= 500 ? "failed" : "uncertain");
}

module.exports = { smtpEnabled, transport, deliveryFailure };
