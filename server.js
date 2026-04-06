app.get("/verify/:qrvid", async (req, res) => {
  const { qrvid } = req.params;

  try {
    // ===== TEMP: mock record (for first activation) =====
    if (qrvid === "QRV-TEST-001") {
      return res.json({
        status: "VERIFIED",
        qrvid,
        issuer: "QR-V Test Issuer",
        record_type: "certificate",
        verification_state: "active",
        issued_at: new Date().toISOString(),
        source: "qrv-api"
      });
    }

    // ===== DEFAULT: not found =====
    return res.status(404).json({
      status: "NOT_FOUND",
      qrvid,
      source: "qrv-api"
    });

  } catch (err) {
    res.status(500).json({
      status: "ERROR",
      error: "verification_error",
      message: "Failed to verify QR-V identifier",
      details: err.message
    });
  }
});
