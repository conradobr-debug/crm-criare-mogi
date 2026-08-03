import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("o CRM não chama nem armazena em cache o fluxo oficial antigo", () => {
  const crm = fs.readFileSync(new URL("index.html", root), "utf8");
  const worker = fs.readFileSync(new URL("service-worker.js", root), "utf8");
  assert.doesNotMatch(crm, /functions\/v1\/whatsapp-(summary|processor|webhook)/);
  assert.doesNotMatch(crm, /CriareWhatsAppDataService/);
  assert.doesNotMatch(worker, /whatsapp-data-service\.js/);
  assert.match(crm, /A análise automática antiga foi desativada/);
});

test("a migração desagenda todos os processos antigos", () => {
  const migration = fs.readFileSync(
    new URL("supabase/migrations/20260803113000_retire_legacy_whatsapp_automation.sql", root),
    "utf8"
  );
  for (const job of [
    "crm-whatsapp-process-queue",
    "crm-whatsapp-daily-analysis",
    "crm-whatsapp-webhook-retention"
  ]) assert.match(migration, new RegExp(job));
  assert.match(migration, /cron\.unschedule/);
});

