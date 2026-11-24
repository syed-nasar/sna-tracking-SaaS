const express = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const reports = require("../services/vehicle-reports");
const { exportReport, types } = require("../services/report-export");
const pool = require("../config/db");
const { publicBrand } = require("../services/resellers");

const router=express.Router();
router.use(requireAuth,authorize("vehicles:read"));
router.use((req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
router.use(rateLimit({
  windowMs:60000,limit:30,standardHeaders:"draft-7",legacyHeaders:false,
  keyGenerator:req=>`${req.auth.tenantId}:${req.auth.userId}`,
  message:{message:"Too many report requests. Wait a minute and try again."},
}));

const run = handler => async (req,res,next) => {
  try { await handler(req,res); }
  catch(error) {
    if(error instanceof reports.ReportError) return res.status(error.status).json({message:error.message});
    next(error);
  }
};
const type = value => reports.TYPES.includes(value)?value:reports.reject(400,"Unsupported report type.");

router.get("/vehicles",run(async(req,res)=>res.json(await reports.options(req.auth,req.query))));
router.get("/trips/:id",run(async(req,res)=>{
  if(!/^[a-f0-9]{64}$/.test(req.params.id)) reports.reject(404,"Trip not found.");
  const filters=reports.parseFilters(req.query);
  if(filters.vehicles.length!==1) reports.reject(400,"Select the trip vehicle.");
  const dataset=await reports.fetchDataset(req.auth,filters,req.params.id);
  const trip=dataset.trips.find(row=>row.id===req.params.id);
  if(!trip) reports.reject(404,"Trip not found in this vehicle and date range.");
  res.json({trip,route:dataset.route});
}));
router.get("/exports/:type/:format",run(async(req,res)=>{
  const reportType=type(req.params.type);
  if(!Object.hasOwn(types,req.params.format)) reports.reject(400,"Unsupported export format.");
  const filters=reports.parseFilters(req.query);
  const dataset=await reports.fetchDataset(req.auth,filters);
  const report=reports.assemble(dataset,reportType,filters,false);
  const brand=await publicBrand(pool,"tenant",req.auth.tenantId);
  if(brand&&req.params.format==="pdf") {
    const {rows:[asset]}=await pool.query(`SELECT a.png FROM reseller_brand_assets a JOIN tenants t ON t.reseller_id=a.reseller_id
      WHERE t.id=$1 AND a.kind='logo'`,[req.auth.tenantId]);
    brand.logo=asset?.png;
  }
  const output=await exportReport(report,req.params.format,brand);
  await reports.recheck(req.auth,dataset.access);
  res.attachment(`sna-${reportType}.${req.params.format}`).type(output.type).send(output.body);
}));
router.get("/:type",run(async(req,res)=>{
  const reportType=type(req.params.type);
  const filters=reports.parseFilters(req.query);
  const dataset=await reports.fetchDataset(req.auth,filters);
  res.json(reports.assemble(dataset,reportType,filters));
}));

module.exports=router;
