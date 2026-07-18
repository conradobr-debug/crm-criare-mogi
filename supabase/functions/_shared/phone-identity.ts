const BRAZIL_DDDS = new Set("11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(" "));

export type PhoneIdentity={raw_input:string;normalized_e164:string|null;country_code:string|null;national_number:string|null;is_valid:boolean;validation_reason:string;display_format:string};
function base(raw:unknown,patch:Partial<PhoneIdentity>={}):PhoneIdentity{return {raw_input:String(raw??""),normalized_e164:null,country_code:null,national_number:null,is_valid:false,validation_reason:"phone_missing",display_format:"",...patch};}
export function normalizePhone(raw:unknown):PhoneIdentity{
  const input=String(raw??"").trim();if(!input)return base(raw);
  const explicitPlus=input.startsWith("+");let digits=input.replace(/\D/g,"");if(input.startsWith("00"))digits=digits.slice(2);
  const brazil=!explicitPlus&&(digits.length===10||digits.length===11||([12,13].includes(digits.length)&&digits.startsWith("55")));
  if(brazil||(explicitPlus&&digits.startsWith("55"))){const national=digits.startsWith("55")?digits.slice(2):digits;const ddd=national.slice(0,2),subscriber=national.slice(2);if(!BRAZIL_DDDS.has(ddd))return base(raw,{country_code:"55",national_number:national,validation_reason:"invalid_brazilian_ddd"});const mobile=national.length===11&&subscriber.startsWith("9"),landline=national.length===10&&/^[2-5]/.test(subscriber);if(!mobile&&!landline)return base(raw,{country_code:"55",national_number:national,validation_reason:"invalid_brazilian_length_or_prefix"});return base(raw,{normalized_e164:`+55${national}`,country_code:"55",national_number:national,is_valid:true,validation_reason:"valid",display_format:national.length===11?`(${ddd}) ${subscriber.slice(0,5)}-${subscriber.slice(5)}`:`(${ddd}) ${subscriber.slice(0,4)}-${subscriber.slice(4)}`});}
  if(!explicitPlus)return base(raw,{national_number:digits,validation_reason:"international_country_code_required"});
  if(digits.length<8||digits.length>15||digits.startsWith("0"))return base(raw,{national_number:digits,validation_reason:"invalid_e164"});
  const cc=digits.length>=11?digits.slice(0,2):digits.slice(0,1);return base(raw,{normalized_e164:`+${digits}`,country_code:cc,national_number:digits.slice(cc.length),is_valid:true,validation_reason:"valid",display_format:`+${digits}`});
}
