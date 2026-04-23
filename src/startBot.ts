import * as baileys from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import env from "./env.js";
import path from "node:path";
import pino from "pino";
import os from "node:os";
import process from "node:process";

export default async function startBot(): Promise<void> {
  const auth = await baileys.useMultiFileAuthState(path.resolve(env.AUTH_DIR));
  const wa = await baileys.fetchLatestWaWebVersion();
  
  const sock = baileys.makeWASocket({
    auth: auth.state,
    version: wa.version,
    browser: baileys.Browsers.ubuntu("Chrome"),
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
    shouldIgnoreJid(jid: string) {
      return jid === "status@broadcast";
    },
  });

  sock.ev.on("creds.update", auth.saveCreds);

  sock.ev.on("connection.update", async (update: Partial<baileys.ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr !== undefined) {
      const otp = await sock.requestPairingCode(env.BOT_PN);
      console.log(`[${env.BOT_PN}] otp: ${otp}`);
    }

    if (connection === "open") {
      console.log(`[${env.BOT_PN}] abierto`);
    } else if (connection === "close") {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode || (lastDisconnect?.error as any)?.code;
      if (code !== baileys.DisconnectReason.loggedOut) {
        startBot(); 
      } else {
        process.exit(1);
      }
    }
  });

  sock.ev.on("messages.upsert", async (upsert: { messages: baileys.proto.IWebMessageInfo[], type: baileys.MessageUpsertType }) => {
    if (upsert.type !== "notify") return;

    for (const msg of upsert.messages) {
      if (!msg.message || typeof msg.key.remoteJid !== "string") continue;

      const chat = msg.key.remoteJid;
      const botJid = baileys.jidNormalizedUser(sock.user?.id || "");
      const sender = baileys.jidNormalizedUser(msg.key.participant ?? msg.key.remoteJid ?? "");

      const body =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        msg.message.imageMessage?.caption ??
        msg.message.videoMessage?.caption;

      if (!body || !body.startsWith(env.BOT_PREFIX)) continue;

      const [cmd, ...args] = body.substring(env.BOT_PREFIX.length).trim().split(/\s+/);
      if (!cmd) continue;

      switch (cmd.toLowerCase()) {
        case "ping": {
          await sock.sendMessage(chat, { text: "Pong! 🏓" }, { quoted: msg });
          break;
        }

        case "echo": {
          const text = args.join(" ");
          if (!text) {
            await sock.sendMessage(chat, { text: "Escribe algo después del comando." });
          } else {
            await sock.sendMessage(chat, { text });
          }
          break;
        }

        case "info": {
          const load = os.loadavg();
          const text = `
- \`Info del Sistema\`

Bot phone: \`${sock.user?.id?.split(':')[0]}\`
Bot name: \`${sock.user?.name ?? "WhatsApp Bot"}\`

Chat Id: \`${chat}\`
Sender Id: \`${sender.split('@')[0]}\`

Runtime: \`NodeJS v${process.version}\`
Uptime: \`${process.uptime().toFixed(2)}s\`
RAM Usage: \`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\`
CPU Load: \`${load[0]?.toFixed(2) ?? "0.00"}\`

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

          const botParticipant = participants.find((p: baileys.GroupParticipant) => baileys.jidNormalizedUser(p.id) === botJid);
          const senderParticipant = participants.find((p: baileys.GroupParticipant) => baileys.jidNormalizedUser(p.id) === sender);

          if (!botParticipant?.admin) {
            await sock.sendMessage(chat, { text: "El bot necesita ser admin para expulsar." }, { quoted: msg });
            break;
          }
          if (!senderParticipant?.admin) {
            await sock.sendMessage(chat, { text: "Solo los administradores pueden usar este comando." }, { quoted: msg });
            break;
          }

          let mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          const quoted = msg.message.extendedTextMessage?.contextInfo?.participant;
          if (quoted) mentioned.push(quoted);

          const uniqueMentioned = [...new Set(mentioned)].map(v => baileys.jidNormalizedUser(v));

          if (uniqueMentioned.length === 0) {
            await sock.sendMessage(chat, { text: "Menciona a alguien o responde a su mensaje." }, { quoted: msg });
            break;
          }

          const razon = args.filter((a: string) => !a.startsWith('@')).join(" ") || "Sin razón especificada";

          for (const userJid of uniqueMentioned) {
            if (userJid === botJid) continue;
            
            const target = participants.find((p: baileys.GroupParticipant) => baileys.jidNormalizedUser(p.id) === userJid);
            
            if (target?.admin) {
              await sock.sendMessage(chat, { text: `No puedo expulsar a @${userJid.split('@')[0]} porque es admin.`, mentions: [userJid] });
              continue;
            }

            try {
              await sock.groupParticipantsUpdate(chat, [userJid], "remove");
              await sock.sendMessage(chat, { text: `✅ @${userJid.split('@')[0]} expulsado.\nMotivo: ${razon}`, mentions: [userJid] });
            } catch (e) {
              console.error(e);
            }
          }
          break;
        }

        default: {
          await sock.sendMessage(chat, { text: `Comando desconocido: \`${cmd}\`` }, { quoted: msg });
        }
      }
    }
  });
}
