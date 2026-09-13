from pathlib import Path
import re

path = Path('index.html')
s = path.read_text(encoding='utf-8')
original = s

# Replace the complete seasonal selector UI. Summer is removed.
pattern = re.compile(r'''      <div class="ms" id="m_season_wrap">.*?      </div>\n\n      <div class="ms">''', re.S)
replacement = '''      <div class="ms" id="m_season_wrap">
        <div class="ms-label">Версія · <b id="m_season_name">Осінь</b></div>
        <div class="mod-seasons" id="m_seasons">
          <button class="season-btn active" data-season="autumn" onclick="pickSeason(this,'autumn','Осінь')">
            <span class="season-ic" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 10.5a4.5 4.5 0 1 0-9 0 3.5 3.5 0 0 0-4 3.5 3.5 3.5 0 0 0 3.5 3.5H17a3 3 0 0 0 1-5.83V10.5z"/>
                <path d="M8 21l1-2M12 21l1-2M16 21l1-2"/>
              </svg>
            </span>
            <span class="season-txt"><b>Осінь</b><span>Вологостійка Cordura · поточна ціна</span></span>
          </button>
          <button class="season-btn" data-season="winter" onclick="pickSeason(this,'winter','Зимові термо · +1000 ₴')">
            <span class="season-ic" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2v20M4.2 6.5l15.6 11M19.8 6.5l-15.6 11"/>
                <path d="M12 2l-2 2M12 2l2 2M12 22l-2-2M12 22l2-2M4.2 6.5l2.7.2M4.2 6.5l.9 2.5M19.8 17.5l-2.7-.2M19.8 17.5l-.9-2.5M19.8 6.5l-2.7.2M19.8 6.5l-.9 2.5M4.2 17.5l2.7-.2M4.2 17.5l.9-2.5"/>
              </svg>
            </span>
            <span class="season-txt"><b>Зимові термо · +1000 ₴</b><span>Термо-підкладка · до −7°C</span></span>
          </button>
        </div>
      </div>

      <div class="ms">'''
s, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'season selector replacement count={n}, expected 1')

# Reset every newly opened seasonal product to Autumn.
reset_pattern = re.compile(r'''  // v178: __modalSeason.*?  \} catch\(_\)\{\}''', re.S)
reset_replacement = '''  // Seasonal choice must not leak between products. Default is Autumn at the current price.
  try {
    window.__modalSeason = 'autumn';
    document.querySelectorAll('.season-btn').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-season') === 'autumn');
    });
    var _sn = document.getElementById('m_season_name');
    if (_sn) _sn.textContent = 'Осінь';
  } catch(_){}'''
s, n = reset_pattern.subn(reset_replacement, s, count=1)
if n != 1:
    raise SystemExit(f'season reset replacement count={n}, expected 1')

# Simplify selected-version label; the old Spring promo exception is obsolete.
old_label = '''  if(n){
    const _promo = ['809858137952','924701650982','454860479882'].includes(String((window.__modalUid || currentColor || '')));
    n.textContent = (id === 'spring' && _promo) ? 'Весна / Осінь' : label;
  }'''
new_label = '''  if(n){
    n.textContent = label;
  }'''
if old_label not in s:
    raise SystemExit('pickSeason label block not found')
s = s.replace(old_label, new_label, 1)

s = s.replace(
    '  // перерахунок ціни (Весна +500 ₴)',
    '  // Перерахунок ціни: Осінь = поточна ціна, Зимові термо = +1000 ₴',
    1,
)

old_price_extra = "  const extra = (id === 'spring' && !['809858137952','924701650982','454860479882'].includes(String(p.uid))) ? 700 : 0;"
new_price_extra = "  const extra = id === 'winter' ? 1000 : 0;"
if old_price_extra not in s:
    raise SystemExit('pickSeason price uplift line not found')
s = s.replace(old_price_extra, new_price_extra, 1)

# Cart/order payload uses the same version ids and pricing.
old_cart = '''  // Season: summer (default) | spring (+500 UAH). Families without season selector
  // (SHAPE, Lite) fall through with summer/none.
  const NO_SEASON = ['SHAPE','Lite','Hunk Summer W','Thermo'];
  const canSeason = !NO_SEASON.includes(p.family);
  const seasonId   = canSeason ? (window.__modalSeason || 'summer') : null;
  const seasonLabel = seasonId === 'spring' ? 'Весна/Осінь' : (seasonId === 'summer' ? 'Літо' : '');
  const seasonExtra = seasonId === 'spring' && !['809858137952','924701650982','454860479882'].includes(String(p.uid)) ? 700 : 0;  // Cordura promo: selected UIDs have no uplift; authoritative total is in RPC'''
new_cart = '''  // Season: Autumn at the current price | Winter thermo (+1000 UAH).
  const NO_SEASON = ['SHAPE','Lite','Hunk Summer W','Thermo'];
  const canSeason = !NO_SEASON.includes(p.family);
  const seasonId   = canSeason ? (window.__modalSeason || 'autumn') : null;
  const seasonLabel = seasonId === 'winter' ? 'Зимові термо · до −7°C' : (seasonId === 'autumn' ? 'Осінь' : '');
  const seasonExtra = seasonId === 'winter' ? 1000 : 0;'''
if old_cart not in s:
    raise SystemExit('cart season block not found')
s = s.replace(old_cart, new_cart, 1)

required = [
    'data-season="autumn"',
    'data-season="winter"',
    'Зимові термо · +1000 ₴',
    'Термо-підкладка · до −7°C',
    "const extra = id === 'winter' ? 1000 : 0;",
    "const seasonExtra = seasonId === 'winter' ? 1000 : 0;",
    "window.__modalSeason = 'autumn';",
]
for token in required:
    if token not in s:
        raise SystemExit(f'missing verification token: {token}')

if s == original:
    raise SystemExit('index.html was not changed')
path.write_text(s, encoding='utf-8')
print('Patched index.html: Autumn current price; Winter thermo +1000 UAH, down to -7C')
