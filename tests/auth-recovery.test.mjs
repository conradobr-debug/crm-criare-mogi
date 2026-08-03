import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../index.html",import.meta.url),"utf8");

test("sessão expirada é removida antes de criar o cliente de autenticação",()=>{
  assert.match(crm,/async function getSessionWithExpiredRecovery/);
  assert.doesNotMatch(crm,/sb\.auth\.refreshSession/);
  assert.match(crm,/localAuthInfo = readLocalAuthInfo\(\);\s*if\(localAuthInfo\.expired\) clearPersistedAuthSession\(\);\s*sb = supabase\.createClient/);
  assert.equal((crm.match(/getSessionWithExpiredRecovery\(/g)||[]).length,3);
});

test("sessão inválida limpa somente a autenticação e volta ao login",()=>{
  assert.match(crm,/function clearPersistedAuthSession/);
  assert.match(crm,/window\.localStorage\.removeItem\(storageKey\)/);
  assert.match(crm,/recovery:"expired_cleared_before_refresh"/);
  assert.match(crm,/if\(!session\?\.user\)[\s\S]{0,500}openLogin\(\)/);
});
