import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhone } from "../_shared/phone-identity.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_TOKEN = Deno.env.get("WEBHOOK_TOKEN")!;
const DEFAULT_WORKSPACE = "00000000-0000-4000-8000-000000000001";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const JSON_HEADERS = { "content-type": "application/json" };

type JsonMap = Record<string, any>;

type ExtractedLead = {
  rawName: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  city: string;
  rooms: string;
  estimate: number | null;
  eventName: string;
  conversionId: string | null;
  conversionAt: string | null;
  legacyConversionKey: string;
  leadSource: string;
  leadId: string;
};

type ExistingRecord = {
  id: string;
  workspace_id: string;
  pipeline: string;
  stage: string;
  stage_entered_at: string;
  source: string | null;
  rooms: string;
  city: string;
  phone: string;
  email: string | null;
  estimate: number | null;
  notes: string | null;
  first_name: string | null;
  last_name: string | null;
  rd_fingerprint: string | null;
};

type ProcessResult = {
  status: "inserted" | "duplicate";
  recordId: string;
  fingerprint: string;
};

function jsonResponse(body: JsonMap, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function asObject(value: any): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asText(value: any, fallback: string | null = null): string | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const flattened = value.map((item) => asText(item, "")).filter(Boolean).join(", ").trim();
    return flattened || fallback;
  }
  if (typeof value === "object") {
    const direct =
      value.value ?? value.label ?? value.name ?? value.email ?? value.phone ??
      value.telefone ?? value.cidade ?? null;
    if (direct !== null && direct !== undefined) return asText(direct, fallback);
  }
  return fallback;
}

