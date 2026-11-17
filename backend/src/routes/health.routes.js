const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    service: "SNA Fleet Management API",
    status: "running",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;