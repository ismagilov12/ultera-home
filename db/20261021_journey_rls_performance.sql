-- Same authorization predicate, evaluated once per query (InitPlan), not per row.
-- No changes to anonymous grants, identities, or the public legacy read policy.
begin;
alter policy analytics_events_admin_read on public.analytics_events using ((select public.ulhome_is_admin()));
alter policy ulhome_orders_admin_all on public.ulhome_orders using ((select public.ulhome_is_admin())) with check ((select public.ulhome_is_admin()));
alter policy ulhome_products_admin_all on public.ulhome_products using ((select public.ulhome_is_admin())) with check ((select public.ulhome_is_admin()));
alter policy ulhome_journey_events_admin_read on public.ulhome_journey_events using ((select public.ulhome_is_admin()));
alter policy ulhome_order_journeys_admin_read on public.ulhome_order_journeys using ((select public.ulhome_is_admin()));
create index ulhome_journey_events_type_time_idx on public.ulhome_journey_events(event_type,occurred_at desc);
commit;
