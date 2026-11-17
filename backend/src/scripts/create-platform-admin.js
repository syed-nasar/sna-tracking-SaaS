
require("dotenv").config();

const readline = require("readline");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    if (!hidden) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    const originalWrite = process.stdout.write;
    let muted = false;

    process.stdout.write = function (chunk, ...args) {
      if (muted) return true;
      return originalWrite.call(process.stdout, chunk, ...args);
    };

    rl.question(question, (answer) => {
      muted = false;
      process.stdout.write = originalWrite;
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });

    muted = true;
  });
}

async function main() {
  console.log("\n=================================");
  console.log("SNA Fleet - Platform Super Admin");
  console.log("=================================\n");

  const fullName = await ask("Full name: ");
  const email = (await ask("Email: ")).toLowerCase();

  if (
    !fullName ||
    fullName.length > 150 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 255
  ) {
    throw new Error("Valid name and email are required.");
  }

  const password = await ask("Password (hidden): ", true);
  const confirmation = await ask(
    "Confirm password (hidden): ",
    true
  );

  if (password !== confirmation) {
    throw new Error("Passwords do not match.");
  }

  if (
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new Error(
      "Password must be at least 12 characters and at most 72 UTF-8 bytes."
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query(
    `INSERT INTO platform_admins (
       full_name,
       email,
       password_hash,
       role
     )
     VALUES ($1, $2, $3, 'super_admin')
     ON CONFLICT DO NOTHING
     RETURNING id, full_name, email, role, is_active`,
    [fullName, email, passwordHash]
  );

  if (result.rowCount === 0) {
    console.log(
      "\nA platform administrator with this email already exists."
    );
    return;
  }

  console.log("\nPlatform Super Admin created successfully.");
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
