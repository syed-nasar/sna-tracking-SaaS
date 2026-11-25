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
  app.get("/api/brands/:slug",(req,res)=>res.json({brand:{slug:req.params.slug,display_name:req.params.slug}}));
  app.get("/api/brands/host/:hostname",(_req,res)=>res.json({brand:{slug:"alpha",display_name:"Alpha domain"}}));
  app.get("/api/alerts/notifications/unread",(_req,res)=>res.json({count:0}));
  app.get("/api/reseller/inventory",(_req,res)=>res.json({items:[]}));
  app.get("/api/reseller/customers",(_req,res)=>res.json({items:[]}));
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
    await go("/platform/alerts");await wait("platform guard",at("/platform/login"));
    await go("/reseller/inventory");await wait("reseller guard",at("/reseller/login"));
    await go("/reports");await signedOut("/login");
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
    await go("http://fleet.example.test:"+server.address().port+"/login");
    await wait("domain context","document.title==='Alpha domain'");
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Business').click()`);
    await submitBusiness();
    await clickLogout();await signedOut("/r/alpha/login");
    assert.equal(submittedReseller,"alpha");
    assert.equal(await ev("location.hostname"),"fleet.example.test");
  } finally {
    ws?.close();
    chrome.kill();
    await new Promise(resolve=>server.close(resolve));
  }
});
