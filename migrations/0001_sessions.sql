create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  scenario_id text not null default 'roommate-conflict',
  topic text,
  difficulty text,
  started_at timestamptz,
  ended_at timestamptz,
  turns int,
  transcript jsonb not null,
  rubric jsonb,
  met int,
  models jsonb,
  app_version text,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_created on sessions (user_id, created_at desc);
