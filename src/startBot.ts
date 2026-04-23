import * as baileys from "baileys";
import hapi from "@hapi/boom";
import env from "./env.js";
import path from "node:path";
import pino from "pino";
import os from "node:os";
import process from "node:process";

export default async function () {
  const auth = await baileys.useMultiFileAuthState(path.resolve(env.AUTH_DIR));
  const wa = await baileys.fetchLatestWaWebVersion();
  const sock = baileys.makeWASocket({
    auth: auth.state,
    version: wa.version,
    browser: baileys.Browsers.ubuntu("Chrome"),
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
    shouldIgnoreJid(jid) {
      return jid === "status@broadcast";
    },
  });
  sock.ev.on("creds.update", auth.saveCreds);
  sock.ev.on("connection.update", async function (update) {
    if (update.qr !== undefined) {
      const otp = await sock.requestPairingCode(env.BOT_PN);
      console.log(`[${env.BOT_PN}] otp: ${otp}`);
    }
    if (update.connection === "open") {
      console.log(`[${env.BOT_PN}] opened`);
      console.dir(sock.user);
    } else if (update.connection === "close") {
      console.log(`[${env.BOT_PN}] closed`);
      console.dir(update.lastDisconnect);
      const code = new hapi.Boom(update.lastDisconnect?.error).output.statusCode;
      if (code !== baileys.DisconnectReason.loggedOut) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    }
  });
  sock.ev.on("messages.upsert", async function (upsert) {
    if (upsert.type !== "notify") {
      return;
    }
    for (const msg of upsert.messages) {
      if (typeof msg.key.remoteJid !== "string") {
        continue;
      }
      const chat = msg.key.remoteJid;
      const sender = msg.key.fromMe
        ? baileys.jidNormalizedUser(sock.user!.id)
        : (msg.key.participant ?? msg.key.remoteJid);
      const body =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.viewOnceMessage?.message?.imageMessage?.caption ??
        msg.message?.viewOnceMessageV2?.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ??
        msg.message?.viewOnceMessage?.message?.videoMessage?.caption ??
        msg.message?.viewOnceMessageV2?.message?.videoMessage?.caption;
      if (body?.startsWith(env.BOT_PREFIX) !== true) {
        continue;
      }
      const [cmd, ...args] = body.substring(env.BOT_PREFIX.length).split(/\s+/);
      switch (cmd?.toLowerCase()) {
        case "ping": {
          await sock.sendMessage(chat, { text: "Pong!" }, { quoted: msg });
          break;
        }
        case "echo": {
          const text = args.join(" ");
          await sock.sendMessage(chat, { text });
          break;
        }
        case "info": {
          const text = `
- \`Info\`
        case
Bot phone number: \`${sock.user?.id}\`
Bot name: \`${sock.user?.name}\`

Chat Id: \`${chat}\`
Sender Id: \`${sender}\`

Runtime: \`NodeJS v${process.version}\`
Uptime: \`${process.uptime().toFixed(2)}s\`
RAM total: \`${os.totalmem() / 1024 / 1024 / 1024} gb\`
RAM usage: \`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} mb\`
CPU usage: \`${os
            .loadavg()
            .map(function (v) {
              return v.toFixed(2);
            })
            .join(", ")}\`

CWD: \`${process.cwd()}\`
          `.trim();
          await sock.sendMessage(chat, { text, mentions: [sender] }, { quoted: msg });
          break;
        }
        default: {
          await sock.sendMessage(chat, { text: `Unknown command: \`${cmd}\`` }, { quoted: msg });
        }
      }
    }
  });
}
