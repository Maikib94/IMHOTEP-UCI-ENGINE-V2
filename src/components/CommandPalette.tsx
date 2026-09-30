// src/components/CommandPalette.tsx
//
// Paleta de comandos (Ctrl+K / Cmd+K).
//
// MOTIVO: el panel clinico llega a tener mas de 300 controles en pantalla y
// ~110 acciones repartidas en acordeones anidados, cuatro de ellos cerrados por
// defecto. Encontrar amiodarona o manitol exige saber de antemano en que
// categoria vive cada uno, y ese rodeo es tratamiento que no se esta dando.
// Aqui se teclea lo que se quiere —nombre, sinonimo o indicacion— y se ejecuta.
/* eslint-disable react/forbid-dom-props */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePharmacologyStore } from '../store/usePharmacologyStore';
import { buildCommands, commandFields, type Command, type PanelId } from '../data/commandCatalog';
import { fuzzyFilter } from '../utils/fuzzySearch';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenPanel: (panel: PanelId) => void;
}

export default function CommandPalette({ open, onClose, onOpenPanel }: CommandPaletteProps) {
  const setInfusionRate = usePharmacologyStore(s => s.setInfusionRate);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  const commands = useMemo(
    () => buildCommands({ setInfusionRate, openPanel: onOpenPanel }),
    [setInfusionRate, onOpenPanel],
  );

  const results = useMemo(
    () => fuzzyFilter(commands, query, commandFields, 40),
    [commands, query],
  );

  // Reabrir siempre en limpio: al que vuelve a abrirla le interesa buscar otra
  // cosa, no encontrarse la busqueda anterior.
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => { setCursor(0); }, [query]);

  // Mantener la fila activa a la vista al navegar con el teclado.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const runAt = (i: number) => {
    const cmd = results[i];
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown')      { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter')     { e.preventDefault(); runAt(cursor); }
    else if (e.key === 'Escape')    { e.preventDefault(); onClose(); }
  };

  // Agrupar conservando el orden por relevancia que trae fuzzyFilter.
  const grouped: { group: string; items: { cmd: Command; idx: number }[] }[] = [];
  results.forEach((cmd, idx) => {
    const last = grouped[grouped.length - 1];
    if (last && last.group === cmd.group) last.items.push({ cmd, idx });
    else grouped.push({ group: cmd.group, items: [{ cmd, idx }] });
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(2,6,14,0.72)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)', maxHeight: '72vh',
          display: 'flex', flexDirection: 'column',
          background: '#0b1220', border: '1px solid rgba(34,211,238,0.28)',
          borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <span style={{ color: '#22d3ee', fontSize: 13 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar fármaco, dosis o panel…  (p. ej. «adre», «paro», «sedación»)"
            aria-label="Buscar comando"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#e2e8f0', fontSize: 14,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}
          />
          <kbd style={{ fontSize: 9, color: '#475569', border: '1px solid #1e293b', borderRadius: 4, padding: '2px 5px' }}>ESC</kbd>
        </div>

        <div ref={listRef} style={{ overflowY: 'auto', padding: '6px 0' }}>
          {results.length === 0 && (
            <div style={{ padding: '22px 16px', textAlign: 'center', color: '#475569', fontSize: 12 }}>
              Nada coincide con «{query}»
            </div>
          )}

          {grouped.map(section => (
            <div key={`${section.group}-${section.items[0].idx}`}>
              <div style={{
                padding: '5px 14px 2px', fontSize: 9, fontWeight: 800,
                letterSpacing: '0.14em', color: '#475569',
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              }}>
                {section.group.toUpperCase()}
              </div>
              {section.items.map(({ cmd, idx }) => (
                <div
                  key={cmd.id}
                  data-idx={idx}
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => runAt(idx)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 14px', cursor: 'pointer',
                    background: idx === cursor ? 'rgba(34,211,238,0.10)' : 'transparent',
                    borderLeft: `2px solid ${idx === cursor ? '#22d3ee' : 'transparent'}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: idx === cursor ? '#e2e8f0' : '#cbd5e1', fontWeight: 600 }}>
                      {cmd.label}
                    </div>
                    {cmd.sublabel && (
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cmd.sublabel}
                      </div>
                    )}
                  </div>
                  {cmd.doseHint && (
                    <span style={{
                      fontSize: 9.5, color: '#22d3ee', fontWeight: 700,
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      border: '1px solid rgba(34,211,238,0.25)', borderRadius: 4,
                      padding: '2px 6px', whiteSpace: 'nowrap',
                    }}>
                      {cmd.doseHint}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{
          padding: '6px 14px', borderTop: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', gap: 14, fontSize: 9, color: '#475569',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        }}>
          <span>↑↓ navegar</span>
          <span>↵ ejecutar</span>
          <span style={{ marginLeft: 'auto' }}>{results.length} resultado{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
