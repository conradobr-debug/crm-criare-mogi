import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

await import("../whatsapp-crm-extension/phone-identity.js");
const phone=globalThis.CriarePhoneIdentity;

test("normaliza celular brasileiro formatado para E.164",()=>assert.deepEqual(phone.normalizePhone("(19) 99999-9999"),{raw_input:"(19) 99999-9999",normalized_e164:"+5519999999999",country_code:"55",national_number:"19999999999",is_valid:true,validation_reason:"valid",display_format:"(19) 99999-9999"}));
test("normaliza celular brasileiro sem +55",()=>assert.equal(phone.normalizePhone("19 99999 9999").normalized_e164,"+5519999999999"));
test("normaliza telefone fixo brasileiro",()=>assert.equal(phone.normalizePhone("(19) 3234-5678").normalized_e164,"+551932345678"));
test("preserva número internacional explícito",()=>assert.equal(phone.normalizePhone("+1 713 555 0123").normalized_e164,"+17135550123"));
test("rejeita DDD inexistente, incompleto e vazio",()=>{assert.equal(phone.normalizePhone("(00) 99999-9999").is_valid,false);assert.equal(phone.normalizePhone("943948739").is_valid,false);assert.equal(phone.normalizePhone("").validation_reason,"phone_missing");});
test("detecta duplicata apesar de formatos diferentes no mesmo workspace",()=>{const records=[{id:"a",workspace_id:"w1",phone:"(19) 99999-9999"},{id:"b",workspace_id:"w2",phone:"+5519999999999"}];assert.deepEqual(phone.duplicateRecords(records,"+55 19 99999-9999",{workspaceId:"w1"}).map(item=>item.id),["a"]);assert.deepEqual(phone.duplicateRecords(records,"+55 19 99999-9999",{workspaceId:"w3"}),[]);});
test("CRM bloqueia manual inválido/duplicado, confirma troca e preserva conversas",async()=>{const crm=await readFile(new URL("../index.html",import.meta.url),"utf8");assert.match(crm,/btnSave"\)\.disabled=manualNew\?!state\.ready/);assert.match(crm,/phoneState\.duplicates\.length/);assert.match(crm,/Este lead já possui uma conversa capturada/);assert.match(crm,/O histórico atual será preservado/);assert.doesNotMatch(crm,/delete .*whatsapp_(?:message_entries|transcript)/);});
test("captura exige telefone válido e único e não usa semelhança de nome",async()=>{const crm=await readFile(new URL("../index.html",import.meta.url),"utf8"),content=await readFile(new URL("../whatsapp-crm-extension/content-whatsapp.js",import.meta.url),"utf8");assert.match(crm,/requireWhatsAppIdentity\(record\)/);assert.match(crm,/code:"phone_duplicate"/);const sameCustomer=content.slice(content.indexOf("function sameCustomer"),content.indexOf("function messageNodes"));assert.doesNotMatch(sameCustomer,/expectedName|tokens/);assert.match(sameCustomer,/searchParams\.get\("phone"\)/);});
test("lead automático ausente continua representável, mas WhatsApp fica bloqueado",()=>{const identity=phone.normalizePhone("Não informado");assert.equal(identity.is_valid,false);assert.equal(phone.comparableDigits("Não informado"),"");});
