// api/_keycrm_map.js — KeyCRM status → бізнес-група для аналітики
// Підключається з api/keycrm-sync.js. На фронт НЕ ходить.
//
// Джерело істини — таблиця Supabase `ulhome_keycrm_status_map` (editable з admin).
// Цей файл містить лише FALLBACK-дефолти на випадок якщо мапа порожня.

'use strict';

// Стандартні KeyCRM out-of-the-box статуси.
// status_id → { label, group }
// group ∈ 'approved' | 'pending' | 'rejected' | 'excluded'
const DEFAULT_STATUS_MAP = {
  1:  { label: 'Новий',         group: 'pending'  },
  2:  { label: 'Підтверджено',  group: 'approved' },
  3:  { label: 'У обробці',     group: 'approved' },
  4:  { label: 'Відправлено',   group: 'approved' },
  5:  { label: 'Виконано',      group: 'approved' },
  6:  { label: 'Скасовано',     group: 'rejected' },
  7:  { label: 'Відмова',       group: 'rejected' },
  8:  { label: 'Повернення',    group: 'rejected' },
  99: { label: 'Тест/Дубль',    group: 'excluded' }
};

const VALID_GROUPS = new Set(['approved', 'pending', 'rejected', 'excluded']);

async function loadStatusMapFromSupabase(supabaseUrl, serviceKey) {
  if (!supabaseUrl || !serviceKey) return null;
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/ulhome_keycrm_status_map?select=status_id,label,status_group`,
      {
        method: 'GET',
        headers: {
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Accept': 'application/json'
        }
      }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const map = {};
    for (const row of rows) {
      const sid = parseInt(row.status_id, 10);
      const grp = String(row.status_group || '').toLowerCase();
      if (!Number.isFinite(sid) || !VALID_GROUPS.has(grp)) continue;
      map[sid] = { label: String(row.label || '').trim() || 'unknown', group: grp };
    }
    return Object.keys(map).length ? map : null;
  } catch (e) {
    console.warn('[keycrm-map] supabase load failed', e.message);
    return null;
  }
}

// Класифікує KeyCRM-статус.
//   `statusId` — number (з KeyCRM order.status_id)
//   `rawStatusObj` — об'єкт зі вкладеним name (з KeyCRM order.status), опц.
//   `mapById` — об'єкт map (з loadStatusMapFromSupabase або DEFAULT_STATUS_MAP)
// Повертає { label, group } АБО null якщо взагалі немає інфо.
function classifyStatus(statusId, rawStatusObj, mapById) {
  const sid = parseInt(statusId, 10);
  if (Number.isFinite(sid) && mapById && mapById[sid]) {
    return { ...mapById[sid] };
  }
  // Fallback: якщо id невідомий, але є name — спробувати по назві
  const nameRaw = rawStatusObj && (rawStatusObj.name || rawStatusObj.title);
  if (nameRaw) {
    const name = String(nameRaw).toLowerCase().trim();
    // евристика по ключових словах
    if (/відправ|shipped|sent/.test(name))                 return { label: nameRaw, group: 'approved' };
    if (/виконан|completed|done|закрит/.test(name))        return { label: nameRaw, group: 'approved' };
    if (/підтвердж|confirmed|оформлен|approved/.test(name))return { label: nameRaw, group: 'approved' };
    if (/обробц|processing|підготов/.test(name))           return { label: nameRaw, group: 'approved' };
    if (/відмов|скасов|cancel|reject|deny/.test(name))     return { label: nameRaw, group: 'rejected' };
    if (/поверн|return|refund/.test(name))                 return { label: nameRaw, group: 'rejected' };
    if (/нов|new|необробл/.test(name))                     return { label: nameRaw, group: 'pending' };
    if (/тест|дубл|test|duplicate/.test(name))             return { label: nameRaw, group: 'excluded' };
    return { label: nameRaw, group: 'pending' }; // невідомий → pending
  }
  return null;
}

module.exports = {
  DEFAULT_STATUS_MAP,
  VALID_GROUPS,
  loadStatusMapFromSupabase,
  classifyStatus
};
