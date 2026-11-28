const express = require("express");
const { requirePlatformAuth } = require("../middleware/platform-auth.middleware");
const { respondError } = require("../services/gps-inventory.service");
const operations = require("../services/platform-operations.service");
const { audit } = require("../services/platform-audit.service");
const { vehicleDirectory } = require("../services/platform-vehicles.service");

const router=express.Router();
router.use(requirePlatformAuth);
for (const [path,operation] of Object.entries({
  "/summary":operations.summary,"/health":operations.health,"/signals":operations.signals,
  "/provisioning":operations.provisioning,"/invitations":operations.invitations,"/audit":audit,"/vehicles":vehicleDirectory,
})) {
  router.get(path,async(req,res)=>{
    res.set("Cache-Control","private, no-store");
    try { res.json(await operation(req.query)); } catch (error) { respondError(res,error); }
  });
}
module.exports=router;
