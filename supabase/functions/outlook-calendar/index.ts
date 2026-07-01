import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") || "";
const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET") || "";
const TOKEN_ENCRYPTION_KEY = Deno.env.get("OUTLOOK_TOKEN_ENCRYPTION_KEY") || "";
const MAKE_WEBHOOK_URL = Deno.env.get("MAKE_CALENDAR_WEBHOOK_URL")
  || Deno.env.get("MAKE_WEBHOOK_URL")
  || "";
const MAKE_WEBHOOK_SECRET = Deno.env.get("MAKE_CALENDAR_WEBHOOK_SECRET")
  || Deno.env.get("MAKE_WEBHOOK_SECRET")
  || "";
const ALLOWED_OUTLOOK_EMAIL = (Deno.env.get("OUTLOOK_ALLOWED_EMAIL") || "criaremg@hotmail.com").toLowerCase();
const CONNECTOR_USER_EMAIL = (Deno.env.get("OUTLOOK_CONNECTOR_USER_EMAIL") || "").toLowerCase();
const CRM_PUBLIC_URL = Deno.env.get("CRM_PUBLIC_URL") || "https://conradobr-debug.github.io/crm-criare-mogi/";
const REDIRECT_URI = Deno.env.get("OUTLOOK_REDIRECT_URI") || `${SUPABASE_URL}/functions/v1/outlook-calendar?callback=1`;
const MICROSOFT_TENANT = "consumers";
const MICROSOFT_SCOPES = "openid profile offline_access User.Read Calendars.ReadWrite";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Json = Record<string, unknown>;

function allowedOrigin(request: Request): string {
  const origin = request.headers.get("origin") || "";
  if (origin === new URL(CRM_PUBLIC_URL).origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return origin;
  }
  return new URL(CRM_PUBLIC_URL).origin;
}

function corsHeaders(request: Request) {
  return {
    "access-control-allow-origin": allowedOrigin(request),
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "Origin",
  };
}

function json(request: Request, body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8" },
  });
}

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { location: url } });
}

function requireConfiguration() {
  if (MAKE_WEBHOOK_URL && MAKE_WEBHOOK_SECRET) return;
  if (!MICROSOFT_CLIENT_ID) throw new Error("MICROSOFT_CLIENT_ID não configurado.");
  if (!TOKEN_ENCRYPTION_KEY) throw new Error("OUTLOOK_TOKEN_ENCRYPTION_KEY não configurado.");
}

function makeBridgeConfigured() {
  return Boolean(MAKE_WEBHOOK_URL && MAKE_WEBHOOK_SECRET);
}

function validatedMakeWebhookUrl() {
  const url = new URL(MAKE_WEBHOOK_URL);
  const trustedHost = url.hostname === "hook.make.com" || url.hostname.endsWith(".make.com");
  if (url.protocol !== "https:" || !trustedHost) {
    throw new Error("MAKE_CALENDAR_WEBHOOK_URL precisa ser um webhook HTTPS da Make.");
  }
  return url.toString();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = base64ToBytes(TOKEN_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("OUTLOOK_TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptText(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(value),
  ));
  const output = new Uint8Array(iv.length + encrypted.length);
  output.set(iv, 0);
  output.set(encrypted, iv.length);
  return bytesToBase64(output);
}

