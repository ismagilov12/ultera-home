-- Additive ULTERA-only migration. No change to orders, prices or payment logic.
begin;
create table public.ulhome_order_journeys (
  order_id uuid primary key references public.ulhome_orders(id) on delete cascade,
  visitor_id uuid not null,
  checkout_id uuid,
  session_id text not null check (length(session_id) <= 100),
  first_touch jsonb not null default '{}'::jsonb,
  last_touch jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);
create index ulhome_order_journeys_visitor_idx on public.ulhome_order_journeys(visitor_id,captured_at desc);
create table public.ulhome_journey_events (
  event_id uuid primary key,
  visitor_id uuid not null,
  session_id text not null check(length(session_id)<=100),
  checkout_id uuid,
  order_id uuid references public.ulhome_orders(id) on delete set null,
  event_type text not null check(length(event_type)<=64),
  event_data jsonb not null default '{}'::jsonb check(octet_length(event_data::text)<=12000),
  page_path text not null default '/' check(length(page_path)<=160),
  source text not null check(source in ('browser','server')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index ulhome_journey_events_visitor_idx on public.ulhome_journey_events(visitor_id,occurred_at desc);
create index ulhome_journey_events_checkout_idx on public.ulhome_journey_events(checkout_id,occurred_at desc) where checkout_id is not null;
create index ulhome_journey_events_order_idx on public.ulhome_journey_events(order_id) where order_id is not null;
alter table public.ulhome_order_journeys enable row level security;
alter table public.ulhome_journey_events enable row level security;
revoke all on public.ulhome_order_journeys,public.ulhome_journey_events from public,anon,authenticated;
grant all on public.ulhome_order_journeys,public.ulhome_journey_events to service_role;
grant select on public.ulhome_order_journeys,public.ulhome_journey_events to authenticated;
create policy ulhome_order_journeys_admin_read on public.ulhome_order_journeys for select to authenticated using(public.ulhome_is_admin());
create policy ulhome_journey_events_admin_read on public.ulhome_journey_events for select to authenticated using(public.ulhome_is_admin());
comment on table public.ulhome_journey_events is 'ULTERA consented browser events; browser source is untrusted, order_saved is server-confirmed local order, not payment or CRM approval. No contacts.';
commit;
