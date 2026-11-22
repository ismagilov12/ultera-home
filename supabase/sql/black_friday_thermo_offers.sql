-- Separate fixed-price offers for two existing colours. Their original product
-- supplies availability. Only the photographed single pairs use sale_stock.
with offers(uid, source_uid, title, last_eu, position) as (
  values
    ('bfoffer-aganta-thermo-oreo', '550020261103', 'Aganta Thermo Oreo', '44', 16),
    ('bfoffer-hunk-thermo-black', '550020260917', 'Hunk Thermo Black', '45', 17)
)
insert into public.ulhome_products
  (uid, parent_id, family, title, color_name, color_hex, article, size_list,
   price, price_old, photo, category, brand, sort_order, published, feed_enabled)
select o.uid, p.id, 'SaleOstatki', o.title, p.color_name, p.color_hex, p.article,
       (select jsonb_agg(v order by v->>'eu') from jsonb_array_elements(p.size_list) v
         where v->>'eu' between '40' and o.last_eu),
       4890, p.price, p.photo, p.category, p.brand, o.position, false, false
from offers o join public.ulhome_products p on p.uid=o.source_uid
on conflict (uid) do nothing;
