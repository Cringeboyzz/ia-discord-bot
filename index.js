import "dotenv/config";
import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import crypto from "node:crypto";

const { DISCORD_TOKEN, IA_GUILD_ID, WEBHOOK_URL, WEBHOOK_SECRET, BATCH_INTERVAL_MS = "15000" } = process.env;
if (!DISCORD_TOKEN || !IA_GUILD_ID || !WEBHOOK_URL || !WEBHOOK_SECRET) {
  console.error("Missing env vars"); process.exit(1);
}

const queue = [];
async function flush() {
  if (!queue.length) return;
  const events = queue.splice(0, queue.length);
  const body = JSON.stringify({ events });
  const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  try {
    const r = await fetch(WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json", "x-ia-signature": sig }, body });
    if (!r.ok) { console.error("Webhook", r.status, await r.text()); if (r.status >= 500) queue.unshift(...events); }
    else console.log("Flushed", events.length);
  } catch (e) { console.error(e); queue.unshift(...events); }
}
setInterval(flush, Number(BATCH_INTERVAL_MS));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildScheduledEvent],
});

client.once(Events.ClientReady, c => console.log("IA bot ready as", c.user.tag));

client.on(Events.MessageCreate, msg => {
  if (!msg.guild || msg.guild.id !== IA_GUILD_ID || msg.author.bot) return;
  queue.push({ kind: "message", discord_id: msg.author.id, discord_ref: msg.id });
});

client.on(Events.GuildScheduledEventUpdate, (oldE, newE) => {
  if (!newE || newE.guildId !== IA_GUILD_ID) return;
  if (newE.status === 2 && oldE?.status !== 2 && newE.creatorId)
    queue.push({ kind: "event_hosted", discord_id: newE.creatorId, discord_ref: "host:" + newE.id });
});

client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
  if (newS.guild.id !== IA_GUILD_ID || !newS.channelId || oldS.channelId === newS.channelId) return;
  const m = newS.member; if (!m || m.user.bot) return;
  try {
    const events = await newS.guild.scheduledEvents.fetch();
    const active = events.find(e => e.status === 2 && e.channelId === newS.channelId);
    if (active) queue.push({ kind: "event_attended", discord_id: m.id, discord_ref: "att:" + active.id + ":" + m.id });
  } catch (e) { console.error(e); }
});

client.login(DISCORD_TOKEN);
