// 1x1 tracking pixel: logs lead opens for outreach telemetry.
module.exports = (req, res) => {
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const id = (req.query && req.query.l) || "unknown";
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  console.log(JSON.stringify({ pixel: id, ip, ua: (req.headers["user-agent"] || "").slice(0, 80), t: Date.now() }));
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).end(gif);
};
