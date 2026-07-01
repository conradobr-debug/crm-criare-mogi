import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash-lite";
const CRM_PUBLIC_URL = Deno.env.get("CRM_PUBLIC_URL") || "https://conradobr-debug.github.io/crm-criare-mogi/";

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
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
}

function json(request: Request, body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8" },
  });
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

function clean(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método não permitido." }, 405);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json(request, { error: "Sessão do CRM inválida." }, 401);
    if (!GEMINI_API_KEY) {
      return json(request, {
        error: "A IA gratuita ainda não foi ativada. O CRM usará a análise local.",
        code: "AI_NOT_CONFIGURED",
      }, 503);
    }

    const body = await request.json().catch(() => ({}));
    const conversation = clean(body.conversation, 30000);
    if (conversation.length < 40) {
      return json(request, { error: "Cole um trecho maior da conversa para gerar o resumo." }, 400);
    }

    const context = {
      nome: clean(body.customer_name, 160),
      etapa: clean(body.stage, 100),
      ambiente: clean(body.rooms, 300),
      cidade: clean(body.city, 120),
      observacoes: clean(body.notes, 1000),
    };

    const prompt = `Você é assistente comercial da Criare Mogi Guaçu, loja de ambientes planejados.
Analise somente o conteúdo fornecido. Não invente informações. Quando algo não estiver claro, diga "não identificado".
O resumo deve ajudar um vendedor a retomar uma venda consultiva, longa e de alto envolvimento.

Contexto do CRM:
${JSON.stringify(context)}

Conversa do WhatsApp:
---
${conversation}
---

Retorne JSON válido com:
- summary: resumo em português, com os títulos "Contexto", "Necessidades e interesses", "Objeções ou riscos", "Compromissos assumidos" e "Próximo passo recomendado". Seja objetivo, mas preserve datas, valores e decisões importantes.
- lead_quality: uma destas opções: Não avaliado, Perfil Criare, Potencial, Baixo potencial, Fora do perfil.
- next_action_kind: uma destas opções: Follow-up, Reach-out, Ligação, WhatsApp, Reunião, Visita, Apresentação.
- next_action_details: uma ação concreta para o vendedor, em uma ou duas frases.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1800,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              required: ["summary", "lead_quality", "next_action_kind", "next_action_details"],
              properties: {
                summary: { type: "STRING" },
                lead_quality: { type: "STRING", enum: ["Não avaliado", "Perfil Criare", "Potencial", "Baixo potencial", "Fora do perfil"] },
                next_action_kind: { type: "STRING", enum: ["Follow-up", "Reach-out", "Ligação", "WhatsApp", "Reunião", "Visita", "Apresentação"] },
                next_action_details: { type: "STRING" },
              },
            },
          },
        }),
      },
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("[WhatsApp Summary] Gemini error", { status: response.status, message: payload?.error?.message });
      return json(request, {
        error: "A IA está temporariamente indisponível. O CRM usará a análise local.",
        code: "AI_UNAVAILABLE",
      }, 502);
    }

    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const result = JSON.parse(text);
    return json(request, {
      summary: clean(result.summary, 8000),
      lead_quality: clean(result.lead_quality, 40),
      next_action_kind: clean(result.next_action_kind, 40),
      next_action_details: clean(result.next_action_details, 1000),
      model: GEMINI_MODEL,
    });
  } catch (error) {
    console.error("[WhatsApp Summary] Unexpected error", error);
    return json(request, { error: "Não foi possível gerar o resumo agora.", code: "UNEXPECTED" }, 500);
  }
});
