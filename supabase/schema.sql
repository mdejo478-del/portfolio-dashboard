-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query > Run).
-- Creates the two tables the app needs: users and portfolios.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  verified boolean not null default false,
  verification_code text
);

-- One row per user, holding their full portfolio state as JSON
-- (mirrors the app's existing PortfolioData shape 1:1).
create table if not exists public.portfolios (
  user_id uuid primary key references public.users(id) on delete cascade,
  positions jsonb not null default '[]'::jsonb,
  trades jsonb not null default '[]'::jsonb,
  ledger jsonb not null default '{}'::jsonb,
  next_position_id integer not null default 0,
  next_trade_id integer not null default 0,
  updated_at timestamptz not null default now()
);

-- This app does its own authentication/authorization in the server layer
-- (custom signed-cookie sessions, not Supabase Auth), and the anon key is
-- only ever used from server-side code (never sent to the browser). RLS
-- policies keyed to auth.uid() wouldn't apply to this custom session model,
-- so we disable RLS here rather than write policies that don't match reality.
alter table public.users disable row level security;
alter table public.portfolios disable row level security;