async function decryptText(value: string): Promise<string> {
  const input = base64ToBytes(value);
  const iv = input.slice(0, 12);
  const encrypted = input.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    encrypted,
  );
  return new TextDecoder().decode(decrypted);
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return base64Url(digest);
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function microsoftToken(parameters: Record<string, string>) {
  const form = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    scope: MICROSOFT_SCOPES,
    ...parameters,
  });
  if (MICROSOFT_CLIENT_SECRET) form.set("client_secret", MICROSOFT_CLIENT_SECRET);

  const response = await fetch(
    `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    console.error("[Outlook OAuth] Falha no token.", { status: response.status, error: payload?.error });
    throw new Error(payload?.error_description || "Falha ao autorizar o Outlook.");
  }
  return payload;
}

async function graph(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { response, payload };
}

async function startConnection(request: Request) {
  requireConfiguration();
  const user = await authenticatedUser(request);
  if (!user) return json(request, { error: "Sessão do CRM inválida." }, 401);

  if (CONNECTOR_USER_EMAIL && (user.email || "").toLowerCase() !== CONNECTOR_USER_EMAIL) {
    return json(request, { error: "Somente o administrador do CRM pode conectar o calendário central." }, 403);
  }

  const state = crypto.randomUUID().replaceAll("-", "");
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(64)));
  const verifierCiphertext = await encryptText(verifier);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await admin.from("crm_outlook_oauth_states").delete().lt("expires_at", new Date().toISOString());
  const { error } = await admin.from("crm_outlook_oauth_states").insert({
    state,
    crm_user_id: user.id,
    verifier_ciphertext: verifierCiphertext,
    expires_at: expiresAt,
  });
  if (error) throw error;

  const authorize = new URL(`https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize`);
  authorize.search = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    response_mode: "query",
    scope: MICROSOFT_SCOPES,
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: "S256",
    login_hint: ALLOWED_OUTLOOK_EMAIL,
    prompt: "select_account",
  }).toString();

  return json(request, { authorization_url: authorize.toString() });
}

async function finishConnection(url: URL) {
  requireConfiguration();
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const oauthError = url.searchParams.get("error");
  if (oauthError) return redirect(`${CRM_PUBLIC_URL}?outlook=error&reason=${encodeURIComponent(oauthError)}`);
  if (!state || !code) return redirect(`${CRM_PUBLIC_URL}?outlook=error&reason=missing_code`);

  const { data: stored, error } = await admin
    .from("crm_outlook_oauth_states")
    .select("*")
    .eq("state", state)
    .maybeSingle();
  if (error || !stored || new Date(stored.expires_at) < new Date()) {
    return redirect(`${CRM_PUBLIC_URL}?outlook=error&reason=invalid_state`);
  }

  await admin.from("crm_outlook_oauth_states").delete().eq("state", state);
  const verifier = await decryptText(stored.verifier_ciphertext);
  const token = await microsoftToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  if (!token.refresh_token) throw new Error("A Microsoft não retornou autorização offline.");

  const me = await graph("/me?$select=id,mail,userPrincipalName", token.access_token);
  if (!me.response.ok) throw new Error("Não foi possível identificar a conta conectada.");
  const accountEmail = String(me.payload?.mail || me.payload?.userPrincipalName || "").toLowerCase();
  if (ALLOWED_OUTLOOK_EMAIL && accountEmail !== ALLOWED_OUTLOOK_EMAIL) {
    return redirect(`${CRM_PUBLIC_URL}?outlook=wrong_account&email=${encodeURIComponent(accountEmail)}`);
  }

  const refreshTokenCiphertext = await encryptText(token.refresh_token);
  const { error: saveError } = await admin.from("crm_outlook_connection").upsert({
    id: 1,
    microsoft_user_id: me.payload.id,
    account_email: accountEmail,
    refresh_token_ciphertext: refreshTokenCiphertext,
    scope: token.scope || MICROSOFT_SCOPES,
    connected_by: stored.crm_user_id,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (saveError) throw saveError;

  return redirect(`${CRM_PUBLIC_URL}?outlook=connected`);
}

async function connectionStatus(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return json(request, { error: "Sessão do CRM inválida." }, 401);
  if (makeBridgeConfigured()) {
    return json(request, {
      configured: true,
      connected: true,
      provider: "make",
      account_email: ALLOWED_OUTLOOK_EMAIL,
      connected_at: null,
    });
  }
  const configured = Boolean(MICROSOFT_CLIENT_ID && TOKEN_ENCRYPTION_KEY);
  if (!configured) return json(request, { configured: false, connected: false });

  const { data } = await admin
    .from("crm_outlook_connection")
    .select("account_email, connected_at, updated_at")
    .eq("id", 1)
    .maybeSingle();
  return json(request, {
    configured: true,
    connected: Boolean(data),
    provider: "microsoft_graph",
    account_email: data?.account_email || null,
    connected_at: data?.connected_at || null,
  });
}

async function freshAccessToken() {
  requireConfiguration();
  const { data: connection, error } = await admin
    .from("crm_outlook_connection")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!connection) throw new Error("OUTLOOK_NOT_CONNECTED");

  const refreshToken = await decryptText(connection.refresh_token_ciphertext);
  const token = await microsoftToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (token.refresh_token) {
    await admin.from("crm_outlook_connection").update({
      refresh_token_ciphertext: await encryptText(token.refresh_token),
      scope: token.scope || connection.scope,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
  }
  return token.access_token as string;
}

function html(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendEventThroughMake(
  recordId: string,
  record: Record<string, any>,
  event: {
    title: string;
    body: string;
    start: Date;
    end: Date;
    reminder: number;
  },
) {
  const response = await fetch(validatedMakeWebhookUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${MAKE_WEBHOOK_SECRET}`,
      "x-make-apikey": MAKE_WEBHOOK_SECRET,
      "x-crm-calendar-secret": MAKE_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      operation: record.outlook_event_id ? "update" : "create",
      crm_record_id: recordId,
      event_id: record.outlook_event_id || null,
      subject: event.title,
      body_html: event.body,
      start_utc: event.start.toISOString(),
      end_utc: event.end.toISOString(),
      time_zone: "America/Sao_Paulo",
      reminder_minutes: Math.max(0, event.reminder),
      is_reminder_on: event.reminder > 0,
      show_as: "busy",
      category: "CRM Criare",
      account_email: ALLOWED_OUTLOOK_EMAIL,
    }),
  });

  const responseText = await response.text();
  let payload: Record<string, any> = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { message: responseText };
    }
  }
  if (!response.ok) {
    console.error("[Make Calendar] Falha no cenário.", { status: response.status });
    throw new Error(payload.error || payload.message || "A automação do calendário recusou o compromisso.");
  }

  const eventId = String(payload.event_id || payload.id || "").trim();
  if (!eventId) {
    throw new Error("A Make criou o compromisso, mas não retornou o identificador do evento.");
  }
  const webLink = String(payload.web_link || payload.webLink || "").trim() || null;
  const { error: updateError } = await admin.from("crm_records").update({
    outlook_event_id: eventId,
    outlook_event_web_link: webLink,
    outlook_synced_at: new Date().toISOString(),
  }).eq("id", recordId);
  if (updateError) throw updateError;

  return {
    event_id: eventId,
    web_link: webLink,
  };
}

