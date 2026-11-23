'use strict';

// Write the campaign data as one SQL statement. Existing stock is never replenished on a retry.
const arrivals = require('../lib/black-friday-nov23.cjs');
const data = JSON.stringify([...arrivals.values()]).replaceAll("'", "''");
const sql = `WITH arrivals AS (
  SELECT * FROM jsonb_to_recordset('${data}'::jsonb)
    AS p(uid text, article text, title text, color text, season text, position integer,
         quantity integer, sizes jsonb, photo text)
), products AS (
  INSERT INTO public.ulhome_products
    (uid, family, title, color_name, article, category, size_list, price, photo, sort_order, published, feed_enabled)
  SELECT uid, 'SaleOstatki', title, color, article, concat_ws(';', 'Розпродаж', season),
         sizes, 1990, photo, position, false, false
  FROM arrivals
  ON CONFLICT (uid) DO NOTHING
)
INSERT INTO public.ulhome_sale_stock (uid, size, qty, title, price, sale_price)
SELECT p.uid, s->>'eu', p.quantity, p.title || ' · ' || p.color, 1990, 1990
FROM arrivals p CROSS JOIN LATERAL jsonb_array_elements(p.sizes) AS s
ON CONFLICT (uid, size) DO NOTHING;`;
if (require.main === module) process.stdout.write(sql + '\n');
