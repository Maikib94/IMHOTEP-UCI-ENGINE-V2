// tests/unit/fuzzySearch.spec.ts
//
// La paleta solo sirve si encuentra lo que se busca tal y como se teclea con
// prisa: abreviado, sin tildes, por sinonimo o por la indicacion clinica.

import { describe, it, expect } from 'vitest';
import { normalize, fuzzyScore, fuzzyFilter } from '../../src/utils/fuzzySearch';
import { buildCommands, commandFields } from '../../src/data/commandCatalog';

/** Catalogo con dependencias inertes: aqui solo se prueba la busqueda. */
const commands = buildCommands({
  setInfusionRate: () => {},
  openPanel: () => {},
});
const find = (q: string, n = 5) =>
  fuzzyFilter(commands, q, commandFields, n).map(c => c.label);

describe('normalize', () => {
  it('quita tildes y mayusculas', () => {
    expect(normalize('Levosimendán')).toBe('levosimendan');
    expect(normalize('  FiO₂ ')).toBe('fio₂');
  });
});

describe('fuzzyScore', () => {
  it('puntua mas alto el prefijo que la subsecuencia dispersa', () => {
    const prefijo      = fuzzyScore('Adrenalina', 'adre');
    const subsecuencia = fuzzyScore('Dexmedetomidina', 'adre');
    expect(prefijo).toBeGreaterThan(subsecuencia);
  });

  it('encuentra el inicio de cualquier palabra', () => {
    expect(fuzzyScore('Azul de metileno', 'met')).toBeGreaterThan(0);
  });

  it('devuelve 0 cuando no casa', () => {
    expect(fuzzyScore('Propofol', 'xyz')).toBe(0);
  });

  it('una query vacia no descarta nada', () => {
    expect(fuzzyScore('lo que sea', '')).toBeGreaterThan(0);
  });
});

describe('Paleta de comandos', () => {
  it('«adre» encuentra Adrenalina la primera', () => {
    expect(find('adre')[0]).toBe('Adrenalina');
  });

  it('busca sin tildes', () => {
    expect(find('levosimendan').join(' ')).toContain('Levosimendan');
  });

  it('encuentra por sinonimo, no solo por el nombre del catalogo', () => {
    // Quien teclea "epinefrina" o "norepinefrina" debe llegar igual.
    expect(find('epinefrina', 8).join(' ')).toContain('Adrenalina');
    expect(find('norepinefrina', 8).join(' ')).toContain('Noradrenalina');
    expect(find('precedex', 8).join(' ')).toContain('Dexmedetomidina');
  });

  it('encuentra por indicacion clinica, sin saber el farmaco', () => {
    expect(find('paro', 8).join(' ')).toContain('Adrenalina');
    expect(find('convulsion', 8).join(' ')).toContain('Midazolam');
    expect(find('broncoespasmo', 8).join(' ')).toContain('Ketamina');
    expect(find('hic', 8).join(' ')).toContain('Tiopental');
  });

  it('tolera teclear de menos', () => {
    expect(find('cisa', 8).join(' ')).toContain('Cisatracurio');
    expect(find('dobu', 8).join(' ')).toContain('Dobutamina');
  });

  it('encuentra paneles ademas de farmacos', () => {
    expect(find('gasometria', 8).join(' ')).toContain('Laboratorio');
    expect(find('radiografia', 8).join(' ')).toContain('Estudios de imagen');
    expect(find('peep', 8).join(' ')).toContain('Ventilador (ARM)');
  });

  it('cada farmaco en infusion ofrece dosis de inicio y dosis alta', () => {
    const adre = commands.filter(c => c.id.startsWith('infusion:adrenaline'));
    expect(adre).toHaveLength(2);
    expect(adre.every(c => c.doseHint)).toBe(true);
  });

  it('sin query devuelve el catalogo, no vacio', () => {
    expect(fuzzyFilter(commands, '', commandFields, 100).length).toBeGreaterThan(20);
  });

  it('una busqueda sin coincidencias devuelve vacio', () => {
    expect(find('qwerty')).toHaveLength(0);
  });

  it('no arrastra coincidencias por casualidad', () => {
    // "paro" casa con "PancurOnio" como subsecuencia saltando media palabra.
    // Aceptarlo llenaba la lista de ruido y enterraba lo que si se busca.
    const r = find('paro', 20);
    expect(r).toContain('Adrenalina');
    expect(r.join(' ')).not.toContain('Pancuronio');
  });

  it('pero sigue tolerando erratas de teclado', () => {
    expect(find('adrenalna', 8).join(' ')).toContain('Adrenalina');
    expect(find('propofl', 8).join(' ')).toContain('Propofol');
  });
});
