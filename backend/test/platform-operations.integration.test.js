const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("Step 43 administration over HTTP and disposable PostgreSQL", {skip:process.env.STEP43_TEST_DB!=="1"}, async t=>{
  assert.equal(process.env.DB_HOST,"127.0.0.1");
  assert.match(process.env.DB_PORT??"",/^\d+$/);
  assert.notEqual(process.env.DB_PORT,"5432");
  assert.match(process.env.DB_NAME??"",/^step43_test_[a-z0-9_]+$/);
  process.env.JWT_SECRET="synthetic-step43-signing-fixture-only";
  const pool=require("../src/config/db");
  t.after(()=>pool.end());
  const one=async(sql,args)=>(await pool.query(sql,args)).rows[0];
  assert.equal((await one("SELECT to_regclass('public.tenants') AS present")).present,null);
  const migrations=path.join(__dirname,"../database");
  for(const name of fs.readdirSync(migrations).filter(name=>/^\d{3}.*\.sql$/.test(name)&&!name.startsWith("002")).sort()) {
    await pool.query(fs.readFileSync(path.join(migrations,name),"utf8"));
  }
  const bcrypt=require("bcryptjs");
  const jwt=require("jsonwebtoken");
  const traccar=require("../src/services/traccar.service");
  t.mock.method(traccar,"healthProbe",async()=>{throw Error("internal-test-provider-error");});
  const app=require("../src/app");
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin="http://127.0.0.1:"+server.address().port+"/api";
  const admin=await one("INSERT INTO platform_admins(full_name,email,password_hash) VALUES ('Admin','admin@example.test','unused') RETURNING id");
  const disabled=await one("INSERT INTO platform_admins(full_name,email,password_hash,is_active) VALUES ('Disabled','off@example.test','unused',false) RETURNING id");
  const sign=(audience,id=admin.id,claims={})=>jwt.sign(claims,process.env.JWT_SECRET,{
    audience,issuer:"sna-fleet-api",subject:id,expiresIn:"1h",
  });
  const bearer=sign("sna-fleet-platform");
  const call=(route,token=bearer,method="GET",body)=>fetch(origin+route,{
    method,headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const json=async(...args)=>{
    const response=await call(...args);
    const payload=await response.json();
    assert.equal(response.status,200,JSON.stringify(payload));
    return payload;
  };

  const reseller=await one(`INSERT INTO resellers(slug,legal_name,display_name,contact_email)
    VALUES ('fixture-reseller','Fixture reseller','Fixture resale','reseller@example.test') RETURNING id,slug`);
  const resellerAdmin=await one(`INSERT INTO reseller_admins(reseller_id,full_name,email,password_hash)
    VALUES ($1,'Fixture dealer','dealer@example.test','unused') RETURNING *`,[reseller.id]);
  const resellerToken=require("../src/services/resellers").resellerToken({...resellerAdmin,slug:reseller.slug});
  await pool.query(`INSERT INTO tenants(name,slug,customer_type) SELECT 'Account '||n,'acct-'||n,'personal' FROM generate_series(1,58) n`);
  const tenant=await one(`INSERT INTO tenants(name,slug,email,customer_type)
    VALUES ('Later Business','later-business','directory@example.test','business') RETURNING id`);
  const dealerTenant=await one(`INSERT INTO tenants(name,slug,reseller_id)
    VALUES ('Dealer customer','dealer-customer',$1) RETURNING id`,[reseller.id]);
  const password="synthetic-fixture-test-password";
  const customer=await one(`INSERT INTO users(tenant_id,full_name,email,password_hash,role)
    VALUES ($1,'Fixture customer','customer@example.test',$2,'tenant_admin') RETURNING id`,[tenant.id,await bcrypt.hash(password,4)]);

  await t.test("directory searches the full dataset and dashboard totals are independent",async()=>{
    const all=await json("/platform/tenants?limit=50");
    assert.equal(all.data.length,50);
    assert.equal(all.pagination.total,60);
    const next=await json("/platform/tenants?offset=50");
    assert.equal(next.data.length,10);
    assert.equal(next.pagination.hasMore,false);
    assert.equal(new Set([...all.data,...next.data].map(row=>row.id)).size,60);
    const found=await json("/platform/tenants?q=directory%40example.test&type=business&status=active&ownership=direct");
    assert.equal(found.pagination.total,1);
    assert.equal(found.data[0].id,tenant.id);
    const scoped=await json("/platform/tenants?ownership=reseller&resellerId="+reseller.id);
    assert.equal(scoped.data[0].reseller_name,"Fixture resale");
    assert.equal((await json("/platform/tenants?q=does-not-exist")).pagination.total,0);
    assert.equal((await call("/platform/tenants?limit=101")).status,400);
    const summary=await json("/platform/ops/summary");
    assert.equal(summary.customers.total,60);
    assert.equal(summary.customers.reseller_owned,1);
    assert.equal(summary.provisioning.counts.pending,0);
    assert.equal((await json("/platform/tenants/"+tenant.id)).administrators[0].id,customer.id);
  });

  await t.test("all operational reads require an active platform audience",async()=>{
    for(const route of ["summary","health","signals","audit","invitations","provisioning","vehicles"]){
      const endpoint="/platform/ops/"+route;
      for(const token of [null,"invalid",resellerToken,...["tenant_admin","manager","viewer"].map(role=>
        sign("sna-fleet-users",customer.id,{role,tenantId:tenant.id,tokenVersion:0}))]){
        assert.equal((await call(endpoint,token)).status,401,endpoint);
      }
      const expired=jwt.sign({exp:1},process.env.JWT_SECRET,{audience:"sna-fleet-platform",issuer:"sna-fleet-api",subject:admin.id});
      assert.equal((await call(endpoint,expired)).status,401);
      assert.equal((await call(endpoint,sign("sna-fleet-platform",disabled.id))).status,403);
    }
  });

  await t.test("lifecycle revokes existing sessions even after reactivation",async()=>{
    await pool.query(`INSERT INTO gps_devices(traccar_device_id,unique_identifier,tenant_id,status,lifecycle_status)
      VALUES (99,'installed-fixture',$1,'assigned','installed')`,[tenant.id]);
    const vehicle=await one(`INSERT INTO vehicles(tenant_id,traccar_device_id,name,gps_installed_at)
      VALUES ($1,99,'Installed fixture','2026-01-01T00:00:00Z') RETURNING id`,[tenant.id]);
    const login=()=>call("/auth/login",null,"POST",{tenantSlug:"later-business",email:"customer@example.test",password});
    const first=await login();
    assert.equal(first.status,200);
    const old=(await first.json()).accessToken;
    assert.equal((await call("/users/me",old)).status,200);
    const base="/platform/tenants/"+tenant.id;
    const row=await json(base);
    const body={status:"suspended",version:row.version,reason:"Fixture suspension"};
    assert.equal((await call(base,bearer,"PATCH",{status:"suspended"})).status,400);
    assert.equal((await call(base,bearer,"PATCH",{customer_type:"personal"})).status,400);
    assert.equal((await call(base+"/status",resellerToken,"PATCH",body)).status,401);
    assert.equal((await call(base+"/status",bearer,"PATCH",{...body,reason:" "})).status,400);
    const responses=await Promise.all([call(base+"/status",bearer,"PATCH",body),call(base+"/status",bearer,"PATCH",body)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    assert.notEqual((await call("/users/me",old)).status,200);
    assert.notEqual((await login()).status,200);
    const suspended=await json(base);
    assert.equal(suspended.recent_activity[0].action,"tenant.suspended");
    await json(base+"/status",bearer,"PATCH",{status:"active",version:suspended.version,reason:"Fixture restoration"});
    assert.equal((await json(base)).recent_activity[0].action,"tenant.active");
    assert.notEqual((await call("/users/me",old)).status,200);
    const fresh=await login();
    assert.equal(fresh.status,200);
    assert.equal((await call("/users/me",(await fresh.json()).accessToken)).status,200);
    const unchanged=await one("SELECT traccar_device_id,gps_installed_at FROM vehicles WHERE id=$1",[vehicle.id]);
    assert.equal(unchanged.traccar_device_id,"99");
    assert.equal(unchanged.gps_installed_at.toISOString(),"2026-01-01T00:00:00.000Z");

    const scoped=await json("/reseller/customers/"+dealerTenant.id,resellerToken);
    const dealerUser=await one(`INSERT INTO users(tenant_id,full_name,email,password_hash,role)
      VALUES ($1,'Fixture admin','dealer-user@example.test','unused','tenant_admin') RETURNING id,token_version`,[dealerTenant.id]);
    await json("/reseller/customers/"+dealerTenant.id+"/status",resellerToken,"PATCH",
      {status:"suspended",version:scoped.version,reason:"Scoped fixture"});
    const audit=await one("SELECT lifecycle_details FROM reseller_audit WHERE target_id=$1",[dealerTenant.id]);
    assert.equal(audit.lifecycle_details.reason,"Scoped fixture");
    assert.equal((await json("/reseller/customers/"+dealerTenant.id,resellerToken)).recent_activity[0].action,"customer.suspended");
    assert.equal((await one("SELECT token_version FROM users WHERE id=$1",[dealerUser.id])).token_version,dealerUser.token_version+1);
    assert.equal((await call("/reseller/customers/"+tenant.id+"/status",resellerToken,"PATCH",body)).status,404);
  });

  await t.test("worklist uses current inventory and keeps invitation payloads private",async()=>{
    const recovered=await one(`INSERT INTO gps_devices(unique_identifier,traccar_device_id,provisioning_status,provider_verified_at)
      VALUES ('recovered',100,'provisioned',now()) RETURNING id`);
    await pool.query(`INSERT INTO gps_provisioning_attempts(device_id,platform_admin_id,mode,status,completed_at)
      VALUES ($1,$2,'provision','failed',now())`,[recovered.id,admin.id]);
    await pool.query(`INSERT INTO gps_devices(unique_identifier,provisioning_status)
      VALUES ('waiting','pending'),('blocked','failed'),('legacy','legacy'),('conflict','conflict'),('retry','retry')`);
    const result=await json("/platform/ops/provisioning");
    assert.equal(result.data.length,6);
    assert.ok(!result.data.some(x=>x.id===recovered.id));
    const invite=await one(`INSERT INTO user_invitations(tenant_id,user_id,token_hash,expires_at)
      VALUES ($1,$2,repeat('a',64),now()+interval '1 day') RETURNING id`,[tenant.id,customer.id]);
    await pool.query(`INSERT INTO company_invitation_email(invitation_id,status,payload,attempts)
      VALUES ($1,'pending','TEST_SECRET_PAYLOAD',2)`,[invite.id]);
    const deliveries=await json("/platform/ops/invitations?status=retry");
    assert.equal(deliveries.data.length,1);
    assert.ok(!JSON.stringify(deliveries).includes("TEST_SECRET_PAYLOAD"));
    assert.equal((await one("SELECT attempts FROM company_invitation_email WHERE invitation_id=$1",[invite.id])).attempts,2);
    const running=await one("INSERT INTO gps_devices(unique_identifier,provisioning_status) VALUES ('expired-claim','processing') RETURNING id");
    await pool.query(`INSERT INTO gps_provisioning_attempts(device_id,platform_admin_id,mode,status,lease_owner,lease_until)
      VALUES ($1,$2,'provision','processing',gen_random_uuid(),now()-interval '1 minute')`,[running.id,admin.id]);
    const expired=await json("/platform/ops/provisioning?stale=yes");
    assert.equal(expired.data.length,1);
    assert.equal(expired.data[0].id,running.id);
    assert.equal(expired.data[0].stale_claim,true);
    const resellerInvite=await one(`INSERT INTO reseller_invitations(reseller_id,admin_id,token_hash,expires_at,created_by)
      VALUES ($1,$2,repeat('b',64),now()+interval '1 day',$3) RETURNING id`,[reseller.id,resellerAdmin.id,admin.id]);
    await pool.query("INSERT INTO reseller_invitation_email(invitation_id,status) VALUES ($1,'uncertain')",[resellerInvite.id]);
    assert.equal((await json("/platform/ops/invitations?kind=reseller&status=uncertain")).data[0].id,resellerInvite.id);
  });

  await t.test("audit paginates equal timestamps and projects only safe fields",async()=>{
    await pool.query(`INSERT INTO platform_audit_logs(platform_admin_id,action,resource_type,resource_id,details,created_at)
      VALUES ($1,'fixture.updated','tenant',$2,'{"password":"TEST_SECRET_AUDIT"}','2026-01-01'),
        ($1,'fixture.updated','tenant',$2,'{"token":"TEST_SECRET_AUDIT"}','2026-01-01')`,[admin.id,tenant.id]);
    const url="/platform/ops/audit?domain=customers&actorType=platform&action=fixture.updated&limit=1&tenantId="+tenant.id;
    const first=await json(url);
    const second=await json(url+"&cursor="+first.nextCursor);
    assert.equal(first.data.length,1);
    assert.equal(second.data.length,1);
    assert.notEqual(first.data[0].id,second.data[0].id);
    assert.equal(second.nextCursor,null);
    assert.match(first.data[0].id,/^platform:/);
    assert.ok(!JSON.stringify(first).includes("TEST_SECRET_AUDIT"));
    const tracker=await one("SELECT id FROM gps_devices WHERE unique_identifier='recovered'");
    await pool.query(`INSERT INTO gps_device_events(device_id,action,platform_admin_id,details)
      VALUES ($1,'registered',$2,'{"rawPosition":"TEST_SECRET_AUDIT"}')`,[tracker.id,admin.id]);
    const attempt=await one("SELECT id FROM gps_provisioning_attempts WHERE device_id=$1",[tracker.id]);
    await pool.query(`INSERT INTO gps_provisioning_events(attempt_id,action,outcome_code)
      VALUES ($1,'provisioning_failed','provider_timeout')`,[attempt.id]);
    const sim=await one("INSERT INTO sim_cards(label) VALUES ('Fixture SIM') RETURNING id");
    await pool.query(`INSERT INTO sim_audit_events(sim_id,platform_admin_id,action,details)
      VALUES ($1,$2,'created','{"imsi":"TEST_SECRET_AUDIT"}')`,[sim.id,admin.id]);
    await pool.query(`INSERT INTO billing_events(platform_admin_id,tenant_id,resource,resource_id,action,details)
      VALUES ($1,$2,'subscription',1,'fixture.created','{"payment":"TEST_SECRET_AUDIT"}')`,[admin.id,tenant.id]);
    const invitation=await one("SELECT id FROM user_invitations WHERE user_id=$1",[customer.id]);
    await pool.query(`INSERT INTO platform_audit_logs(platform_admin_id,action,resource_type,resource_id,details)
      VALUES ($1,'tenant.invitation_email_attempt','tenant',$2,jsonb_build_object(
        'invitationId',$3::bigint,'deliveryStatus','failed','token','TEST_SECRET_AUDIT'))`,[admin.id,tenant.id,invitation.id]);
    for(const [domain,source] of [["gps","gps"],["provisioning","provisioning"],["sim","sim"],
      ["subscriptions","billing"],["resellers","reseller"],["invitations","platform"]]){
      const rows=(await json("/platform/ops/audit?domain="+domain)).data;
      assert.ok(rows.some(row=>row.id.startsWith(source+":")),domain);
      assert.ok(!JSON.stringify(rows).includes("TEST_SECRET_AUDIT"));
      if(domain==="invitations"){
        assert.equal(rows[0].resource_id,invitation.id);
        assert.equal(rows[0].executor,"invitation_worker");
        assert.equal(rows[0].outcome,"failed");
      }
      if(domain==="provisioning") assert.equal(rows[0].executor,"provisioning_worker");
    }
  });

  await t.test("health reports independent failures with no raw provider error",async()=>{
    const result=await json("/platform/ops/health");
    assert.equal(result.api.status,"healthy");
    assert.equal(result.postgres.status,"healthy");
    assert.equal(result.traccar.status,"unavailable");
    assert.ok(!JSON.stringify(result).includes("internal-test-provider-error"));
    assert.ok(["disabled","not_configured","unknown"].includes(result.customerEmail.status));
    assert.equal(result.gps.processLocal.running,false);
    assert.equal(result.gps.counts.failed,1);
    assert.equal(result.gps.device_counts.failed,1);
    assert.equal(result.gps.device_counts.provisioned,1);
    assert.equal(result.gps.recovered_devices,1);
    assert.equal(result.gps.expired_claims,1);
    assert.equal(result.gps.outstanding,1);
    assert.ok("forwardingConfigured" in result.alerts);
    assert.ok((await json("/platform/ops/signals")).sim.data);
  });

  await t.test("vehicle directory uses the same definitions as all five dashboard KPIs",async()=>{
    await pool.query(`INSERT INTO vehicles(tenant_id,name,registration_number,status)
      VALUES ($1,'Unlinked trailer','TRAILER-1','inactive')`,[dealerTenant.id]);
    await pool.query(`INSERT INTO gps_devices(traccar_device_id,unique_identifier,tenant_id,reseller_id,status,lifecycle_status)
      VALUES (101,'legacy-vehicle',$1,$2,'assigned','installed')`,[dealerTenant.id,reseller.id]);
    await pool.query(`INSERT INTO vehicles(tenant_id,traccar_device_id,name)
      VALUES ($1,101,'Legacy fleet vehicle')`,[dealerTenant.id]);
    const metrics=(await json("/platform/ops/summary")).vehicles;
    const directory="/platform/ops/vehicles";
    for(const [key,query] of [["total",""],["active","status=active"],["with_gps","gps=installed"],
      ["without_gps","gps=uninstalled"],["unverified_history","gps=unverified"]]){
      assert.equal((await json(directory+"?"+query)).pagination.total,metrics[key],key);
    }
    assert.deepEqual(metrics,{total:3,active:2,with_gps:2,without_gps:1,unverified_history:1});
    const {data:[row],pagination}=await json(directory+
      "?q=trailer-1&ownership=reseller&status=inactive&gps=uninstalled&resellerId="+reseller.id);
    assert.equal(pagination.total,1);
    assert.equal(row.trusted_history,false);
    assert.equal(row.reseller_name,"Fixture resale");
    assert.ok(!Object.hasOwn(row,"traccar_device_id"));
    const first=await json(directory+"?limit=1");
    const next=await json(directory+"?limit=1&offset=1");
    assert.ok(first.pagination.hasMore);
    assert.notEqual(first.data[0].id,next.data[0].id);
    assert.equal((await call(directory+"?gps=unknown")).status,400);
  });

  await t.test("degraded health remains available across slow and failed probes",async(t)=>{
    await new Promise(resolve=>setTimeout(resolve,3050));
    const query=pool.query.bind(pool);
    t.mock.method(pool,"query",(sql,...args)=>{
      if(sql?.text==="SELECT 1") return new Promise(()=>{});
      if(typeof sql==="string"&&sql.includes("SELECT max(received_at)")) throw Error("internal-alert-error");
      if(typeof sql==="string"&&sql.includes("FROM deliveries WHERE kind=$1")&&args[0]?.[0]==="customer") {
        throw Error("internal-email-error");
      }
      return query(sql,...args);
    });
    const start=Date.now();
    const result=await json("/platform/ops/health");
    assert.ok(Date.now()-start<4500,"probe responds within its deadline");
    assert.equal(result.postgres.status,"unavailable");
    assert.equal(result.alerts.status,"unavailable");
    assert.equal(result.customerEmail.status,"unavailable");
    assert.equal(result.gps.status,"unknown");
    assert.ok(!JSON.stringify(result).includes("internal-"));
  });
});
