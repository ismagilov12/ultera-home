-- One separately photographed, fixed-size pair per campaign entry. Reapplying
-- catalogue data must never replenish a sold pair.
with catalogue(uid, position, model, colour, article, eu_size, price, photo, condition) as (
  values
    ('bf26-01-ua3-black-45', 1, 'Крос ЮА 3', 'Чорні', 'ЮА 3', '45', 1990, '/photos/black-friday/01-ua3-black-45.webp', null),
    ('bf26-02-ua11-blue-mesh-42', 2, 'Hunk3', 'Блакитна сітка', 'ЮА 11', '42', 1890, '/photos/black-friday/02-ua11-blue-mesh-42.webp', null),
    ('bf26-03-cros31-cordura-40', 3, 'CROS 31', 'Чорна Cordura · біла підошва', 'Крос 31', '40', 1790, '/photos/black-friday/03-cros31-cordura-40.webp', null),
    ('bf26-05-sp10-grey-suede-42', 5, 'Кеди СП10', 'Сіра замша', 'СП10', '42', 1990, '/photos/black-friday/05-sp10-grey-suede-42.webp', null),
    ('bf26-06-spider-mesh-41', 6, 'Spider', 'Чорна сітка · біла підошва', 'Паук', '41', 1790, '/photos/black-friday/06-spider-mesh-41.webp', null),
    ('bf26-07-slip-on-black-suede-42', 7, 'Сліпони', 'Чорна замша', null, '42', 999, '/photos/black-friday/07-slip-on-black-suede-42.webp', null),
    ('bf26-08-ua1-olive-mesh-44', 8, 'Hunk', 'Олива · сіра сітка', 'ЮА 1', '44', 1990, '/photos/black-friday/08-ua1-olive-mesh-44.webp', null),
    ('bf26-09-ua1-leo-cordura-40', 9, 'Hunk Leo', 'Леопардова Cordura', 'ЮА 1', '40', 1890, '/photos/black-friday/09-ua1-leo-cordura-40.webp', null),
    ('bf26-10-ua10-oreo-black-sole-42', 10, 'Aganta Oreo', 'Чорно-білі · чорна підошва', 'ЮА 10', '42', 1990, '/photos/black-friday/10-ua10-oreo-black-sole-42.webp', null),
    ('bf26-11-ua11-wine-cordura-42', 11, 'Hunk3', 'Бордова Cordura', 'ЮА 11', '42', 1890, '/photos/black-friday/11-ua11-wine-cordura-42.webp', null),
    ('bf26-12-ua1-pistachio-boot-42', 12, 'Черевики Hunk', 'Фісташкові', 'ЮА 1', '42', 2890, '/photos/black-friday/12-ua1-pistachio-boot-42.webp', null),
    ('bf26-13-ua10-black-boot-42', 13, 'Черевики Aganta', 'Чорні', 'ЮА 10', '42', 2890, '/photos/black-friday/13-ua10-black-boot-42.webp', 'Уцінка · некондиція'),
    ('bf26-14-ua1-mint-40', 14, 'Hunk', 'М’ятно-бірюзові', 'ЮА 1', '40', 1990, '/photos/black-friday/14-ua1-mint-40.webp', null),
    ('bf26-15-ua1-black-high-top-40', 15, 'Високі кеди Hunk', 'Чорні · коричневий протектор', 'ЮА 1', '40', 1890, '/photos/black-friday/15-ua1-black-high-top-40.webp', null)
), products as (
  insert into public.ulhome_products
    (uid, family, title, color_name, article, size_list, price, photo, mark, sort_order, published, feed_enabled)
  select uid, 'SaleOstatki', model, colour, article,
         jsonb_build_array(jsonb_build_object('eu', eu_size)), price, photo, condition, position, false, false
  from catalogue
  on conflict (uid) do nothing
)
insert into public.ulhome_sale_stock (uid, size, qty, title, price, sale_price)
select uid, eu_size, 1, model || ' · ' || colour, price, price from catalogue
on conflict (uid, size) do nothing;

-- Only a final order claims stock. PostgreSQL rolls back every claim if even
-- one pair is unavailable. Consistent lock order also permits mixed carts.
create or replace function public.ulhome_reserve_black_friday_pairs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pair record;
begin
  for pair in
    select item->>'uid' as uid, item->>'size' as size,
           count(*) = 1 and bool_and(coalesce(item->>'qty','1') = '1') as single_pair
    from jsonb_array_elements(new.items) as lines(item)
    where item->>'uid' like 'bf26-%'
    group by item->>'uid', item->>'size'
    order by item->>'uid', item->>'size'
  loop
    if not pair.single_pair then
      raise exception 'black_friday_unavailable';
    end if;
    update public.ulhome_sale_stock
       set qty = qty - 1, updated_at = now()
     where uid = pair.uid and size = pair.size and qty >= 1;
    if not found then
      raise exception 'black_friday_unavailable';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.ulhome_reserve_black_friday_pairs() from public, anon, authenticated;

create trigger ulhome_black_friday_reserve
before insert on public.ulhome_orders
for each row when (new.status = 'new' and new.items @? '$[*] ? (@.uid like_regex "^bf26-")')
execute function public.ulhome_reserve_black_friday_pairs();
