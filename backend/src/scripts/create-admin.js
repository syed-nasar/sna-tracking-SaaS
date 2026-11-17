
require("dotenv").config();

const readline = require("readline");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const output = process.stdout;

    const rl = readline.createInterface({
      input: process.stdin,
      output,
      terminal: true,
    });

    if (hidden) {
      const originalWrite = output.write.bind(output);
      let muted = false;

      output.write = function (chunk, ...args) {
        if (muted) return true;
        return originalWrite(chunk, ...args);
      };

      rl.question(question, (answer) => {
        muted = false;
        output.write = originalWrite;
        rl.close();
        console.log();
        resolve(answer);
      });

      muted = true;
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  console.log("\nSNA Fleet - Create Tenant Administrator\n");

  const tenantSlug = "sna-fleet";

  const fullName = await ask("Full name: ");
  const email = (await ask("Email: ")).toLowerCase();

  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid full name and email are required.");
  }

  const password = await ask("Password (hidden): ", true);
  const confirmation = await ask("Confirm password (hidden): ", true);

  if (password !== confirmation) {
    throw new Error("Passwords do not match.");
  }

  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password must be 12–72 UTF-8 bytes.");
  }

  const tenantResult = await pool.query(
    "SELECT id FROM tenants WHERE slug = $1 AND status = 'active'",
    [tenantSlug]
  );

  if (tenantResult.rowCount !== 1) {
    throw new Error("Active SNA Fleet tenant not found.");
  }

  const tenantId = tenantResult.rows[0].id;
  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query(
    `INSERT INTO users (
       tenant_id, full_name, email, password_hash, role
     )
     VALUES ($1, $2, $3, $4, 'tenant_admin')
     ON CONFLICT (tenant_id, email) DO NOTHING
     RETURNING id, full_name, email, role`,
    [tenantId, fullName, email, passwordHash]
  );

  if (result.rowCount === 0) {
    console.log("An account with this email already exists for this tenant.");
    return;
  }

  console.log("\nAdministrator created successfully:");
  console.log(result.rows[0]);
}

main()
  .catch((error) => {
    console.error("Setup failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
