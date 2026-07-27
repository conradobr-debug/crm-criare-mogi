(function(root){
  "use strict";

  const BRAZIL_DDDS = new Set([
    "11","12","13","14","15","16","17","18","19","21","22","24","27","28",
    "31","32","33","34","35","37","38","41","42","43","44","45","46","47","48","49",
    "51","53","54","55","61","62","63","64","65","66","67","68","69","71","73","74",
    "75","77","79","81","82","83","84","85","86","87","88","89","91","92","93","94",
    "95","96","97","98","99"
  ]);

  function result(raw, patch={}){
    return {raw_input:String(raw??""),normalized_e164:null,country_code:null,national_number:null,is_valid:false,validation_reason:"phone_missing",display_format:"",...patch};
  }
  function brazilDisplay(national){
    const ddd=national.slice(0,2), subscriber=national.slice(2);
    return subscriber.length===9?`(${ddd}) ${subscriber.slice(0,5)}-${subscriber.slice(5)}`:`(${ddd}) ${subscriber.slice(0,4)}-${subscriber.slice(4)}`;
  }
  function normalizePhone(raw){
    const input=String(raw??"").trim();
    if(!input)return result(raw);
    const explicitPlus=input.startsWith("+");
    let digits=input.replace(/\D/g,"");
    if(input.startsWith("00")){digits=digits.slice(2);}
    if(!digits)return result(raw,{validation_reason:"phone_invalid"});

    const looksBrazilian=!explicitPlus&&(digits.length===10||digits.length===11||((digits.length===12||digits.length===13)&&digits.startsWith("55")));
    if(looksBrazilian||(explicitPlus&&digits.startsWith("55"))){
      const national=digits.startsWith("55")?digits.slice(2):digits;
      const ddd=national.slice(0,2), subscriber=national.slice(2);
      if(!BRAZIL_DDDS.has(ddd))return result(raw,{country_code:"55",national_number:national||null,validation_reason:"invalid_brazilian_ddd"});
      const mobile=national.length===11&&subscriber.startsWith("9");
      const landline=national.length===10&&/^[2-5]/.test(subscriber);
      if(!mobile&&!landline)return result(raw,{country_code:"55",national_number:national,validation_reason:"invalid_brazilian_length_or_prefix"});
      return result(raw,{normalized_e164:`+55${national}`,country_code:"55",national_number:national,is_valid:true,validation_reason:"valid",display_format:brazilDisplay(national)});
    }

    if(!explicitPlus)return result(raw,{national_number:digits,validation_reason:"international_country_code_required"});
    if(digits.length<8||digits.length>15||digits.startsWith("0"))return result(raw,{national_number:digits,validation_reason:"invalid_e164"});
    const countryCode=digits.length>=11?digits.slice(0,2):digits.slice(0,1);
    return result(raw,{normalized_e164:`+${digits}`,country_code:countryCode,national_number:digits.slice(countryCode.length),is_valid:true,validation_reason:"valid",display_format:`+${digits}`});
  }
  function comparableDigits(raw){const normalized=normalizePhone(raw);return normalized.is_valid?normalized.normalized_e164.slice(1):"";}
  function duplicateRecords(records,value,{excludeId=null,workspaceId="default"}={}){
    const target=normalizePhone(value);if(!target.is_valid)return [];
    const scope=String(workspaceId||"default");
    return (records||[]).filter(record=>record?.id!==excludeId&&String(record?.workspace_id||"default")===scope&&normalizePhone(record?.phone).normalized_e164===target.normalized_e164);
  }
  root.CriarePhoneIdentity={normalizePhone,comparableDigits,duplicateRecords,BRAZIL_DDDS};
})(typeof globalThis!=="undefined"?globalThis:window);
