import {
  ANALYSIS_MODE_GUIDANCE,
  CRIARE_ANALYST_INSTRUCTIONS,
  CRIARE_OPERATIONAL_KNOWLEDGE,
} from "../whatsapp-summary/criare-analysis-prompt.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";

const stringArray = { type: "array", items: { type: "string" } };
export const ANALYSIS_PROPERTIES = {
  full_analysis: { type: "string" }, hard_boss: { type: "string" }, summary: { type: "string" },
  lead_quality: { type: "string", enum: ["Não avaliado", "Perfil Criare", "Potencial", "Baixo potencial", "Fora do perfil"] },
  commercial_potential: { type: "string", enum: ["alto", "médio", "baixo", "indeterminado"] },
  real_interest: { type: "string", enum: ["confirmado", "provável", "fraco", "não levantado"] },
  rooms: stringArray, city: { type: "string" }, property_stage: { type: "string" }, deadline: { type: "string" },
  investment_range: { type: "string" }, source: { type: "string" }, expectations: stringArray, objections: stringArray,
  price_sensitivity: { type: "string", enum: ["alta", "moderada", "baixa", "não levantada"] },
  missing_information: stringArray, recommended_questions: stringArray, staff_errors: stringArray,
  discovery_quality: { type: "string", enum: ["forte", "adequada", "fraca", "não avaliável"] },
  service_quality: { type: "string", enum: ["excelente", "boa", "regular", "ruim", "não avaliável"] },
  next_action_kind: { type: "string", enum: ["Follow-up", "Reach-out", "Ligação", "WhatsApp", "Reunião", "Visita", "Apresentação"] },
  next_action_details: { type: "string" }, priority: { type: "string", enum: ["P1", "P2", "P3", "P4"] },
  loss_risk: { type: "string", enum: ["alto", "moderado", "baixo", "indeterminado"] },
  needs_follow_up: { type: "boolean" }, confirmed_facts: stringArray, inferences: stringArray, not_raised: stringArray,
};
export const ANALYSIS_REQUIRED = Object.keys(ANALYSIS_PROPERTIES);

export type AnalysisInput = {
  conversation: string;
  analysisMode?: string;
  previousAnalysis?: string;
  context?: Record<string, unknown>;
};

function outputText(payload: Record<string, unknown>): string {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>> : [];
    for (const part of content) if (part?.type === "output_text" && typeof part.text === "string") return part.text;
  }
  return "";
}

export async function analyzeCriareConversation(input: AnalysisInput) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_NOT_CONFIGURED");
  const requestedMode = String(input.analysisMode || "Análise completa");
  const mode = ANALYSIS_MODE_GUIDANCE[requestedMode] ? requestedMode : "Análise completa";
  const prompt = `DATA DE REFERÊNCIA: ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
MODO: ${mode}
ORIENTAÇÃO: ${ANALYSIS_MODE_GUIDANCE[mode]}
CONTEXTO DO CRM: ${JSON.stringify(input.context || {})}
${input.previousAnalysis ? `ANÁLISE ANTERIOR:\n${input.previousAnalysis}\n` : ""}
CONVERSA OFICIAL DO WHATSAPP, EM ORDEM CRONOLÓGICA:
---
${input.conversation}
---
Analise exclusivamente as evidências disponíveis. Não invente dados. Separe fatos confirmados, inferências e informações não levantadas. full_analysis deve ser a análise completa adaptada à Criare. hard_boss deve ser um único parágrafo curto, incisivo e gerencial, avaliando atendimento, potencial, falha principal, próximo movimento e risco. summary deve repetir hard_boss.`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL, store: false,
      instructions: `${CRIARE_ANALYST_INSTRUCTIONS}\n${CRIARE_OPERATIONAL_KNOWLEDGE}`,
      input: prompt, max_output_tokens: 8000,
      text: { format: { type: "json_schema", name: "criare_whatsapp_analysis", strict: true,
        schema: { type: "object", additionalProperties: false, required: ANALYSIS_REQUIRED, properties: ANALYSIS_PROPERTIES } } },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OPENAI_${response.status}`);
  const text = outputText(payload as Record<string, unknown>);
  const result = JSON.parse(text || "{}");
  if (!result.hard_boss || !result.full_analysis) throw new Error("ANALYSIS_INVALID_OUTPUT");
  return { ...result, summary: result.hard_boss, model: `ChatGPT • ${OPENAI_MODEL}` };
}
