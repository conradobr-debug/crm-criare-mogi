-- Limites configuráveis para o plano diário de sugestões da IA.
-- Não cria compromissos externos nem envia mensagens.
alter table public.crm_config
  add column if not exists ai_daily_action_capacity jsonb not null default
  '{
    "default":{"max_actions":4,"max_minutes":120},
    "roles":{
      "admin":{"max_actions":3,"max_minutes":90},
      "manager":{"max_actions":4,"max_minutes":120},
      "member":{"max_actions":5,"max_minutes":150}
    },
    "users":{}
  }'::jsonb;

update public.crm_config
set ai_daily_action_capacity = coalesce(
  ai_daily_action_capacity,
  '{
    "default":{"max_actions":4,"max_minutes":120},
    "roles":{
      "admin":{"max_actions":3,"max_minutes":90},
      "manager":{"max_actions":4,"max_minutes":120},
      "member":{"max_actions":5,"max_minutes":150}
    },
    "users":{}
  }'::jsonb
)
where ai_daily_action_capacity is null;