function firstText(values: any[], fallback: string | null = null): string | null {
  for (const value of values) {
    const text = asText(value, null);
    if (text) return text;
  }
  return fallback;
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function objectValue(object: any, names: string[]): any {
  const source = asObject(object);
  const entries = new Map(
    Object.entries(source).map(([key, value]) => [normalizeKey(key), value]),
  );
  for (const name of names) {
    const value = entries.get(normalizeKey(name));
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function parseBudgetToNumber(value: any): number | null {
  const text = asText(value, null);
  if (!text) return null;

  let cleaned = text.toLowerCase().replace(/[^\d,.\-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function isBadText(value: any): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return !text || text === "não informado" || text === "lead online";
}

function normalizeRooms(value: any): string {
  const text = String(value ?? "").trim();
  if (!text) return "Não informado";
  if (new Set(["g", "o", "eu", "ui", ".", "-", "_"]).has(text.toLowerCase())) {
    return "Não informado";
  }
  if (/^\d{1,2}$/.test(text)) return "Não informado";
  return text;
}

function safeIso(value: any): string | null {
  const text = asText(value, null);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function splitName(rawName: string): { firstName: string; lastName: string } {
  const parts = rawName.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "Lead",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "Online",
  };
}

function extractLeads(body: JsonMap): JsonMap[] {
  const candidates = body?.leads ?? body?.payload?.leads;
  if (Array.isArray(candidates)) return candidates.filter((lead) => lead && typeof lead === "object");
  const single = body?.lead ?? body?.contact;
  return single && typeof single === "object" ? [single] : [];
}

function extractLead(lead: JsonMap, body: JsonMap): ExtractedLead {
  const firstConversion = asObject(lead.first_conversion);
  const lastConversion = asObject(lead.last_conversion);
  const firstContent = asObject(firstConversion.content);
  const lastContent = asObject(lastConversion.content);
  const firstOrigin = asObject(firstConversion.conversion_origin);
  const lastOrigin = asObject(lastConversion.conversion_origin);
  const customFields = asObject(lead.custom_fields);

  const fromConversions = (names: string[]) => firstText([
    objectValue(lastContent, names),
    objectValue(firstContent, names),
  ]);

  const rawName = firstText([
    fromConversions(["nome", "name", "full name"]),
    lead.name,
    [lead.first_name, lead.last_name].filter(Boolean).join(" "),
  ], "Lead Online")!;
  const { firstName, lastName } = splitName(rawName);

  const rawPhone = firstText([
    fromConversions(["telefone", "phone lead", "phone", "celular", "mobile phone"]),
    lead.personal_phone,
    lead.mobile_phone,
    lead.phone,
  ], "Não informado")!;
  const phoneIdentity = normalizePhone(rawPhone);
  const phone = phoneIdentity.is_valid ? phoneIdentity.normalized_e164! : rawPhone;

  const email = firstText([
    fromConversions(["email lead", "email", "e mail"]),
    lead.email,
  ]);

  const city = firstText([
    fromConversions(["cidade", "city"]),
    objectValue(customFields, ["cidade", "city"]),
    lead.city,
  ], "Não informado")!;

  const rooms = normalizeRooms(firstText([
    fromConversions(["campo 1", "ambientes", "ambiente", "ambientes de interesse"]),
    objectValue(customFields, ["campo 1", "Ambientes", "ambientes", "ambiente", "ambientes de interesse"]),
  ], "Não informado"));

  const estimate = parseBudgetToNumber(firstText([
    fromConversions(["budget", "orcamento", "orçamento"]),
    objectValue(customFields, ["budget", "orcamento", "orçamento"]),
  ]));

  const eventName = firstText([
    body.event_type,
    body.event,
    body.conversion_identifier,
    body.conversion,
    body.identifier,
    body.event_name,
    fromConversions(["conversion identifier", "identificador da conversao", "identificador da conversão"]),
  ], "rd")!;

  const conversionId = firstText([
    fromConversions(["facebook lead id", "conversion id", "id da conversao", "id da conversão"]),
    body.conversion_id,
    body.id_da_conversao,
    body.id_conversion,
  ]);

  const conversionAtRaw = firstText([
    lastConversion.created_at,
    firstConversion.created_at,
    body.conversion_at,
    lead.created_at,
  ]);

  const legacyConversionKey = String(firstText([
    firstConversion.created_at,
    lastConversion.created_at,
    lead.created_at,
  ], "") || "").trim();

  const leadSource = firstText([
    objectValue(lastOrigin, ["source"]),
    lastConversion.source,
    objectValue(firstOrigin, ["source"]),
    firstConversion.source,
    body.source,
    body.lead_source,
    body.origem,
    fromConversions(["traffic source", "source", "origem"]),
  ], "Lead Online")!;

  return {
    rawName,
    firstName,
    lastName,
    phone,
    email,
    city,
    rooms,
    estimate,
    eventName,
    conversionId,
    conversionAt: safeIso(conversionAtRaw),
    legacyConversionKey,
    leadSource,
    leadId: String(lead.id || lead.uuid || "").trim(),
  };
}

async function buildFingerprints(
  extracted: ExtractedLead,
  lead: JsonMap,
): Promise<{ fingerprint: string; legacyFingerprint: string }> {
  const normalizedPhone = extracted.phone.replace(/\D/g, "");
  const normalizedEmail = String(extracted.email || "").trim().toLowerCase();
  const normalizedEvent = normalizeKey(extracted.eventName);

  const stableMaterial = extracted.conversionId
    ? `conversion:${extracted.conversionId.trim().toLowerCase()}`
    : extracted.leadId
    ? `lead:${extracted.leadId.toLowerCase()}`
    : `fallback:${normalizedPhone}|${normalizedEmail}|${normalizedEvent}|${extracted.conversionAt || stableStringify(lead)}`;

  const legacyMaterial =
    `${extracted.leadId}|${extracted.legacyConversionKey}|${normalizedPhone}|${normalizedEmail}`;

  const [fingerprint, legacyFingerprint] = await Promise.all([
    sha256Hex(stableMaterial),
    sha256Hex(legacyMaterial),
  ]);
  return { fingerprint, legacyFingerprint };
}

const EXISTING_COLUMNS = [
  "id", "workspace_id", "pipeline", "stage", "stage_entered_at", "source", "rooms", "city", "phone",
  "email", "estimate", "notes", "first_name", "last_name", "rd_fingerprint",
].join(",");

async function findExisting(
  conversionId: string | null,
  fingerprints: string[],
): Promise<ExistingRecord | null> {
  if (conversionId) {
    const { data, error } = await supabase
      .from("crm_records")
      .select(EXISTING_COLUMNS)
      .eq("workspace_id", DEFAULT_WORKSPACE)
      .eq("rd_conversion_id", conversionId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`lookup_conversion:${error.code || "unknown"}`);
    if (data) return data as ExistingRecord;
  }

  const uniqueFingerprints = [...new Set(fingerprints.filter(Boolean))];
  const { data, error } = await supabase
    .from("crm_records")
    .select(EXISTING_COLUMNS)
    .eq("workspace_id", DEFAULT_WORKSPACE)
    .in("rd_fingerprint", uniqueFingerprints)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`lookup_fingerprint:${error.code || "unknown"}`);
  return (data as ExistingRecord | null) || null;
}

async function findExistingByPhone(phone: string): Promise<ExistingRecord | null> {
  const identity=normalizePhone(phone);if(!identity.is_valid)return null;
  const {data,error}=await supabase.from("crm_records").select(EXISTING_COLUMNS).eq("workspace_id",DEFAULT_WORKSPACE);
  if(error)throw new Error(`lookup_phone:${error.code||"unknown"}`);
  const matches=(data||[]).filter(record=>normalizePhone(record.phone).normalized_e164===identity.normalized_e164);
  return matches.length===1?matches[0] as ExistingRecord:null;
}

function duplicatePatch(
  existing: ExistingRecord,
  extracted: ExtractedLead,
  body: JsonMap,
): JsonMap {
  const patch: JsonMap = {
    rd_payload: body,
    rd_event_name: extracted.eventName,
    rd_conversion_id: extracted.conversionId,
    rd_conversion_at: extracted.conversionAt,
    rd_source: extracted.leadSource,
  };

  const existingName = [existing.first_name, existing.last_name].filter(Boolean).join(" ");
  if (isBadText(existingName) && !isBadText(extracted.rawName)) {
    patch.first_name = extracted.firstName;
    patch.last_name = extracted.lastName;
  }
  if (isBadText(existing.phone) && !isBadText(extracted.phone)) patch.phone = extracted.phone;
  if (isBadText(existing.city) && !isBadText(extracted.city)) patch.city = extracted.city;
  if (isBadText(existing.rooms) && !isBadText(extracted.rooms)) patch.rooms = extracted.rooms;
  if (!existing.email && extracted.email) patch.email = extracted.email;
  if (existing.estimate === null && extracted.estimate !== null) patch.estimate = extracted.estimate;

  return patch;
}

async function processLead(lead: JsonMap, body: JsonMap): Promise<ProcessResult> {
  const extracted = extractLead(lead, body);
  const { fingerprint, legacyFingerprint } = await buildFingerprints(extracted, lead);
  const existing = await findExisting(extracted.conversionId, [fingerprint, legacyFingerprint]) || await findExistingByPhone(extracted.phone);

  if (existing) {
    const { error } = await supabase
      .from("crm_records")
      .update(duplicatePatch(existing, extracted, body))
      .eq("id", existing.id);
    if (error) throw new Error(`duplicate_update:${error.code || "unknown"}`);
    return { status: "duplicate", recordId: existing.id, fingerprint };
  }

  const payload = {
    workspace_id: DEFAULT_WORKSPACE,
    pipeline: "lead",
    stage: "Novo",
    stage_entered_at: extracted.conversionAt || new Date().toISOString(),
    source: "Lead Online",
    rooms: extracted.rooms,
    city: extracted.city,
    phone: extracted.phone,
    email: extracted.email,
    estimate: extracted.estimate,
    notes:
      `Evento RD: ${extracted.eventName}` +
      `${extracted.conversionId ? ` | Conv ID: ${extracted.conversionId}` : ""}` +
      `${extracted.leadSource ? ` | Origem: ${extracted.leadSource}` : ""}`,
    lost_reason: null,
    owner_id: null,
    first_name: extracted.firstName,
    last_name: extracted.lastName,
    rd_fingerprint: fingerprint,
    rd_payload: body,
    rd_event_name: extracted.eventName,
    rd_conversion_id: extracted.conversionId,
    rd_conversion_at: extracted.conversionAt,
    rd_source: extracted.leadSource,
  };

  const { data, error } = await supabase
    .from("crm_records")
    .insert(payload)
    .select("id")
    .single();

  if (error?.code === "23505") {
    const winner = await findExisting(extracted.conversionId, [fingerprint, legacyFingerprint]);
    if (winner) return { status: "duplicate", recordId: winner.id, fingerprint };
  }
  if (error) throw new Error(`record_insert:${error.code || "unknown"}`);
  return { status: "inserted", recordId: data.id, fingerprint };
}

function safeHeaders(req: Request): JsonMap {
  return {
    "content-type": req.headers.get("content-type"),
    "user-agent": req.headers.get("user-agent"),
  };
}

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

async function writeDebug(entry: {
  requestId: string;
  req: Request;
  rawBody: string | null;
  parsedBody: JsonMap | null;
  extracted: JsonMap;
  status: string;
  error?: string | null;
}) {
  const { error } = await supabase.from("crm_webhook_debug").insert({
    headers: safeHeaders(entry.req),
    raw_body: entry.rawBody,
    parsed_body: entry.parsedBody,
    extracted: { request_id: entry.requestId, ...entry.extracted },
    status: entry.status,
    error: entry.error || null,
  });
  if (error) {
    console.warn("[RD] debug_write_failed", { requestId: entry.requestId, code: error.code });
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const url = new URL(req.url);
  const token = req.headers.get("x-webhook-token") || url.searchParams.get("token");

  if (!token || token !== WEBHOOK_TOKEN) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  if (req.method === "GET") return jsonResponse({ ok: true, mode: "verify" });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  let rawBody: string | null = null;
  let body: JsonMap;

  try {
    rawBody = await req.text();
    body = JSON.parse(rawBody);
  } catch {
    await writeDebug({
      requestId,
      req,
      rawBody,
      parsedBody: null,
      extracted: {},
      status: "bad_json",
      error: "invalid_json",
    });
    return jsonResponse({ ok: false, error: "invalid_json", request_id: requestId }, 400);
  }

  const leads = extractLeads(body);
  if (!leads.length) {
    await writeDebug({
      requestId,
      req,
      rawBody,
      parsedBody: body,
      extracted: { lead_count: 0 },
      status: "rejected",
      error: "lead_not_found",
    });
    return jsonResponse({ ok: false, error: "lead_not_found", request_id: requestId }, 400);
  }

  try {
    const results: ProcessResult[] = [];
    for (const lead of leads) results.push(await processLead(lead, body));

    const inserted = results.filter((result) => result.status === "inserted").length;
    const duplicates = results.filter((result) => result.status === "duplicate").length;
    const status = inserted && duplicates ? "mixed" : inserted ? "inserted" : "duplicate";

    await writeDebug({
      requestId,
      req,
      rawBody,
      parsedBody: body,
      extracted: {
        lead_count: leads.length,
        inserted,
        duplicates,
        records: results.map((result) => ({
          id: result.recordId,
          status: result.status,
          fingerprint_prefix: result.fingerprint.slice(0, 12),
        })),
      },
      status,
    });

    console.info("[RD] processed", { requestId, leadCount: leads.length, inserted, duplicates });
    return jsonResponse({
      ok: true,
      request_id: requestId,
      lead_count: leads.length,
      inserted,
      duplicates,
    });
  } catch (error) {
    const summary = errorSummary(error);
    await writeDebug({
      requestId,
      req,
      rawBody,
      parsedBody: body,
      extracted: { lead_count: leads.length },
      status: "error",
      error: summary,
    });
    console.error("[RD] processing_failed", { requestId, error: summary });
    return jsonResponse({ ok: false, error: "processing_failed", request_id: requestId }, 500);
  }
});
