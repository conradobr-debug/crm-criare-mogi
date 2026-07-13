(function(global){
  "use strict";

  function cleanText(value){
    return String(value || "")
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizedUiText(value){
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function messageHash(value){
    let hash = 2166136261;
    const text = String(value || "");
    for(let index=0; index<text.length; index+=1){
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function parsePrefix(value){
    const raw = cleanText(value);
    const match = raw.match(/^\[([^,\]]+),\s*([^\]]+)\]\s*([^:]+):\s*$/);
    if(!match) return {raw, time:"", date:"", author:""};
    return {
      raw,
      time:cleanText(match[1]),
      date:cleanText(match[2]),
      author:cleanText(match[3])
    };
  }

  function continuationPrefix(previousPrefix, visibleTime, explicitAuthor){
    const previous = parsePrefix(previousPrefix);
    const author = cleanText(explicitAuthor).replace(/:\s*$/, "") || previous.author || "Autor não identificado";
    const date = previous.date || "data não identificada";
    const time = cleanText(visibleTime) || previous.time || "horário não identificado";
    return `[${time}, ${date}] ${author}: `;
  }

  function normalizeEntry(entry){
    if(!entry) return null;
    if(typeof entry === "string"){
      const text = cleanText(entry);
      return text ? {id:null, text} : null;
    }
    const text = cleanText(entry.text);
    if(!text) return null;
    return {
      ...entry,
      id:cleanText(entry.id) || null,
      text,
      capturedAt:cleanText(entry.capturedAt) || null
    };
  }

  function mergeEntries(storedEntries, incomingEntries, maximum=10000){
    const stored = (Array.isArray(storedEntries) ? storedEntries : []).map(normalizeEntry).filter(Boolean);
    const incoming = (Array.isArray(incomingEntries) ? incomingEntries : []).map(normalizeEntry).filter(Boolean);
    const merged = stored.map(entry=>({...entry}));
    const indexById = new Map();
    merged.forEach((entry,index)=>{ if(entry.id) indexById.set(entry.id,index); });
    let addedCount = 0;
    let updatedCount = 0;

    for(const entry of incoming){
      if(entry.id && indexById.has(entry.id)){
        const index = indexById.get(entry.id);
        if(merged[index].text !== entry.text){
          merged[index] = {...merged[index], ...entry};
          updatedCount += 1;
        }
        continue;
      }
      if(!entry.id && merged.some(saved=>saved.text === entry.text)) continue;
      merged.push({...entry});
      if(entry.id) indexById.set(entry.id, merged.length - 1);
      addedCount += 1;
    }

    const limited = merged.length > maximum;
    const entries = limited ? merged.slice(-maximum) : merged;
    return {entries, addedCount, updatedCount, limited};
  }

  const api = {
    cleanText,
    normalizedUiText,
    messageHash,
    parsePrefix,
    continuationPrefix,
    normalizeEntry,
    mergeEntries
  };
  global.CriareWhatsAppCaptureCore = api;
  if(typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
