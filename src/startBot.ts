import * as baileys from "@whiskeysockets/baileys";
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
      const code = new hapi.Boom(update.lastDisconnect?.error).output.statusCode;
      if (code !== baileys.DisconnectReason.loggedOut) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    }
  });

  sock.ev.on("messages.upsert", async function (upsert) {
    if (upsert.type !== "notify") return;

    for (const msg of upsert.messages) {
      if (typeof msg.key.remoteJid !== "string") continue;

      const chat = msg.key.remoteJid;
      
      // Normalización de IDs para evitar el error de ":device" o menciones mal formateadas
      const botJid = baileys.jidNormalizedUser(sock.user?.id || "");
      const sender = baileys.jidNormalizedUser(msg.key.participant ?? msg.key.remoteJid ?? "");

      const body =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.viewOnceMessage?.message?.imageMessage?.caption ??
        msg.message?.viewOnceMessageV2?.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ??
        msg.message?.viewOnceMessage?.message?.videoMessage?.caption ??
        msg.message?.viewOnceMessageV2?.message?.videoMessage?.caption;

      if (body?.startsWith(env.BOT_PREFIX) !== true) continue;

      const [cmd, ...args] = body.substring(env.BOT_PREFIX.length).trim().split(/\s+/);

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

Bot phone number: \`${sock.user?.id}\`
Bot name: \`${sock.user?.name}\`

Chat Id: \`${chat}\`
Sender Id: \`${sender}\`

Runtime: \`NodeJS v${process.version}\`
Uptime: \`${process.uptime().toFixed(2)}s\`
RAM total: \`${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} gb\`
RAM usage: \`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} mb\`
CPU usage: \`${os.loadavg().map(v => v.toFixed(2)).join(", ")}\`

CWD: \`${process.cwd()}\`
          `.trim();
          await sock.sendMessage(chat, { text, mentions: [sender] }, { quoted: msg });
          break;
        }

        case "kick": {
          if (!chat.endsWith("@g.us")) {
            await sock.sendMessage(chat, { text: "Este comando solo funciona en grupos" }, { quoted: msg });
            break;
          }

          const groupMetadata = await sock.groupMetadata(chat);
          const participants = groupMetadata.participants;

          // Verificación de admins con JIDs normalizados
          const botParticipant = participants.find(p => baileys.jidNormalizedUser(p.id) === botJid);
          const senderParticipant = participants.find(p => baileys.jidNormalizedUser(p.id) === sender);

          if (!botParticipant?.admin) {
            await sock.sendMessage(chat, { text: "Necesito ser admin para expulsar" }, { quoted: msg });
            break;
          }
          if (!senderParticipant?.admin) {
            await sock.sendMessage(chat, { text: "Solo admins pueden usar este comando" }, { quoted: msg });
            break;
          }

          // Obtener JIDs de menciones o de respuesta (quoted)
          let mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
          if (quoted) mentioned.push(quoted);

          // Limpiar la lista de usuarios a expulsar
          mentioned = [...new Set(mentioned)].map(v => baileys.jidNormalizedUser(v));

          if (mentioned.length === 0) {
            await sock.sendMessage(chat, { text: `Uso: ${env.BOT_PREFIX}kick @usuario o responde a su mensaje` }, { quoted: msg });
            break;
          }

          const razon = args.filter(a => !a.startsWith('@')).join(" ") || "Sin razón especificada";

          for (const userJid of mentioned) {
            if (userJid === botJid) continue;

            const target = participants.find(p => baileys.jidNormalizedUser(p.id) === userJid);
            if (target?.admin) {
              await sock.sendMessage(chat, {
                text: `No puedo expulsar a @${userJid.split("@")[0]} porque es admin`,
                mentions: [userJid]
              }, { quoted: msg });
              continue;
            }

            try {
              await sock.groupParticipantsUpdate(chat, [userJid], "remove");
              await sock.sendMessage(chat, {
                text: `@${userJid.split("@")[0]} expulsado por @${sender.split("@")[0]}\nRazón: ${razon}`,
                mentions: [userJid, sender]
              }, { quoted: msg });
            } catch (e) {
              console.error(e);
            }

            await new Promise(r => setTimeout(r, 2000));
          }
          break;
        }

        default: {
          await sock.sendMessage(chat, { text: `Unknown command: \`${cmd}\`` }, { quoted: msg });
        }
      }
    }
  });
      }
          
