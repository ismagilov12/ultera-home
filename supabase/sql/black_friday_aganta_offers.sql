-- Independent Black Friday cards for the two standard Aganta colours.
-- Checkout prices these UIDs, while size availability comes from the original colours.
with offers(uid, source_uid, title, position) as (
  values
    ('bfoffer-aganta-aqva', '260203663062', 'Aganta Aqva', 18),
    ('bfoffer-aganta-salvia', '977627506822', 'Aganta Salvia', 19)
)
insert into public.ulhome_products
  (uid, parent_id, family, title, color_name, color_hex, article, size_list,
   price, price_old, photo, category, brand, sort_order, published, feed_enabled)
select o.uid, p.id, 'SaleOstatki', o.title, p.color_name, p.color_hex, p.article,
       (select jsonb_agg(v order by v->>'eu') from jsonb_array_elements(p.size_list) v
         where v->>'eu' in ('40','41','42','43','44','45')),
       3890, p.price, p.photo, p.category, p.brand, o.position, false, false
from offers o join public.ulhome_products p on p.uid=o.source_uid
where p.family='Aganta' and p.published is true
on conflict (uid) do nothing;
