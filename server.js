import express from "express";

const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "qrv-api", mode: "NORMAL" });
});

app.get("/verify/:qrvid", (req, res) => {
  const { qrvid } = req.params;

  // placeholder until registry integration
  res.json({
    qrvid,
    verificationState: "NOT_FOUND",
    status: "unknown",
    message: "Verification engine not yet connected",
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`QR-V API running on port ${PORT}`);
});
