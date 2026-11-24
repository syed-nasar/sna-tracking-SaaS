const pool = require("../config/db");

const entities = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
const escape = value => value.replace(/[&<>"']/g,ch=>entities[ch]);

async function brandedContent(resellerId, text, activationUrl) {
  if (!resellerId) return {text};
  const {rows:[asset]}=await pool.query("SELECT png FROM reseller_brand_assets WHERE reseller_id=$1 AND kind='logo'",[resellerId]);
  const logo=asset?'<img src="cid:sna-brand-logo" alt="" width="96" style="object-fit:contain">':"";
  const link=activationUrl?escape(activationUrl):null;
  let body=escape(text);
  if(link)body=body.replace(link,()=>`<a href="${link}">${link}</a>`);
  return {
    text,
    html:`<!doctype html><html><body>${logo}<div style="white-space:pre-wrap;font-family:Arial,sans-serif">${body}</div></body></html>`,
    attachments:asset?[{filename:"brand.png",content:asset.png,contentType:"image/png",cid:"sna-brand-logo"}]:[],
  };
}
async function sendBranded(mail,resellerId,message,link) {
  await mail.sendMail({...message,...await brandedContent(resellerId,message.text,link)});
}
module.exports={sendBranded};
