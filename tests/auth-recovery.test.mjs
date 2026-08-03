import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const crm=await readFile(new URL("../index.html",import.meta.url),"utf8");

test("sessão expirada tenta renovação antes de getSession",()=>{
  assert.match(crm,/async function getSessionWithExpiredRecovery/);
  assert.match(crm,/sb\.auth\.refreshSession\(\{refresh_token:refreshToken\}\)/);
  assert.match(crm,/renovação automática da sessão/);
  assert.equal((crm.match(/getSessionWithExpiredRecovery\(/g)||[]).length,3);
});

test("falha de renovação limpa somente a autenticação inválida e volta ao login",()=>{
  assert.match(crm,/function clearPersistedAuthSession/);
  assert.match(crm,/window\.localStorage\.removeItem\(storageKey\)/);
  assert.match(crm,/recovery:"refresh_failed"/);
  assert.match(crm,/if\(!session\?\.user\)[\s\S]{0,500}openLogin\(\)/);
});
