-- Mortgage Rates: Supabase schema
-- Run this in your Supabase project's SQL editor

create table if not exists rate_snapshots (
  id           bigint generated always as identity primary key,
  fetched_at   timestamptz not null default now(),
  source       text not null,
  label        text not null,
  rate         numeric(6,3),
  term_type    text,
  rate_type    text not null default 'purchase',  -- 'purchase' | 'refinance' | 'home_equity' | 'reference'
  bank_url     text,
  raw_snippet  text
);

create index if not exists rate_snapshots_fetched_at_idx on rate_snapshots (fetched_at desc);
create index if not exists rate_snapshots_source_fetched_at_idx on rate_snapshots (source, fetched_at desc);

-- Enable Row Level Security
alter table rate_snapshots enable row level security;

-- Allow public reads (anon key)
create policy "allow_anon_select"
  on rate_snapshots for select
  to anon
  using (true);

-- Allow anon inserts (lock this down in production — use a service role key via a Worker)
create policy "allow_anon_insert"
  on rate_snapshots for insert
  to anon
  with check (true);

-- Migration: add rate_type column to existing table
-- Run this if the table already exists:
-- alter table public.rate_snapshots add column if not exists rate_type text not null default 'purchase';
-- create index if not exists rate_snapshots_rate_type_idx on rate_snapshots (rate_type);
