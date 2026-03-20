import express from "express";

const app = express();
app.use(express.json());

/**
 * Health Check
 */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "qrv-api",
    status: "running",
    timestamp: new Date().toISOString()
  });
});

/**
 * Verify QR-V Record
 */
app.get("/verify/:qrvid", async (req, res) => {
  const { qrvid } = req.params;

  try {
    // Placeholder until qrv-node integration
    const result = {
      qrvid,
      verificationState: "NOT_FOUND",
      status: "unknown",
      source: "qrv-api",
      message: "Verification engine not yet connected",
      timestamp: new Date().toISOString()
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: "verification_error",
      message: "Failed to verify QR-V identifier",
      details: err.message
    });
  }
});

/**
 * Server Startup
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`QR-V API running on port ${PORT}`);
});
