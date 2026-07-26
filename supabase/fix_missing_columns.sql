-- Run this once in the Supabase SQL Editor. Adds columns that are missing
-- from the tables (safe to re-run - IF NOT EXISTS guards every column).

alter table public.users
  add column if not exists verified boolean not null default false,
  add column if not exists verification_code text;

alter table public.portfolios
  add column if not exists ledger jsonb not null default '{}'::jsonb,
  add column if not exists next_position_id integer not null default 0,
  add column if not exists next_trade_id integer not null default 0;
