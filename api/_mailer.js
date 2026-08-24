// Dependency-free minimal SMTP client over implicit TLS (port 465).
// Enough for single-recipient transactional mail with AUTH LOGIN.
const tls = require("tls");

function readReply(sock) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/).filter((l) => l.length > 0);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      // Terminal reply line: "NNN<space>text". Continuation lines are "NNN-text".
      if (/^\d{3} /.test(last)) {
        sock.removeListener("data", onData);
        resolve(buf);
      }
    };
    sock.on("data", onData);
    sock.once("error", reject);
    sock.setTimeout(20000, () => {
      sock.destroy();
      reject(new Error("smtp timeout"));
    });
  });
}

async function cmd(sock, line, expect) {
  sock.write(line + "\r\n");
  const reply = await readReply(sock);
  const code = parseInt(reply.slice(0, 3), 10);
  const okCodes = Array.isArray(expect) ? expect : [expect];
  if (expect && !okCodes.includes(code)) {
    throw new Error(`SMTP ${line.split(" ")[0]} -> ${code}: ${reply.trim().slice(0, 120)}`);
  }
  return reply;
}

/**
 * Send an email via SMTP (implicit TLS).
 * opts: {host, port, user, pass, from, to, subject, text, html}
 */
async function sendMail(opts) {
  const port = Number(opts.port || 465);
  const sock = port === 465
    ? tls.connect({ host: opts.host, port, servername: opts.host })
    : tls.connect({ host: opts.host, port }); // STARTTLS handled simply as TLS too
  await new Promise((res, rej) => {
    sock.once("secureConnect", res);
    sock.once("error", rej);
  });

  await readReply(sock); // banner 220

  await cmd(sock, `EHLO reviewreply.local`, 250);
  const auth = Buffer.from(`\u0000${opts.user}\u0000${opts.pass}`).toString("base64");
  try {
    await cmd(sock, `AUTH PLAIN ${auth}`, [235, 501]);
  } catch (e) {
    // fall back to AUTH LOGIN
    await cmd(sock, "AUTH LOGIN", 334);
    await cmd(sock, Buffer.from(opts.user).toString("base64"), 334);
    await cmd(sock, Buffer.from(opts.pass).toString("base64"), 235);
  }
  await cmd(sock, `MAIL FROM:<${opts.from}>`, 250);
  await cmd(sock, `RCPT TO:<${opts.to}>`, 250);
  await cmd(sock, "DATA", 354);

  const boundary = "rr-boundary-7f3a";
  const headers = [
    `From: ReviewReply <${opts.from}>`,
    `To: <${opts.to}>`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    "",
  ].join("\r\n");
  const body = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.html,
    "",
    `--${boundary}--`,
    ".",
  ].join("\r\n");

  sock.write(headers + body + "\r\n");
  const dataReply = await readReply(sock);
  if (parseInt(dataReply.slice(0, 3), 10) !== 250) {
    throw new Error(`SMTP DATA rejected: ${dataReply.trim().slice(0, 120)}`);
  }
  sock.write("QUIT\r\n");
  sock.end();
}

module.exports = { sendMail };
