import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ANALYSIS_MODE_GUIDANCE,
  CRIARE_ANALYST_INSTRUCTIONS,
  CRIARE_OPERATIONAL_KNOWLEDGE,
} from "./criare-analysis-prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
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

function redactSensitive(value: string): string {
  return value
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF ocultado]")
    .replace(/\bRG\s*[:.-]?\s*[\d.\-Xx]{6,20}\b/gi, "[RG ocultado]")
    .replace(/\b(?:ag[eê]ncia|conta|pix)\s*[:.-]?\s*[\w.@+\-]{4,80}\b/gi, "[dado bancário ocultado]");
}

function outputText(payload: Record<string, unknown>): string {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

const RESULT_PROPERTIES = {
  full_analysis: { type: "string" },
  hard_boss: { type: "string" },
  summary: { type: "string" },
  lead_quality: {
    type: "string",
    enum: ["Não avaliado", "Perfil Criare", "Potencial", "Baixo potencial", "Fora do perfil"],
  },
  next_action_kind: {
    type: "string",
    enum: ["Follow-up", "Reach-out", "Ligação", "WhatsApp", "Reunião", "Visita", "Apresentação"],
  },
  next_action_details: { type: "string" },
};

const RESULT_REQUIRED = ["full_analysis", "hard_boss", "summary", "lead_quality", "next_action_kind", "next_action_details"];

type ProviderResult = {
  result: Record<string, unknown>;
  model: string;
};

function parseResult(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const result = JSON.parse(text);
    return result && typeof result === "object" ? result as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function analyzeWithOpenAI(prompt: string, analysisMode: string): Promise<ProviderResult | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        store: false,
        instructions: `${CRIARE_ANALYST_INSTRUCTIONS}\n${CRIARE_OPERATIONAL_KNOWLEDGE}`,
        input: prompt,
        max_output_tokens: analysisMode === "Análise completa" ? 6000 : 3500,
        text: {
          format: {
            type: "json_schema",
            name: "criare_conversation_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: RESULT_REQUIRED,
              properties: RESULT_PROPERTIES,
            },
          },
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("[WhatsApp Summary] OpenAI unavailable", { status: response.status });
      return null;
    }
    const result = parseResult(outputText(payload));
    return result ? { result, model: `ChatGPT • ${OPENAI_MODEL}` } : null;
  } catch (error) {
    console.error("[WhatsApp Summary] OpenAI request failed", {
      name: error instanceof Error ? error.name : "Error",
    });
    return null;
  }
}

async function analyzeWithGemini(prompt: string, analysisMode: string): Promise<ProviderResult | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `${CRIARE_ANALYST_INSTRUCTIONS}\n${CRIARE_OPERATIONAL_KNOWLEDGE}` }],
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: analysisMode === "Análise completa" ? 6000 : 3500,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              required: RESULT_REQUIRED,
              properties: {
                full_analysis: { type: "STRING" },
                hard_boss: { type: "STRING" },
                summary: { type: "STRING" },
                lead_quality: { type: "STRING", enum: RESULT_PROPERTIES.lead_quality.enum },
                next_action_kind: { type: "STRING", enum: RESULT_PROPERTIES.next_action_kind.enum },
                next_action_details: { type: "STRING" },
              },
            },
          },
        }),
      },
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("[WhatsApp Summary] Gemini unavailable", { status: response.status });
      return null;
    }
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    const result = parseResult(typeof text === "string" ? text : "");
    return result ? { result, model: `Gemini • ${GEMINI_MODEL}` } : null;
  } catch (error) {
    console.error("[WhatsApp Summary] Gemini request failed", {
      name: error instanceof Error ? error.name : "Error",
    });
    return null;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método não permitido." }, 405);

  try {
    const user = await authenticatedUser(request);
    if (!user) return json(request, { error: "Sessão do CRM inválida." }, 401);
    if (!OPENAI_API_KEY && !GEMINI_API_KEY) {
      return json(request, {
        error: "A análise especializada ainda não foi ativada. A conversa permanece salva e pronta para nova tentativa.",
        code: "AI_NOT_CONFIGURED",
      }, 503);
    }

    const body = await request.json().catch(() => ({}));
    const rawConversation = typeof body.conversation === "string" ? body.conversation.trim() : "";
    if (rawConversation.length > 300000) {
      return json(request, {
        error: "A conversa ultrapassa o limite seguro de 300 mil caracteres. A análise foi bloqueada para não usar um histórico truncado.",
        code: "CONVERSATION_TOO_LONG",
      }, 413);
    }
    const conversation = redactSensitive(clean(rawConversation, 300000));
    if (conversation.length < 40) {
      return json(request, { error: "Cole um trecho maior da conversa para gerar o resumo." }, 400);
    }

    const context = {
      nome: clean(body.customer_name, 160),
      etapa: clean(body.stage, 100),
      ambiente: clean(body.rooms, 300),
      cidade: clean(body.city, 120),
      observacoes: redactSensitive(clean(body.notes, 1000)),
    };
    const requestedMode = clean(body.analysis_mode, 80) || "Resumo gerencial";
    const analysisMode = ANALYSIS_MODE_GUIDANCE[requestedMode] ? requestedMode : "Resumo gerencial";
    const modeGuidance = ANALYSIS_MODE_GUIDANCE[analysisMode];
    const previousAnalysis = analysisMode === "Atualizar análise"
      ? redactSensitive(clean(body.previous_analysis, 10000))
      : "";
    const today = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

    const prompt = `DATA DE REFERÊNCIA: ${today}
MODO SOLICITADO: ${analysisMode}
ORIENTAÇÃO DO MODO: ${modeGuidance}

CONTEXTO ATUAL DO CRM:
${JSON.stringify(context)}

${previousAnalysis ? `ANÁLISE ANTERIOR PARA COMPARAÇÃO:\n---\n${previousAnalysis}\n---` : ""}

CONVERSA DO WHATSAPP (dados sensíveis detectáveis já foram ocultados):
---
${conversation}
---

Produza a análise em português do Brasil. Preserve datas, valores, responsáveis, decisões e evidências importantes.
O campo full_analysis deve conter a análise completa, legível, com títulos e listas.
O campo hard_boss deve conter exatamente um único parágrafo final direto, crítico e acionável, sem título e sem lista.
O campo summary deve repetir exatamente o conteúdo de hard_boss para compatibilidade com o CRM.
Para lead_quality, avalie aderência ao perfil Criare separadamente do potencial comercial. Use “Não avaliado” se faltarem evidências. next_action_details deve ser uma ação concreta para o responsável executar.`;

    const provider = await analyzeWithOpenAI(prompt, analysisMode) ||
      await analyzeWithGemini(prompt, analysisMode);
    if (!provider) {
      return json(request, {
        error: "A IA está temporariamente indisponível. A conversa permanece salva e pronta para nova tentativa.",
        code: "AI_UNAVAILABLE",
      }, 502);
    }

    const result = provider.result;
    const hardBoss = clean(result.hard_boss || result.summary, 2500);
    return json(request, {
      full_analysis: clean(result.full_analysis, 16000),
      hard_boss: hardBoss,
      summary: hardBoss,
      lead_quality: clean(result.lead_quality, 40),
      next_action_kind: clean(result.next_action_kind, 40),
      next_action_details: clean(result.next_action_details, 1000),
      model: provider.model,
    });
  } catch (error) {
    console.error("[WhatsApp Summary] Unexpected error", error);
    return json(request, { error: "Não foi possível gerar o resumo agora.", code: "UNEXPECTED" }, 500);
  }
});
