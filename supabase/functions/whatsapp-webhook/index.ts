import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const D360_WEBHOOK_SECRET = Deno.env.get("D360_WEBHOOK_SECRET") || "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type AnyJson = Record<string, any>;

function digits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function asDate(value: unknown): string {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

function messageBody(message: AnyJson): { body: string | null; mediaId: string | null } {
  const type = String(message.type || "text");
  if (type === "text") return { body: message.text?.body || null, mediaId: null };
  if (type === "button") return { body: message.button?.text || message.button?.payload || "[Botão]", mediaId: null };
  if (type === "interactive") {
    const reply = message.interactive?.button_reply || message.interactive?.list_reply || {};
    return { body: reply.title || reply.description || "[Resposta interativa]", mediaId: null };
  }
  if (type === "image") return { body: message.image?.caption || "[Imagem]", mediaId: message.image?.id || null };
  if (type === "video") return { body: message.video?.caption || "[Vídeo]", mediaId: message.video?.id || null };
  if (type === "audio") return { body: "[Áudio]", mediaId: message.audio?.id || null };
  if (type === "voice") return { body: "[Áudio]", mediaId: message.voice?.id || null };
  if (type === "document") {
    const name = message.document?.filename ? `: ${message.document.filename}` : "";
    return { body: message.document?.caption || `[Documento${name}]`, mediaId: message.document?.id || null };
  }
  if (type === "sticker") return { body: "[Figurinha]", mediaId: message.sticker?.id || null };
  if (type === "location") {
    const location = message.location || {};
    const label = location.name || location.address || [location.latitude, location.longitude].filter(Boolean).join(", ");
    return { body: label ? `[Localização] ${label}` : "[Localização]", mediaId: null };
  }
  if (type === "contacts") return { body: "[Contato compartilhado]", mediaId: null };
  if (type === "reaction") return { body: `[Reação] ${message.reaction?.emoji || ""}`.trim(), mediaId: null };
  if (type === "revoke") return { body: "[Mensagem apagada]", mediaId: null };
  if (type === "edit") return messageBody(message.edit?.message || message.edit || {});
  return { body: `[${type}]`, mediaId: null };
}

async function validSignature(raw: string, signature: string | null): Promise<boolean> {
  if (!META_APP_SECRET) return true;
  if (!signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = `sha256=${Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function authenticatedCrmUser(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const { data, error } = await admin.auth.getUser(token);
  return !error && Boolean(data.user);
}

async function validRequest(request: Request, raw: string): Promise<boolean> {
  const providerSecret = request.headers.get("x-crm-webhook-secret") || "";
  if (D360_WEBHOOK_SECRET && constantTimeEqual(providerSecret, D360_WEBHOOK_SECRET)) return true;
  if (request.headers.get("x-crm-history-import") === "1" && await authenticatedCrmUser(request)) return true;
  return validSignature(raw, request.headers.get("x-hub-signature-256"));
}

async function findRecordId(contactWaId: string): Promise<string | null> {
  const { data, error } = await admin.from("crm_records").select("id,phone");
  if (error) throw error;
  return data?.find((record) => digits(record.phone) === contactWaId)?.id || null;
}

async function saveMessage(input: {
  message: AnyJson;
  value: AnyJson;
  wabaId: string | null;
  direction: "inbound" | "outbound";
  contactWaId: string;
  contactName?: string | null;
  source?: string;
  status?: string | null;
}) {
  const { message, value, wabaId, direction } = input;
  const contactWaId = digits(input.contactWaId);
  if (!message?.id || !contactWaId) return;
  const content = messageBody(message);
  const recordId = await findRecordId(contactWaId);
  const payload = {
    meta_message_id: String(message.id),
    waba_id: wabaId,
    phone_number_id: value.metadata?.phone_number_id || null,
    record_id: recordId,
    contact_wa_id: contactWaId,
    contact_name: input.contactName || null,
    direction,
    message_type: String(message.type || "text"),
    body: content.body,
    media_id: content.mediaId,
    source: input.source || "cloud_api",
    status: input.status || (direction === "outbound" ? "sent" : "received"),
    message_timestamp: asDate(message.timestamp),
    updated_at: new Date().toISOString(),
    metadata: {
      context_message_id: message.context?.id || null,
      referral_source: message.referral?.source_type || null,
    },
  };
  const { error } = await admin.from("crm_whatsapp_messages").upsert(payload, { onConflict: "meta_message_id" });
  if (error) throw error;
}

async function processHistoryEvent(payload: AnyJson) {
  const data = payload?.data || payload;
  const wabaId = data?.id || null;
  const value = { metadata: data?.metadata || {} };
  for (const historyChunk of data?.history || []) {
    for (const thread of historyChunk?.threads || []) {
      const contactWaId = digits(thread?.id);
      if (!contactWaId) continue;
      for (const message of thread?.messages || []) {
        const direction = digits(message?.from) === contactWaId ? "inbound" : "outbound";
        await saveMessage({
          message,
          value,
          wabaId,
          direction,
          contactWaId,
          source: "history_sync",
          status: message?.history_context?.status || (direction === "outbound" ? "sent" : "received"),
        });
      }
    }
  }
}

async function processChange(change: AnyJson, wabaId: string | null) {
  const field = String(change?.field || "");
  const value = change?.value || {};
  const contacts = new Map<string, string>();
  for (const contact of value.contacts || []) {
    contacts.set(digits(contact.wa_id), contact.profile?.name || "");
  }

  if (field === "messages") {
    for (const message of value.messages || []) {
      const waId = digits(message.from);
      await saveMessage({ message, value, wabaId, direction: "inbound", contactWaId: waId, contactName: contacts.get(waId) });
    }
    for (const status of value.statuses || []) {
      if (!status?.id) continue;
      const { error } = await admin.from("crm_whatsapp_messages").update({
        status: status.status || null,
        status_timestamp: asDate(status.timestamp),
        updated_at: new Date().toISOString(),
      }).eq("meta_message_id", String(status.id));
      if (error) throw error;
    }
  }

  if (field === "smb_message_echoes") {
    const echoes = value.message_echoes || value.messages || value.echoes || [];
    for (const message of echoes) {
      const waId = digits(message.to || message.recipient_id || message.context?.from);
      await saveMessage({
        message,
        value,
        wabaId,
        direction: "outbound",
        contactWaId: waId,
        contactName: contacts.get(waId),
        source: "whatsapp_business_app",
      });
    }
  }
}

async function processPayload(payload: AnyJson | AnyJson[]) {
  if (Array.isArray(payload)) {
    for (const item of payload) await processPayload(item);
    return;
  }
  if (payload?.event === "history" || payload?.data?.history) {
    await processHistoryEvent(payload);
    return;
  }
  if (payload?.object === "whatsapp_business_account") {
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) await processChange(change, entry.id || null);
    }
  }
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("Verificação recusada", { status: 403 });
  }

  if (request.method !== "POST") return new Response("Método não permitido", { status: 405 });
  const raw = await request.text();
  if (!await validRequest(request, raw)) {
    return new Response("Assinatura inválida", { status: 401 });
  }

  try {
    const payload = JSON.parse(raw);
    await processPayload(payload);
  } catch (error) {
    console.error("[WhatsApp webhook]", error instanceof Error ? error.message : String(error));
    if (request.headers.get("x-crm-debug") === VERIFY_TOKEN) {
      const detail = error && typeof error === "object" ? error as AnyJson : {};
      return new Response(JSON.stringify({
        message: detail.message || String(error),
        code: detail.code || null,
        details: detail.details || null,
      }), { status: 500, headers: { "content-type": "application/json" } });
    }
    // A Meta repetirá a entrega em falhas temporárias.
    return new Response("Falha temporária", { status: 500 });
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
});
