(function(global){
  "use strict";
  const SCHEMA="criare-whatsapp-extension-receipt-1.0";
  const clean=value=>String(value??"").trim();
  const normalizePhone=value=>{const digits=clean(value).replace(/\D/g,"");return digits.length>=8&&digits.length<=15?digits:"";};
  const normalizeId=value=>clean(value).replace(/^wa:/i,"").toUpperCase();
  function validate(receipt){
    if(!receipt||typeof receipt!=="object"||Array.isArray(receipt))throw new Error("Retorno da extensão inválido.");
    if(receipt.schema_version!==SCHEMA)throw new Error("Versão do retorno da extensão incompatível.");
    if(!clean(receipt.batch_id))throw new Error("O retorno não possui batch_id.");
    for(const key of ["processed","unchanged","failures","recent_inventory","possible_new_conversations"])if(!Array.isArray(receipt[key]))throw new Error(`Campo obrigatório ausente: ${key}.`);
    return receipt;
  }
  function recordMaps(records=[]){
    const byId=new Map(),byPhone=new Map();
    for(const record of records){
      byId.set(clean(record.id),record);
      const phone=normalizePhone(record.phone);if(!phone)continue;
      if(!byPhone.has(phone))byPhone.set(phone,[]);byPhone.get(phone).push(record);
    }
    return {byId,byPhone};
  }
  function receiptPlan(receipt,records=[]){
    validate(receipt);const maps=recordMaps(records),patches=[],warnings=[];
    const addPatch=(item,status)=>{
      const record=maps.byId.get(clean(item.lead_id));if(!record){warnings.push({code:"lead_not_found",lead_id:item.lead_id});return;}
      const patch={
        whatsapp_last_checked_at:item.checked_at||receipt.generated_at,
        whatsapp_observed_last_message_id:item.observed_last_message_id||null,
        whatsapp_observed_last_message_at:item.observed_last_message_at||null,
        whatsapp_sync_batch_id:receipt.batch_id,
        whatsapp_external_chat_id:item.external_chat_id||record.whatsapp_external_chat_id||null,
        whatsapp_sync_status:status
      };
      if(status==="verification_required")patch.whatsapp_sync_error=clean(item.error)||"Verificação manual necessária.";
      else patch.whatsapp_sync_error=null;
      if(status==="current"&&item.cursor_confirmed)patch.whatsapp_analysis_status="current";
      patches.push({record,item,patch,status});
    };
    receipt.unchanged.forEach(item=>addPatch(item,"current"));
    receipt.processed.forEach(item=>{
      const record=maps.byId.get(clean(item.lead_id));
      const importedAlready=record?.whatsapp_analysis_status==="current"
        && normalizeId(record.whatsapp_analysis_last_message_id)===normalizeId(item.analyzed_until_message_id);
      addPatch(item,importedAlready?"current":"awaiting_analysis");
    });
    receipt.failures.forEach(item=>addPatch(item,"verification_required"));
    const discoveries=[];
    for(const chat of receipt.possible_new_conversations){
      const phone=normalizePhone(chat.phone_e164),matches=phone?(maps.byPhone.get(phone)||[]):[];
      const classification=matches.length===1?"known_contact":matches.length>1?"ambiguous":"possible_new_lead";
      discoveries.push({chat,classification,record:matches[0]||null});
    }
    return {receipt,patches,discoveries,warnings,summary:{processed:receipt.processed.length,unchanged:receipt.unchanged.length,failures:receipt.failures.length,possible_new:discoveries.filter(item=>item.classification==="possible_new_lead").length,ambiguous:discoveries.filter(item=>item.classification==="ambiguous").length}};
  }
  global.CriareWhatsAppSyncReceipt={SCHEMA,validate,receiptPlan,normalizePhone,normalizeId};
  if(typeof module!=="undefined"&&module.exports)module.exports=global.CriareWhatsAppSyncReceipt;
})(typeof globalThis!=="undefined"?globalThis:this);
