const assert = require("node:assert/strict");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");
const { resellerToken, slug, text, email } = require("../src/services/resellers");
const { manualInvitation } = require("../src/services/company-invitation-email");

test("reseller claims use an audience distinct from both existing session types", () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "disposable-reseller-unit-test-key";
  try {
    const token = resellerToken({id:"19",token_version:7});
    const data = jwt.verify(token,process.env.JWT_SECRET,{algorithms:["HS256"],issuer:"sna-fleet-api",audience:"sna-fleet-resellers"});
    assert.equal(data.sub,"19");
    assert.equal(data.version,7);
    assert.throws(()=>jwt.verify(token,process.env.JWT_SECRET,{audience:"sna-fleet-users"}));
    assert.throws(()=>jwt.verify(token,process.env.JWT_SECRET,{audience:"sna-fleet-platform"}));
  } finally {
    if(original===undefined)delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET=original;
  }
});

test("branding inputs reject executable URL-shaped slugs and email header separators", () => {
  assert.equal(slug("karachi-fleet"),"karachi-fleet");
  assert.equal(email("Support+Fleet@Example.com"),"support+fleet@example.com");
  for(const input of ["../reseller","host.example.com","javascript:alert"]) {
    assert.throws(()=>slug(input),{status:400});
  }
  assert.throws(()=>text("Brand\r\nBcc: fake@example.com",100),{status:400});
  assert.throws(()=>email("a?bcc=test@example.com"),{status:400});
});

test("reseller activation links are scoped and exposed only under the configured manual policy", () => {
  const keys=["NODE_ENV","PUBLIC_FRONTEND_URL","ALLOW_DEV_INVITATION_TOKEN","ALLOW_MANUAL_INVITATION_TOKEN"];
  const previous=keys.map(key=>process.env[key]);
  const fixture="a".repeat(64);
  try {
    Object.assign(process.env,{NODE_ENV:"production",PUBLIC_FRONTEND_URL:"https://sna.example.com",ALLOW_DEV_INVITATION_TOKEN:"true"});
    delete process.env.ALLOW_MANUAL_INVITATION_TOKEN;
    assert.deepEqual(manualInvitation(fixture,"karachi-fleet",true),{});
    process.env.ALLOW_MANUAL_INVITATION_TOKEN="true";
    const admin=manualInvitation(fixture,"karachi-fleet",true);
    const customer=manualInvitation(fixture,"karachi-fleet");
    assert.equal(admin.acceptancePath,"/r/karachi-fleet/activate-admin");
    assert.equal(customer.acceptancePath,"/r/karachi-fleet/accept-invitation");
    assert.equal(new URL(admin.activationLink).origin,"https://sna.example.com");
    assert.equal(new URL(admin.activationLink).hash,"#token="+fixture);
    process.env.PUBLIC_FRONTEND_URL="http://untrusted.example.com";
    assert.equal(manualInvitation(fixture,"karachi-fleet",true).activationLink,null);
  } finally {
    keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});
  }
});
