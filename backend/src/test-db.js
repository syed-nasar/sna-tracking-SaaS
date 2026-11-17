
require("dotenv").config();

const pool = require("./config/db");

async function testDatabaseConnection() {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS username,
        version() AS version,
        NOW() AS server_time
    `);

    console.log("=================================");
    console.log("SNA Fleet - Database Connection");
    console.log("=================================");
    console.log("Status: CONNECTED");
    console.log("Database:", result.rows[0].database);
    console.log("User:", result.rows[0].username);
    console.log("Server Time:", result.rows[0].server_time);
    console.log("=================================");
  } catch (error) {
    console.error("Database connection FAILED");
    console.error("Error:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testDatabaseConnection();
