(function(global){
  "use strict";
  function createWhatsAppDataService({supabaseClient,supabaseUrl,anonKey,getAccessToken}){
    if(!supabaseClient) throw new Error("Cliente Supabase não informado.");
    return {
      async conversationForRecord(recordId){
        const {data,error}=await supabaseClient.from("crm_whatsapp_conversations")
          .select("*,crm_whatsapp_accounts(display_phone_number,verified_name,coexistence_enabled,status)")
          .eq("record_id",recordId).order("last_message_at",{ascending:false}).limit(1).maybeSingle();
        if(error) throw error;return data||null;
      },
      async messages(conversationId,{offset=0,limit=60}={}){
        const pageSize=Math.max(1,Math.min(limit,100));
        const start=Math.max(0,Number(offset)||0);
        const query=supabaseClient.from("crm_whatsapp_messages")
          .select("id,meta_message_id,direction,message_type,body,status,message_timestamp,contact_name,crm_whatsapp_media(id,media_type,mime_type,file_name,size_bytes,storage_bucket,storage_path,download_status,transcription_status)")
          .eq("conversation_id",conversationId).order("message_timestamp",{ascending:false}).order("id",{ascending:false}).range(start,start+pageSize-1);
        const {data,error}=await query;if(error)throw error;return (data||[]).reverse();
      },
      async overview(){
        const {data,error}=await supabaseClient.from("crm_whatsapp_conversations")
          .select("match_status,analysis_status,new_messages_since_analysis,last_sync_at");
        if(error)throw error;
        const rows=data||[];
        return {total:rows.length,unmatched:rows.filter(row=>row.match_status==="unmatched").length,ambiguous:rows.filter(row=>row.match_status==="ambiguous").length,stale:rows.filter(row=>["stale","failed"].includes(row.analysis_status)||Number(row.new_messages_since_analysis)>0).length,latestSync:rows.map(row=>row.last_sync_at).filter(Boolean).sort().at(-1)||null};
      },
      async analysisHistory(recordId,limit=10){
        const {data,error}=await supabaseClient.from("crm_whatsapp_analysis_history")
          .select("id,status,triggered_by,model,last_message_id,message_count,error,started_at,completed_at")
          .eq("record_id",recordId).order("created_at",{ascending:false}).limit(limit);
        if(error)throw error;return data||[];
      },
      async refreshAnalysis(recordId){
        const token=await getAccessToken();
        const response=await fetch(`${supabaseUrl}/functions/v1/whatsapp-processor`,{method:"POST",headers:{"content-type":"application/json","apikey":anonKey,"authorization":`Bearer ${token}`},body:JSON.stringify({action:"analyze_record",record_id:recordId})});
        const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||"Não foi possível atualizar a análise.");return payload;
      },
      async mediaUrl(media,expiresIn=900){
        if(!media?.storage_path||media.download_status!=="stored")return null;
        const {data,error}=await supabaseClient.storage.from(media.storage_bucket||"crm-whatsapp-media").createSignedUrl(media.storage_path,expiresIn);
        if(error)throw error;return data?.signedUrl||null;
      }
    };
  }
  global.CriareWhatsAppDataService={create:createWhatsAppDataService};
})(window);
