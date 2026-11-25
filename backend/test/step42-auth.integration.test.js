const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const express = require("express");

test("Step 42 customer login, suspension and domain isolation over HTTP", {
  skip: process.env.STEP42_INTEGRATION !== "1" && "Requires an explicitly enabled disposable database",
}, async () => {
  assert.match(process.env.DB_NAME || "", /^step42_auth_test[A-Za-z0-9_]*$/);
  assert.equal(process.env.DB_HOST, "127.0.0.1");
  assert.notEqual(process.env.DB_PORT, "5432");
  process.env.JWT_SECRET = "disposable-step42-auth-test-fixture-only";
  const pool = require("../src/config/db");
  const db = async (sql, values) => (await pool.query(sql,values)).rows[0];
  const servers = [];
  const nonce = randomUUID().slice(0,8);
  const password = "synthetic-test-only-password";
  const hash = await bcrypt.hash(password,4);
  const shared = `shared-${nonce}@example.test`;
  const host = `fleet-${nonce}.example.com`;
  const org = async label => db(
    "INSERT INTO resellers(slug,legal_name,display_name,contact_email) VALUES($1,$1,$1,$2) RETURNING id,slug",
    [`${label}-${nonce}`,shared]);
  const account = async (label,reseller,type,email=shared,status="active",active=true) => {
    const tenant=await db("INSERT INTO tenants(name,slug,customer_type,reseller_id,status) VALUES($1,$1,$2,$3,$4) RETURNING id,slug",
      [`${label}-${nonce}`,type,reseller?.id??null,status]);
    await db("INSERT INTO users(tenant_id,full_name,email,password_hash,role,is_active) VALUES($1,'Fixture',$2,$3,'tenant_admin',$4)",
      [tenant.id,email,hash,active]);
    return tenant;
  };
  const start = async () => {
    // Each server gets its own real login limiter.
    delete require.cache[require.resolve("../src/routes/auth.routes")];
    const app=express();
    app.use(express.json());
    app.use("/api/auth",require("../src/routes/auth.routes"));
    const routes=require("../src/routes/resellers.routes");
    app.use("/api/reseller",routes.reseller);
    app.use("/api/platform/resellers",routes.platform);
    app.use("/api/platform/auth",require("../src/routes/platform-auth.routes"));
    app.use("/api/brands",routes.publicApi);
    app.use("/api/users",require("../src/routes/user.routes"));
    app.use("/api/reports",require("../src/routes/vehicle-reports.routes"));
    const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
    servers.push(server);
    return async (path,{body,token,expected=200,method=body?"POST":"GET"}={})=>{
      const res=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{
        method,headers:{...(body?{"Content-Type":"application/json"}:{}),
          ...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,
      });
      assert.equal(res.status,expected,path);
      return res.status===204?null:res.json();
    };
  };
  try {
    assert.equal((await db("SELECT current_database() AS db")).db,process.env.DB_NAME);
    const a=await org("alpha"),b=await org("beta");
    const direct=await account("direct",null,"personal");
    const pa=await account("pa",a,"personal"),pb=await account("pb",b,"personal");
    const unique=`unique-${nonce}@example.test`;
    const onlyA=await account("only-a",a,"personal",unique);
    const business=await account("business",a,"business");
    const otherBusiness=await account("other-business",b,"business");
    const admin=`admin-${nonce}@example.test`;
    await db("INSERT INTO reseller_admins(reseller_id,full_name,email,password_hash) VALUES($1,'Fixture',$2,$3)",[a.id,admin,hash]);
    let request=await start();
    const login=(fields,expected=200)=>request("/auth/login",{body:{email:shared,password,...fields},expected});
    assert.equal((await login({})).user.tenantId,direct.id);
    await login({email:unique},401);
    assert.equal((await login({resellerSlug:a.slug})).user.tenantId,pa.id);
    assert.equal((await login({resellerSlug:b.slug})).user.tenantId,pb.id);
    assert.equal((await login({email:unique,resellerSlug:a.slug})).user.tenantId,onlyA.id);
    await login({email:unique,resellerSlug:b.slug},401);
    const businessLogin=await login({tenantSlug:business.slug});
    assert.equal(businessLogin.user.resellerSlug,a.slug);
    assert.equal((await request("/users/me",{token:businessLogin.accessToken})).resellerSlug,a.slug);
    assert.equal((await login({tenantSlug:business.slug,resellerSlug:a.slug})).user.tenantId,business.id);
    await login({tenantSlug:business.slug,resellerSlug:b.slug},401);
    await account("ambiguous",a,"personal");
    await login({resellerSlug:a.slug},401);
    request=await start();
    const platformEmail=`platform-${nonce}@example.test`;
    await db("INSERT INTO platform_admins(full_name,email,password_hash) VALUES('Fixture',$1,$2)",[platformEmail,hash]);
    const platform=(await request("/platform/auth/login",{body:{email:platformEmail,password}})).accessToken;
    const status=next=>request("/platform/resellers/"+a.id,{method:"PATCH",token:platform,expected:204,
      body:{legal_name:"Fixture",contact_email:shared,status:next}});
    const dormant=`dormant-${nonce}@example.test`,disabled=`disabled-${nonce}@example.test`;
    await account("inactive-tenant",a,"personal",dormant,"inactive");
    await account("inactive-user",a,"personal",disabled,"active",false);
    await login({email:dormant,resellerSlug:a.slug},401);
    await login({email:disabled,resellerSlug:a.slug},401);
    const adminLogin=(expected=200)=>request("/reseller/auth/login",{body:{slug:a.slug,email:admin,password},expected});
    const {accessToken}=await adminLogin();
    await request("/reseller/auth/me",{token:accessToken});
    await request("/reports/vehicles",{token:accessToken,expected:401});
    await db("INSERT INTO reseller_domains(hostname,reseller_id,challenge) VALUES($1,$2,repeat('a',64))",[host,a.id]);
    const getHost=()=>request("/brands/host/"+host);
    assert.equal((await getHost()).brand,null);
    assert.equal((await request("/brands/host/unknown-"+host)).brand,null);
    await db("UPDATE reseller_domains SET status='verified' WHERE hostname=$1",[host]);
    await status("suspended");
    await adminLogin(401);
    await request("/reseller/auth/me",{token:accessToken,expected:401});
    await request("/reseller/customers",{token:accessToken,body:{},expected:401});
    assert.equal((await request("/brands/"+a.slug)).brand.slug,a.slug);
    const {brand}=await getHost();
    assert.equal(brand.slug,a.slug);
    await login({resellerSlug:brand.slug,email:unique});
    await login({resellerSlug:brand.slug,tenantSlug:business.slug});
    await login({resellerSlug:brand.slug,tenantSlug:otherBusiness.slug},401);
    await db("UPDATE reseller_domains SET status='disabled' WHERE hostname=$1",[host]);
    assert.equal((await getHost()).brand,null);
    await status("active");
    await request("/reseller/auth/me",{token:accessToken,expected:401});
    await request("/reseller/auth/me",{token:(await adminLogin()).accessToken});
    await db("UPDATE users SET token_version=token_version+1 WHERE tenant_id=$1",[business.id]);
    await request("/users/me",{token:businessLogin.accessToken,expected:401});
  } finally {
    await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
    await pool.end();
  }
});
