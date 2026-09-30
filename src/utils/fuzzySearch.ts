// src/utils/fuzzySearch.ts
//
// Busqueda tolerante para la paleta de comandos.
//
// Tiene que aguantar como se teclea de verdad con prisa: sin tildes
// ("adrenalina" tecleado "adre"), por sinonimo ("epinefrina"), por la
// indicacion en vez del nombre ("paro" -> adrenalina) y con letras sueltas
// de mas o de menos. Por eso acepta subsecuencias y no solo subcadenas.

/** Minusculas y sin diacriticos, para que "Adrenalina" case con "adre". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Puntua como de bien `query` describe a `text`. 0 = no casa.
 *
 * La escala premia, de mayor a menor: coincidencia exacta, prefijo, inicio de
 * palabra, subcadena en cualquier posicion y, por ultimo, subsecuencia. Asi
 * "adre" pone Adrenalina por delante de Dexmedetomidina, que tambien la
 * contiene como subsecuencia pero de forma dispersa.
 */
export function fuzzyScore(text: string, query: string): number {
  const t = normalize(text);
  const q = normalize(query);
  if (!q) return 1;
  if (!t) return 0;

  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - t.length;

  // Inicio de cualquier palabra: "met" en "Azul Metileno".
  const atWordStart = t.split(/[\s\-/(),.]+/).some(w => w.startsWith(q));
  if (atWordStart) return 800 - t.length;

  const idx = t.indexOf(q);
  if (idx >= 0) return 700 - idx - t.length * 0.1;

  // Subsecuencia: las letras de q aparecen en orden, no necesariamente
  // juntas. Cuanto mas compacta sea la traza, mejor puntua.
  let ti = 0, first = -1, last = -1, hits = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    if (first < 0) first = found;
    last = found;
    ti = found + 1;
    hits++;
  }
  if (hits < q.length) return 0;

  // Una traza muy dispersa no es una errata, es una casualidad: "paro" casa
  // con "PancurOnio" saltando media palabra. Aceptarla llenaba la lista de
  // resultados que nadie busca y enterraba el que si. Se admite el margen
  // justo para las erratas de teclado ("adrenalna" sobre "Adrenalina").
  const spread = last - first + 1;
  if (spread > q.length * 1.6) return 0;

  return Math.max(1, 400 - spread * 4 - first);
}

export interface Scored<T> { item: T; score: number }

/**
 * Filtra y ordena por relevancia. `fields` devuelve los textos por los que
 * cada elemento puede encontrarse (nombre, sinonimos, indicacion, grupo);
 * se queda con el mejor de todos.
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly string[],
  limit = 40,
): T[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);

  const scored: Scored<T>[] = [];
  for (const item of items) {
    let best = 0;
    for (const f of fields(item)) {
      const s = fuzzyScore(f, q);
      if (s > best) best = s;
    }
    if (best > 0) scored.push({ item, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.item);
}