async function createOrUpdateEvent(request: Request, input: Json) {
  const user = await authenticatedUser(request);
  if (!user) return json(request, { error: "Sessão do CRM inválida." }, 401);
  const recordId = String(input.record_id || "");
  if (!recordId) return json(request, { error: "Lead ou especificador não informado." }, 400);

  const { data: record, error } = await admin
    .from("crm_records")
    .select("*")
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw error;
  if (!record) return json(request, { error: "Cadastro não encontrado." }, 404);
  if (!record.next_action_at) return json(request, { error: "Defina a data e o horário do próximo acompanhamento." }, 400);

  const start = new Date(record.next_action_at);
  if (Number.isNaN(start.getTime())) return json(request, { error: "Data do acompanhamento inválida." }, 400);
  const duration = Number(record.next_action_duration_minutes || 30);
  const reminder = Number(record.next_action_reminder_minutes ?? 30);
  const end = new Date(start.getTime() + duration * 60_000);
  const fullName = [record.first_name, record.last_name].filter(Boolean).join(" ").trim() || "Contato";
  const kind = record.next_action_kind || "Acompanhamento";
  const title = `CRM Criare • ${kind} • ${fullName}`;
  const details = record.next_action_details || "Realizar acompanhamento e definir o próximo passo.";

  const body = [
    `<p><strong>${html(details)}</strong></p>`,
    `<p>Contato: ${html(fullName)}<br>`,
    record.phone ? `Telefone: ${html(record.phone)}<br>` : "",
    record.city ? `Cidade: ${html(record.city)}<br>` : "",
    record.record_type === "specifier"
      ? `Especificador: ${html(record.specifier_type || "Parceiro")}${record.company_name ? ` • ${html(record.company_name)}` : ""}`
      : `Etapa: ${html(record.stage || "Novo")}`,
    "</p><p>Origem: CRM Criare Mogi Guaçu</p>",
  ].join("");

  const eventPayload = {
    subject: title,
    body: { contentType: "HTML", content: body },
    start: { dateTime: start.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
    end: { dateTime: end.toISOString().replace(/Z$/, ""), timeZone: "UTC" },
    isReminderOn: reminder > 0,
    reminderMinutesBeforeStart: Math.max(0, reminder),
    showAs: "busy",
    categories: ["CRM Criare"],
  };

  if (makeBridgeConfigured()) {
    const result = await sendEventThroughMake(recordId, record, {
      title,
      body,
      start,
      end,
      reminder,
    });
    return json(request, {
      ok: true,
      provider: "make",
      event_id: result.event_id,
      web_link: result.web_link,
      account_email: ALLOWED_OUTLOOK_EMAIL,
    });
  }

  const accessToken = await freshAccessToken();
  let eventResult = null;
  let eventResponse = null;

  if (record.outlook_event_id) {
    const update = await graph(`/me/events/${encodeURIComponent(record.outlook_event_id)}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify(eventPayload),
    });
    if (update.response.ok) {
      eventResult = update.payload;
      eventResponse = update.response;
    } else if (update.response.status !== 404) {
      console.error("[Outlook] Falha ao atualizar evento.", { status: update.response.status });
      return json(request, { error: update.payload?.error?.message || "Falha ao atualizar o compromisso." }, 502);
    }
  }

  if (!eventResponse) {
    const create = await graph("/me/events", accessToken, {
      method: "POST",
      body: JSON.stringify({ ...eventPayload, transactionId: crypto.randomUUID() }),
    });
    if (!create.response.ok) {
      console.error("[Outlook] Falha ao criar evento.", { status: create.response.status });
      return json(request, { error: create.payload?.error?.message || "Falha ao criar o compromisso." }, 502);
    }
    eventResult = create.payload;
  }

  const { error: updateError } = await admin.from("crm_records").update({
    outlook_event_id: eventResult.id,
    outlook_event_web_link: eventResult.webLink || null,
    outlook_synced_at: new Date().toISOString(),
  }).eq("id", recordId);
  if (updateError) throw updateError;

  return json(request, {
    ok: true,
    event_id: eventResult.id,
    web_link: eventResult.webLink || null,
    account_email: ALLOWED_OUTLOOK_EMAIL,
  });
}

async function disconnect(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return json(request, { error: "Sessão do CRM inválida." }, 401);
  if (makeBridgeConfigured()) {
    return json(request, {
      error: "A conexão gratuita é administrada na Make e não pode ser removida pelo CRM.",
    }, 409);
  }
  if (CONNECTOR_USER_EMAIL && (user.email || "").toLowerCase() !== CONNECTOR_USER_EMAIL) {
    return json(request, { error: "Somente o administrador do CRM pode desconectar o calendário central." }, 403);
  }
  const { error } = await admin.from("crm_outlook_connection").delete().eq("id", 1);
  if (error) throw error;
  return json(request, { ok: true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  const url = new URL(request.url);

  try {
    if (url.searchParams.get("callback") === "1") {
      try {
        return await finishConnection(url);
      } catch (error) {
        console.error("[Outlook OAuth Callback]", error);
        return redirect(`${CRM_PUBLIC_URL}?outlook=error&reason=callback_failed`);
      }
    }
    if (request.method !== "POST") return json(request, { error: "Método não permitido." }, 405);

    const input = await request.json().catch(() => ({})) as Json;
    const action = String(input.action || "status");
    if (action === "connect") return await startConnection(request);
    if (action === "status") return await connectionStatus(request);
    if (action === "create_event") return await createOrUpdateEvent(request, input);
    if (action === "disconnect") return await disconnect(request);
    return json(request, { error: "Ação inválida." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada.";
    console.error("[Outlook Calendar]", message);
    const status = message === "OUTLOOK_NOT_CONNECTED" ? 409 : 500;
    return json(request, {
      error: message === "OUTLOOK_NOT_CONNECTED" ? "Calendário ainda não conectado." : message,
      code: message === "OUTLOOK_NOT_CONNECTED" ? message : "OUTLOOK_ERROR",
    }, status);
  }
});
