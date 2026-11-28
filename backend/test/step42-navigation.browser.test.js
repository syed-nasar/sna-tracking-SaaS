const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

test("Step 42 logout and invalidation navigate safely in Chrome", {
  skip: !process.env.STEP42_BROWSER_DIST && "Requires a disposable Vite build and headless Chrome",
}, async () => {
  const dist = process.env.STEP42_BROWSER_DIST;
  const storageKey = "sna-fleet.auth";
  const token = expiry => ["fixture",Buffer.from(JSON.stringify({exp:expiry})).toString("base64url"),"fixture"].join(".");
  const valid = () => token(Math.floor(Date.now()/1000)+900);
  const profiles = {
    platform:{id:"1",fullName:"Fixture Platform"},
    tenant:{id:"2",fullName:"Fixture Customer",customerType:"personal",resellerSlug:null},
    reseller:{id:"3",full_name:"Fixture Reseller",slug:"alpha"},
  };
  let rejectRestore=false;
  let submittedReseller;
  let inventoryDevice;
  let provisioningReads = 0;
  let attempts = 0;
  const setProvisioning = (status) => Object.assign(inventoryDevice, {
    provisioningStatus: status,
    allocationReady: status === "provisioned",
    traccarDeviceId: status === "provisioned" ? "65" : null,
  });
  const app=express();
  app.use(express.json());
  for (const [type,route] of [["tenant","/api/users/me"],["platform","/api/platform/auth/me"],["reseller","/api/reseller/auth/me"]]) {
    app.get(route,(_req,res)=>rejectRestore?res.sendStatus(401):res.json(profiles[type]));
  }
  app.post("/api/auth/login",(req,res)=>{
    submittedReseller=req.body.resellerSlug;
    res.json({accessToken:valid(),user:profiles.tenant});
  });
  app.get("/api/tenant-brand",(_req,res)=>res.json({brand:null}));
  app.get("/api/brands/:slug",(req,res)=>res.json({brand:{slug:req.params.slug,display_name:req.params.slug,
    primary_color:req.params.slug==="tracknova"?"#184c76":"#79257a",assets:["logo","dark-logo"]}}));
  app.get("/api/brands/host/:hostname",(_req,res)=>res.json({brand:{slug:"alpha",display_name:"Alpha domain"}}));
  app.get("/api/alerts/notifications/unread",(_req,res)=>res.json({count:0}));
  app.get("/api/reseller/inventory",(_req,res)=>res.json({items:inventoryDevice ? [
    {id:"10",device_name:"Reseller unverified fixture",lifecycle_status:"available",allocation_ready:false},
  ] : []}));
  app.get("/api/reseller/inventory/10/history",(_req,res)=>res.json({items:[
    {action:"allocated",created_at:"2026-01-01T00:00:00Z"},
  ]}));
  app.get("/api/platform/devices/inventory", (_req,res)=>res.json({
    data: inventoryDevice ? [inventoryDevice] : [], pagination:{limit:25,hasMore:false},traccarAvailable:true,
  }));
  app.post("/api/platform/devices/inventory",(req,res)=>{
    inventoryDevice={id:"10",uniqueId:req.body.uniqueId,lifecycleStatus:"available",provisioningStatus:"pending"};
    attempts++;
    res.status(201).json(inventoryDevice);
  });
  app.get("/api/platform/devices/inventory/10",(req,res)=>{
    provisioningReads++;
    if(provisioningReads===2)setProvisioning("processing");
    if(provisioningReads===3)setProvisioning("failed");
    if(attempts===2)setProvisioning("provisioned");
    res.json(inventoryDevice);
  });
  app.get("/api/platform/devices/inventory/10/provisioning",(_req,res)=>res.json({data:[
    {id:"1",status:attempts===2?"provisioned":inventoryDevice.provisioningStatus,createdAt:"2026-01-01T00:00:00Z",attemptCount:1,
      reason:attempts!==2&&inventoryDevice.provisioningStatus==="failed"?"Traccar is unavailable.":null,
      events:[{id:"1",action:"provider_device_created",createdAt:"2026-01-01T00:00:02Z"}]},
    ...[[0,"failed"],[2,"conflict"],[5,"failed"]].map(([attemptCount,status])=>({
      id:String(attemptCount+2),status,attemptCount,createdAt:"2025-12-31T00:00:00Z",events:[],
    })),
  ]}));
  app.post("/api/platform/devices/inventory/10/provisioning",(_req,res)=>{
    attempts++;
    res.sendStatus(202);
  });
  app.get("/api/reseller/customers",(_req,res)=>res.json({items:[]}));
  let resellerCustomer={id:"8",name:"Reseller customer fixture",slug:"reseller-customer",status:"active",
    customer_type:"business",version:"31",recent_activity:[]};
  app.get("/api/reseller/customers/8",(_req,res)=>res.json(resellerCustomer));
  app.patch("/api/reseller/customers/8/status",(req,res)=>{
    const {status}=req.body;
    resellerCustomer={...resellerCustomer,status,version:String(Number(resellerCustomer.version)+1),
      recent_activity:[{id:status,action:"customer."+status,created_at:"2026-01-01T00:00:00Z"},
        ...resellerCustomer.recent_activity]};
    res.json({status,version:resellerCustomer.version});
  });
  app.get("/api/platform/tenants",(req,res)=>res.json({
    data:[{id:"9",name:"Directory fixture",slug:"directory-fixture",status:"active",customer_type:"business"}],
    pagination:{limit:50,offset:0,total:1,hasMore:false},
  }));
  let lifecycleStatus="active";
  let lifecycleActivity=[];
  app.patch("/api/platform/tenants/9/status",(req,res)=>{
    lifecycleStatus=req.body.status;
    lifecycleActivity=[{id:lifecycleStatus,action:"tenant."+lifecycleStatus,created_at:"2026-01-01T00:00:00Z"},...lifecycleActivity];
    res.json({status:lifecycleStatus,version:lifecycleStatus==="active"?"14":"13"});
  });
  app.get("/api/platform/tenants/9",(_req,res)=>res.json({
    id:"9",name:"Directory fixture",slug:"directory-fixture",status:lifecycleStatus,customer_type:"business",version:"12",
    vehicle_count:2,active_vehicle_count:1,allocated_gps_count:1,installed_gps_count:1,
    administrators:[{id:"15",full_name:"Fixture administrator",email:"admin@example.test",is_active:true}],
    recent_activity:lifecycleActivity,
  }));
  app.get("/api/platform/ops/summary",(_req,res)=>res.json({
    generatedAt:"2026-01-01T00:00:00Z",customers:{total:61},resellers:{total:1},
    vehicles:{total:12,active:11,with_gps:9,without_gps:3,unverified_history:2},gps:{total:12},
    provisioning:{counts:{failed:1},oldest_work_at:null},
  }));
  app.get("/api/platform/ops/vehicles",(_req,res)=>res.json({
    data:[{id:"9",name:"Vehicle fixture",status:"active",customer_name:"Directory fixture",tenant_id:"9",customer_type:"business"}],
    pagination:{limit:50,offset:0,total:1,hasMore:false},
  }));
  app.get("/api/platform/ops/provisioning",(_req,res)=>res.json({
    data:[{id:"10",device_name:"Blocked tracker fixture",provisioning_status:"failed",lifecycle_status:"available",age_seconds:360}],
    pagination:{limit:25,offset:0,hasMore:false},
  }));
  app.get("/api/platform/ops/invitations",(_req,res)=>res.json({
    data:[{id:"1",kind:"customer",tenant_id:"9",target:"Delivery fixture",status:"uncertain",attempts:1,age_seconds:360}],
    pagination:{limit:25,offset:0,hasMore:false},
  }));
  app.get("/api/platform/ops/signals",(_req,res)=>res.json({
    sim:{status:"unavailable"},billing:{status:"unavailable"},alerts:{status:"unavailable"},
  }));
  app.get("/api/platform/ops/health",(_req,res)=>res.json(Object.fromEntries(
    ["api","postgres","traccar","gps","alerts","customerEmail","resellerEmail"].map(key=>[key,{
      status:key==="traccar"?"unavailable":"healthy",checkedAt:"2026-01-01T00:00:00Z",
    }])
  )));
  app.get("/api/platform/ops/audit",(_req,res)=>res.json({
    data:[{id:"platform:1",at:"2026-01-01T00:00:00Z",domain:"customers",action:"fixture.updated",actor_type:"platform"}],
    nextCursor:null,
  }));
  app.get("/api/platform/billing/report",(_req,res)=>res.json({
    from:"2026-01-01",to:"2026-01-01",active:0,upcoming:0,currencies:[],renewals:[],
  }));
  app.get("/api/platform/alerts",(_req,res)=>res.json({ingestion:[],email:[],geofenceSync:[]}));
  app.get("/api/reports/vehicles",(_req,res)=>res.json({vehicles:[]}));
  app.use("/api",(_req,res)=>res.json([]));
  app.use(express.static(dist));
  app.get(/.*/,(_req,res)=>res.sendFile(path.join(dist,"index.html")));
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const chrome=spawn(process.env.STEP42_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",[
    "--headless","--no-sandbox","--disable-gpu","--remote-debugging-port=0",
    "--user-data-dir="+fs.mkdtempSync(path.join(os.tmpdir(),"sna-step42-auth-browser-")),
    "--no-proxy-server","--host-resolver-rules=MAP fleet.example.test 127.0.0.1","about:blank",
  ],{stdio:["ignore","ignore","pipe"],windowsHide:true});
  let ws;
  try {
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("Chrome startup timed out")),8000);
      chrome.stderr.on("data",buffer=>{
        const match=buffer.toString().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
        if(match){clearTimeout(timer);resolve(match[1]);}
      });
      chrome.on("error",reject);
    });
    const [page]=await (await fetch("http://127.0.0.1:"+port+"/json/list")).json();
    ws=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(resolve=>ws.addEventListener("open",resolve,{once:true}));
    let seq=0;
    const pending=new Map();
    ws.addEventListener("message",event=>{
      const message=JSON.parse(event.data);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++seq;
      const timer=setTimeout(()=>reject(Error(method+" timed out")),8000);
      pending.set(id,message=>{clearTimeout(timer);message.error?reject(Error(method)):resolve(message.result);});
      ws.send(JSON.stringify({id,method,params}));
    });
    const ev=async expression=>(await cdp("Runtime.evaluate",{expression,returnByValue:true})).result?.value;
    const wait=async (label,expression)=>{
      for(let i=0;i<100;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,75));}
      throw Error(label+" timed out");
    };
    const go=route=>cdp("Page.navigate",{url:(route.startsWith("http")?"":origin)+route});
    const at=route=>"location.pathname==="+JSON.stringify(route);
    const seed=async(type,credential=valid(),login)=>{
      await ev(`sessionStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(JSON.stringify({type,token:credential,login}))})`);
    };
    const loginPage=async()=>wait("login page","!!document.querySelector('#email')");
    const accountMenu=`document.querySelector('summary[aria-label="Account menu"]')`;
    const clickLogout=async()=>{
      await wait("authenticated shell","!!"+accountMenu);
      await ev(accountMenu+".click()");
      await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sign Out').click()`);
    };
    const signedOut=async destination=>{
      await wait("login destination "+destination,at(destination)+` && sessionStorage.getItem('${storageKey}')===null`);
      await loginPage();
    };
    const protectedPaths={tenant:"/reports",reseller:"/reseller/inventory",platform:"/platform/alerts"};
    await go("/login");await loginPage();
    const platformLoginLink="Boolean(document.querySelector('main a[href=\"/platform/login\"]'))";
    assert.equal(await ev(platformLoginLink),true);
    await go("/platform/alerts");await wait("platform guard",at("/platform/login"));
    await go("/reseller/inventory");await wait("reseller guard",at("/reseller/login"));
    await loginPage();
    assert.equal(await ev("document.querySelector('#tenantSlug').value"),"");
    await go("/reports");await signedOut("/login");
    const clickLoginLink=label=>ev(`[...document.querySelectorAll('a')].find(a=>a.textContent.trim()===${JSON.stringify(label)}).click()`);
    for(const slug of ["tracknova","fleetorbit"]){
      const customerPath=`/r/${slug}/login`,adminPath=`/r/${slug}/reseller/login`;
      await go(customerPath);
      await wait("customer branding "+slug,`document.title===${JSON.stringify(slug)}`);
      assert.equal(await ev(platformLoginLink),false);
      await clickLoginLink("Reseller Administrator Login");
      const brandedAdmin=at(adminPath)+` && document.title===${JSON.stringify(slug)} &&
        document.querySelector('#tenantSlug')?.value===${JSON.stringify(slug)}`;
      await wait("branded reseller login "+slug,brandedAdmin);
      await cdp("Page.reload");
      await wait("branded reseller login after reload "+slug,brandedAdmin);
      assert.equal(await ev(platformLoginLink),false);
      for(const [theme,expected] of [["light","light"],["dark","dark"],["system","dark"]]){
        await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"dark"}]});
        await ev(`(()=>{const select=document.querySelector('select[aria-label="Color theme"]');
          select.value=${JSON.stringify(theme)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        assert.equal(await ev("document.documentElement.dataset.theme"),expected);
        assert.equal(await ev("document.querySelector('.reseller-branded').style.getPropertyValue('--brand-primary')"),
          slug==="tracknova"?"#184c76":"#79257a");
        const logo=expected==="dark"?"dark-logo":"logo";
        assert.equal(await ev(`[...document.images].some(img=>img.getAttribute('src').endsWith(${JSON.stringify(`/brands/${slug}/assets/${logo}`)}) &&
          getComputedStyle(img).display!=='none')`),true);
      }
      await ev("history.back()");
      await wait("back to fleet login "+slug,at(customerPath));
      await ev("history.forward()");
      await wait("forward to reseller login "+slug,brandedAdmin);
      await clickLoginLink("Switch to Fleet Login");
      await wait("switch to fleet login "+slug,at(customerPath));
    }
    for(const [type,slug,customerType,destination] of [
      ["tenant",null,"personal","/login"],["tenant",null,"business","/login"],["platform",null,null,"/login"],
      ["tenant","alpha","personal","/r/alpha/login"],["tenant","alpha","business","/r/alpha/login"],
      ["reseller","alpha",null,"/r/alpha/login"],["tenant","beta","personal","/r/beta/login"],
    ]){
      if(type==="tenant")Object.assign(profiles.tenant,{resellerSlug:slug,customerType});
      await seed(type);await go(protectedPaths[type]);await clickLogout();await signedOut(destination);
      if(type==="reseller"){
        assert.equal(await ev("document.querySelector('#tenantSlug').value"),"alpha");
        await cdp("Page.reload");await loginPage();
        assert.equal(await ev("document.querySelector('#tenantSlug').value"),"alpha");
      }
    }
    Object.assign(profiles.tenant,{resellerSlug:"alpha",customerType:"business"});
    await go("/login");await loginPage();
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Business').click()`);
    const submitBusiness=async()=>{
      for (const [selector,value] of [["#tenantSlug","fixture-business"],["#email","fixture@example.test"],["#password","fixture-password"]]){
        await ev(`(()=>{const el=document.querySelector('${selector}');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      }
      await ev("document.querySelector('form button[type=submit]').click()");
    };
    await submitBusiness();
    await clickLogout();await signedOut("/r/alpha/login");
    assert.equal(submittedReseller,undefined);
    for (const credential of [token(1),"invalid-token",valid()]){
      rejectRestore=credential!=="invalid-token";
      await seed("tenant",credential,{resellerSlug:"alpha"});
      await go("/reports");await signedOut("/r/alpha/login");
    }
    rejectRestore=false;
    await seed("tenant",token(Math.floor(Date.now()/1000)+3),{resellerSlug:"alpha"});
    await go("/reports");await wait("session restored before expiration","!!"+accountMenu);
    await signedOut("/r/alpha/login");
    await seed("tenant",token(1),{resellerSlug:"//outside.example"});
    await go("/reports");await signedOut("/login");
    await seed("reseller");await go("/reseller/inventory");
    await wait("reseller shell","!!"+accountMenu);
    rejectRestore=true;
    await ev("window.dispatchEvent(new Event('focus'))");
    await signedOut("/r/alpha/login");
    await cdp("Page.reload");await loginPage();
    assert.equal(await ev(`sessionStorage.getItem('${storageKey}')`),null);
    rejectRestore=false;
    const domainOrigin="http://fleet.example.test:"+server.address().port;
    await go(domainOrigin+"/reseller/login");
    await wait("custom domain reseller context","document.title==='Alpha domain' && document.querySelector('#tenantSlug')?.value==='alpha'");
    await go(domainOrigin+"/login");
    await wait("domain context","document.title==='Alpha domain'");
    assert.equal(await ev(platformLoginLink),false);
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Business').click()`);
    await submitBusiness();
    await clickLogout();await signedOut("/r/alpha/login");
    assert.equal(submittedReseller,"alpha");
    assert.equal(await ev("location.hostname"),"fleet.example.test");
    await go("/login");
    await loginPage();
    await seed("platform");
    await go("/platform/devices");
    const button = (label) => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
    await wait("inventory loaded", "!!" + button("New device"));
    await ev(button("New device") + ".click()");
    await ev(`(()=>{const el=document.querySelector('input[name="uniqueId"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'000-browser-fixture');el.dispatchEvent(new Event('input',{bubbles:true}));el.form.requestSubmit();})()`);
    const has = (label) => "document.body.innerText.includes(" + JSON.stringify(label) + ")";
    await wait("registration pending", has("Pending"));
    assert.equal(await ev(button("Allocate to tenant")+"?.disabled"),true);
    await wait("registration processing", has("Processing"));
    await wait("registration failure", has("Traccar is unavailable."));
    await ev(button("Retry provisioning")+".click()");
    await wait("provisioned after retry", has("Provisioned"));
    await wait("mapping verification control", "!!"+button("Verify existing mapping"));
    await wait("provisioned inventory row",has("Available \u00B7 Provisioned"));
    await ev("[...document.querySelectorAll('summary')].find(s=>s.textContent==='Provisioning attempt history').click()");
    for (const [theme, expected] of [["light","light"],["dark","dark"],["system","dark"]]) {
      await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"dark"}]});
      await ev(`(()=>{const control=document.querySelector('select[aria-label="Color theme"]');if(!control){
        localStorage.setItem('sna-fleet.theme',${JSON.stringify(theme)});window.dispatchEvent(new StorageEvent('storage',{key:'sna-fleet.theme'}));return;}
        control.value=${JSON.stringify(theme)};control.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.equal(await ev("document.documentElement.dataset.theme"),expected);
      const history=await ev("[...document.querySelectorAll('details[open]')].find(d=>d.querySelector('summary')?.textContent==='Provisioning attempt history').innerText");
      for (const line of ["Provisioned \u00B7 1 run","Failed \u00B7 0 runs","Conflict requires review \u00B7 2 runs",
        "Failed \u00B7 5 runs","\u00B7 provider device created"]) {
        assert.ok(history.split("\n").some(row=>row.endsWith(line)),theme+": "+line);
      }
      assert.doesNotMatch(history,/ \? |\b1 runs\b/);
    }
    await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    assert.equal(await ev("document.documentElement.scrollWidth <= 390"),true);
    await seed("reseller");
    await go("/reseller/inventory");
    await wait("reseller readiness",has("Platform provisioning required"));
    assert.equal(await ev(has("Reseller unverified fixture \u00B7 available")),true);
    await ev(button("History")+".click()");
    await wait("reseller history",has("allocated \u00B7"));
    assert.equal(await ev("Boolean("+button("Retry provisioning")+")"),false);
    await go("/reseller/customers/8");
    await wait("reseller customer details",has("Reseller customer fixture"));
    await ev("window.confirm=()=>true; window.prompt=()=> 'Browser reseller lifecycle fixture';");
    for(const [action,event] of [["Suspend customer","customer suspended"],["Reactivate customer","customer active"]]){
      await wait(action,`!!${button(action)} && !${button(action)}.disabled`);
      await ev(button(action)+".click()");
      await wait("reseller activity refreshed "+event,has(event));
    }
    assert.equal(await ev("Boolean(document.querySelector('nav a[href=\"/platform/vehicles\"]'))"),false);
    await go("/platform/vehicles");
    await wait("reseller cannot open platform vehicle directory",at("/platform/login"));
    await seed("platform");
    for(const [route,contents] of [
      ["/platform/dashboard","Summary generated"],
      ["/platform/customers","Directory fixture"],
      ["/platform/tenants/9","Fixture administrator"],
      ["/platform/operations","Blocked tracker fixture"],
      ["/platform/operations?queue=invitations","Delivery fixture"],
      ["/platform/health","PostgreSQL"],
      ["/platform/audit","fixture.updated"],
    ]){
      await go(route);
      await wait(route,has(contents));
      assert.equal(await ev("document.documentElement.scrollWidth <= 390"),true,route);
    }
    await go("/platform/dashboard");
    await wait("vehicle KPI links", "document.querySelectorAll('main a[href^=\"/platform/vehicles\"]').length === 5");
    for(const filter of ["","?status=active","?gps=installed","?gps=uninstalled","?gps=unverified"]){
      const path="/platform/vehicles"+filter;
      await go("/platform/dashboard");
      const link=`[...document.querySelectorAll('main a')].find(a=>a.getAttribute('href')===${JSON.stringify(path)})`;
      await wait("KPI link "+path,"!!"+link);
      await ev(link+".click()");
      await wait("directory navigation "+path,`location.pathname+location.search===${JSON.stringify(path)} && ${has("Vehicle fixture")}`);
    }
    await cdp("Emulation.setDeviceMetricsOverride",{width:1350,height:900,deviceScaleFactor:1,mobile:false});
    await go("/platform/dashboard");
    const vehicleNav="document.querySelector('aside nav a[href=\"/platform/vehicles\"]')";
    const vehicleHeader="document.querySelector('.workspace-topbar [title=\"Vehicle Directory\"]')?.textContent==='Vehicle Directory'";
    const directoryActive=`${at("/platform/vehicles")} && ${vehicleHeader} &&
      [...document.querySelectorAll('aside nav a[aria-current="page"]')].map(a=>a.textContent.trim()).join(',')==='Vehicles'`;
    await wait("sidebar Vehicles",`!!${vehicleNav}`);
    assert.equal(await ev(vehicleNav+".previousElementSibling.textContent.trim()"),"Resellers");
    await ev(vehicleNav+".click()");
    await wait("vehicle navigation and header",directoryActive);
    await ev("history.back()");
    await wait("back to dashboard",at("/platform/dashboard"));
    await ev("history.forward()");
    await wait("forward to vehicle directory",directoryActive);
    await ev("document.querySelector('[aria-label=\"Collapse sidebar\"]').click()");
    await wait("collapsed Vehicles active label",vehicleNav+".getAttribute('aria-label')==='Vehicles' && "+
      vehicleNav+".getAttribute('aria-current')==='page'");
    await cdp("Page.reload");
    await wait("direct directory reload with collapsed sidebar",vehicleHeader+" && "+
      vehicleNav+"?.getAttribute('aria-current')==='page' && "+vehicleNav+"?.getAttribute('aria-label')==='Vehicles'");
    await ev("document.querySelector('[aria-label=\"Expand sidebar\"]').click()");
    await wait("expanded Vehicle Directory",directoryActive);
    for(const [theme,expected] of [["light","light"],["dark","dark"],["system","dark"]]){
      await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"dark"}]});
      await ev(`(()=>{const select=document.querySelector('select[aria-label="Color theme"]');
        select.value=${JSON.stringify(theme)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait("vehicle directory "+theme,directoryActive+` && document.documentElement.dataset.theme==='${expected}'`);
    }
    await go("/platform/tenants/9");
    await wait("customer details",has("Fixture administrator"));
    await ev("window.confirm=()=>true; window.prompt=()=> 'Browser lifecycle fixture';");
    for(const [action,event] of [["Suspend Customer","tenant.suspended"],["Activate Customer","tenant.active"]]){
      const control=`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().toLowerCase()===${JSON.stringify(action.toLowerCase())})`;
      await wait(action,`!!${control} && !${control}.disabled`);
      await ev(control+".click()");
      await wait("activity refreshed "+event,has(event));
      assert.equal(await ev(has("Trackers 1 allocated, 1 installed")),true);
    }
  } finally {
    ws?.close();
    chrome.kill();
    await new Promise(resolve=>server.close(resolve));
  }
});
