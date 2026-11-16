// src/components/hemato/HematologyPanel.tsx
//
// Panel de lectura hematológica.
//
// El laboratorio ya informaba plaquetas, fibrinógeno, INR y dímero-D, cada uno
// en su analítica y con su rango al lado. Pero la hematología crítica, igual
// que el PiCCO, no se lee variable a variable: se lee CRUZÁNDOLAS. Unas
// plaquetas de 15.000 no dicen nada por sí solas — con fibrinógeno normal son
// una microangiopatía y transfundir está contraindicado; con fibrinógeno de 80
// son una CID y la transfusión está indicada si sangra. El mismo número, la
// conducta contraria. Este panel pone las cuatro variables juntas, calcula los
// dos scores que deciden y dice qué patrón resulta.
//
// DOS DECISIONES DELIBERADAS
//
//   1. El panel lee las analíticas RESULTADAS, no el estado vivo del paciente.
//      Es más trabajo y es lo correcto: el proyecto modela con cuidado el
//      tiempo de respuesta del laboratorio —cada prueba con su demora, los
//      urgentes saturando la cola, la muestra congelando los valores del
//      instante de la extracción— y un panel que leyera las plaquetas vivas
//      regalaría información que nadie ha pedido, convirtiendo ese modelo en
//      decorado. Si no hay hemograma, el panel lo dice, igual que el del PiCCO
//      exige una termodilución antes de interpretar nada. Lo que no se ha
//      medido se muestra como «—» y no se interpreta.
//
//   2. El aviso de contraindicación de plaquetas se muestra SIEMPRE, con el
//      modo docente apagado. El resto del panel esconde el razonamiento porque
//      leer el patrón es el ejercicio; pero eso es una ayuda pedagógica, y la
//      contraindicación es una advertencia de daño. Esconder un «esto empeora
//      al paciente» detrás de un botón sería convertir la didáctica en trampa.
/* eslint-disable react/forbid-dom-props */

import React, { useState } from 'react';
import { useShallow }       from 'zustand/react/shallow';
import { usePatientStore }   from '../../store/usePatientStore';
import { usePathologyStore } from '../../store/usePathologyStore';
import { useTimeStore }      from '../../store/useTimeStore';
import {
  interpretHemato, HEMATO_RANGES, HEMATO_CUTOFFS,
  type Severity, type HematoContext,
} from '../../core/hematoInterpretation';
import {
  readHematoLabs, hematoSnapshotFromLabs, hasMinimumLabs,
} from '../../core/hematoLabReader';

const TONE: Record<Severity, { fg: string; bg: string; border: string }> = {
  ok:    { fg: '#34d399', bg: 'rgba(52,211,153,0.07)',  border: 'rgba(52,211,153,0.28)' },
  warn:  { fg: '#fbbf24', bg: 'rgba(251,191,36,0.07)',  border: 'rgba(251,191,36,0.30)' },
  alert: { fg: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.32)' },
};

function Block({ tone, title, body, caption }: {
  tone: Severity; title: string; body: string; caption?: string;
}) {
  const t = TONE[tone];
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 7,
      padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{
        fontSize: '0.4rem', fontWeight: 900, letterSpacing: '0.14em',
        color: '#64748b', fontFamily: 'ui-monospace, monospace',
      }}>
        {title}
      </div>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, color: t.fg, lineHeight: 1.25 }}>
        {body}
      </div>
      {caption && (
        <div style={{ fontSize: '0.44rem', color: '#94a3b8', lineHeight: 1.45 }}>
          {caption}
        </div>
      )}
    </div>
  );
}

/** Antigüedad de la muestra en formato corto. Importa: un fibrinógeno de hace
 *  seis horas en una CID activa no describe al paciente de ahora. */
function fmtAge(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return h < 24 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} d`;
}

/** Una celda del cuadro: valor, unidad y rango, con el tono del flag.
 *  Sin `measured`, la celda se apaga y muestra «—»: ese analito no se ha
 *  pedido, y el panel no va a inventarlo. */
function Cell({ label, value, unit, range, tone, measured, ageMin }: {
  label: string; value: string; unit: string; range: string; tone: Severity;
  measured: boolean; ageMin?: number;
}) {
  const t = TONE[tone];
  const fg     = measured ? t.fg     : '#475569';
  const bg     = measured ? t.bg     : 'rgba(255,255,255,0.02)';
  const border = measured ? t.border : 'rgba(255,255,255,0.07)';
  return (
    <div style={{
      background: bg, border: `1px ${measured ? 'solid' : 'dashed'} ${border}`,
      borderRadius: 6,
      padding: '4px 5px', display: 'flex', flexDirection: 'column', gap: 1,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: '0.37rem', fontWeight: 900, letterSpacing: '0.1em',
        color: '#64748b', fontFamily: 'ui-monospace, monospace',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '0.7rem', fontWeight: 800, color: fg, lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {measured ? value : '—'}
        {measured && (
          <span style={{ fontSize: '0.38rem', fontWeight: 600, color: '#64748b', marginLeft: 2 }}>
            {unit}
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.35rem', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
        {measured
          ? (ageMin !== undefined && ageMin >= 1 ? `${range} · hace ${fmtAge(ageMin)}` : range)
          : 'sin solicitar'}
      </div>
    </div>
  );
}

/** Tono según rango: por debajo, por encima, o dentro. */
function band(v: number, low: number, high: number, critLow?: number, critHigh?: number): Severity {
  if (critLow !== undefined && v < critLow) return 'alert';
  if (critHigh !== undefined && v > critHigh) return 'alert';
  if (v < low || v > high) return 'warn';
  return 'ok';
}

function ScoreRow({ title, total, max, verdict, detail, tone, teach }: {
  title: string; total: number; max: number; verdict: string;
  detail: string; tone: Severity; teach: boolean;
}) {
  const t = TONE[tone];
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 7,
      padding: '5px 8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span style={{
          fontSize: '0.4rem', fontWeight: 900, letterSpacing: '0.12em',
          color: '#64748b', fontFamily: 'ui-monospace, monospace',
        }}>
          {title}
        </span>
        <span style={{
          fontSize: '0.66rem', fontWeight: 800, color: t.fg,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {total}<span style={{ fontSize: '0.42rem', color: '#64748b' }}>/{max}</span>
        </span>
      </div>
      <div style={{ fontSize: '0.46rem', fontWeight: 700, color: t.fg, lineHeight: 1.3 }}>
        {verdict}
      </div>
      {teach && (
        <div style={{ fontSize: '0.42rem', color: '#94a3b8', lineHeight: 1.45, marginTop: 1 }}>
          {detail}
        </div>
      )}
    </div>
  );
}

export default function HematologyPanel() {
  const [teach, setTeach] = useState(false);
  const labOrders   = usePatientStore(s => s.labOrders);
  const simElapsed  = useTimeStore(s => s.simulatedElapsed);
  const temperature = usePatientStore(s => s.vitals.temperature);
  // Selección superficial campo a campo, no el slice entero: HematologyEngine
  // escribe en el store dentro del tick, y suscribirse al objeto completo
  // re-renderizaba el panel con cada referencia nueva.
  const hema = usePathologyStore(useShallow(s => ({
    subtype: s.hematologic.subtype,
    microthrombosis: s.hematologic.microthrombosis,
    heparinExposureH: s.hematologic.heparinExposureH,
    plasmaExchangeSessions: s.hematologic.plasmaExchangeSessions,
    plasmaExchangeActive: s.hematologic.plasmaExchangeActive,
  })));
  const sepsisActive   = usePathologyStore(s => s.sepsis.isActive);
  const sepsisSeverity = usePathologyStore(s => s.sepsis.severity);
  const pexOn  = hema.plasmaExchangeActive;
  const setPlasmaExchange = usePathologyStore(s => s.setPlasmaExchange);

  // Todo lo analítico sale de las pruebas resultadas. El ADAMTS13 también: es
  // el dato que más tarda y la lección entera del caso es que no se puede
  // esperar a tenerlo para empezar el recambio plasmático, así que verlo sin
  // haberlo pedido arruinaría el ejercicio.
  const labs = readHematoLabs(labOrders);
  const snap = hematoSnapshotFromLabs(labs);
  const ageMin = (m?: { drawnAtSimS: number }) =>
    m ? Math.max(0, (simElapsed - m.drawnAtSimS) / 60) : undefined;

  if (!hasMinimumLabs(labs)) {
    return (
      <div style={{
        padding: '10px 12px', border: '1px dashed rgba(255,255,255,0.10)',
        borderRadius: 8, color: '#475569', fontSize: '0.5rem', textAlign: 'center',
        lineHeight: 1.5,
      }}>
        Solicite un hemograma para obtener la lectura hematológica.
        <div style={{ fontSize: '0.42rem', color: '#334155', marginTop: 3 }}>
          Coagulación, dímero-D, perfil de hemólisis y ADAMTS13 completan el cuadro.
        </div>
      </div>
    );
  }

  // El contexto es lo que ningún analito dice por sí mismo. Se deriva de lo que
  // el motor ya modela, para no pedirle al usuario datos que la simulación ya
  // conoce — y para que el score 4T mida la caída real y no una supuesta.
  const ctx: HematoContext = {
    // Las plaquetas de partida del paciente sano; el escenario de HIT arranca
    // con el nadir hecho, así que la caída se mide contra el basal normal.
    baselinePlateletsK: 230,
    heparinExposureH: hema.heparinExposureH,
    // La microtrombosis ES la trombosis demostrada en este modelo.
    newThrombosis: hema.microthrombosis > 0.35,
    // Una sepsis activa es la otra causa de trombopenia por excelencia, y es
    // justamente la cuarta T del score.
    otherCauseLikely: sepsisActive && sepsisSeverity > 0.4
                      && hema.subtype !== 'hit',
    activeBleeding: snap.inr > 2.0 && snap.plateletsK < 50,
    fever: temperature >= 38.0,
  };

  const r = interpretHemato(snap, ctx);

  const R = HEMATO_RANGES;
  const phenotypeTone: Severity =
    r.phenotype === 'equilibrio' ? 'ok'
    : r.phenotype === 'mixto'    ? 'warn'
    : 'alert';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '0.4rem', fontWeight: 900, letterSpacing: '0.16em',
          color: '#64748b', fontFamily: 'ui-monospace, monospace',
        }}>
          LECTURA HEMATOLÓGICA
        </span>
        <button
          type="button"
          onClick={() => setTeach(x => !x)}
          title={teach
            ? 'Ocultar el razonamiento y el plan'
            : 'Modo docente: mostrar por qué y qué hacer'}
          style={{
            padding: '1px 6px', borderRadius: 4, cursor: 'pointer',
            background: teach ? 'rgba(220,38,38,0.14)' : 'transparent',
            border: `1px solid ${teach ? 'rgba(248,113,113,0.42)' : 'rgba(255,255,255,0.10)'}`,
            color: teach ? '#f87171' : '#475569',
            fontSize: '0.38rem', fontWeight: 700, fontFamily: 'ui-monospace, monospace',
          }}
        >
          {teach ? 'DOCENTE ON' : 'DOCENTE'}
        </button>
      </div>

      {/* ── Cuadro de consumo ───────────────────────────────────────────────
          Las cuatro variables que deciden, juntas y a la vez. Separadas en
          tres analíticas distintas era imposible ver que el fibrinógeno
          acompaña o no a las plaquetas, que es toda la lectura. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
        <Cell label="PLAQUETAS" value={Math.round(snap.plateletsK).toString()} unit="K/µL"
          range={`${R.platelets.low}–${R.platelets.high}`}
          tone={band(snap.plateletsK, R.platelets.low, R.platelets.high, 50)}
          measured={!!labs.plateletsK} ageMin={ageMin(labs.plateletsK)} />
        <Cell label="FIBRINÓGENO" value={Math.round(snap.fibrinogenMgDl).toString()} unit="mg/dL"
          range={`${R.fibrinogen.low}–${R.fibrinogen.high}`}
          tone={band(snap.fibrinogenMgDl, R.fibrinogen.low, R.fibrinogen.high, HEMATO_CUTOFFS.fibrinogenReplace)}
          measured={!!labs.fibrinogenMgDl} ageMin={ageMin(labs.fibrinogenMgDl)} />
        <Cell label="INR" value={snap.inr.toFixed(2)} unit=""
          range={`${R.inr.low}–${R.inr.high}`}
          tone={band(snap.inr, R.inr.low, R.inr.high, undefined, 2.0)}
          measured={!!labs.inr} ageMin={ageMin(labs.inr)} />
        <Cell label="DÍMERO-D" value={Math.round(snap.dDimerNgMl).toLocaleString('es')} unit="ng/mL"
          range={`< ${R.dDimer.high}`}
          tone={band(snap.dDimerNgMl, 0, R.dDimer.high, undefined, 3000)}
          measured={!!labs.dDimerNgMl} ageMin={ageMin(labs.dDimerNgMl)} />
      </div>

      {/* ── Bloque de microangiopatía ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
        <Cell label="LDH" value={Math.round(snap.ldhUl).toString()} unit="U/L"
          range={`${R.ldh.low}–${R.ldh.high}`}
          tone={band(snap.ldhUl, R.ldh.low, R.ldh.high, undefined, 1000)}
          measured={!!labs.ldhUl} ageMin={ageMin(labs.ldhUl)} />
        <Cell label="HAPTOGLOBINA" value={Math.round(snap.haptoglobinMgDl).toString()} unit="mg/dL"
          range={`${R.haptoglobin.low}–${R.haptoglobin.high}`}
          tone={band(snap.haptoglobinMgDl, R.haptoglobin.low, R.haptoglobin.high, 10)}
          measured={!!labs.haptoglobinMgDl} ageMin={ageMin(labs.haptoglobinMgDl)} />
        <Cell label="ESQUISTOCITOS"
          value={['Ausentes', '+', '++', '+++'][Math.round(Math.max(0, Math.min(3, snap.schistocytes)))]}
          unit="" range="ausentes"
          tone={snap.schistocytes >= 2 ? 'alert' : snap.schistocytes >= 1 ? 'warn' : 'ok'}
          measured={!!labs.schistocytes} ageMin={ageMin(labs.schistocytes)} />
        <Cell label="ADAMTS13" value={snap.adamts13Pct.toFixed(0)} unit="%"
          range={`> ${R.adamts13.low}`}
          tone={band(snap.adamts13Pct, R.adamts13.low, 150, HEMATO_CUTOFFS.adamts13Deficient)}
          measured={!!labs.adamts13Pct} ageMin={ageMin(labs.adamts13Pct)} />
      </div>

      {/* ── Aviso de contraindicación — SIEMPRE visible ───────────────────
          No depende del modo docente: es una advertencia de daño, no una
          pista. Ver la nota de cabecera. */}
      {!r.plateletTransfusionSafe && (
        <div style={{
          border: '1px solid rgba(248,113,113,0.55)', borderRadius: 7,
          background: 'rgba(127,29,29,0.28)', padding: '6px 8px',
          display: 'flex', gap: 6, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: '0.7rem', lineHeight: 1 }}>🚫</span>
          <div>
            <div style={{
              fontSize: '0.44rem', fontWeight: 900, letterSpacing: '0.1em',
              color: '#fca5a5', fontFamily: 'ui-monospace, monospace', marginBottom: 2,
            }}>
              NO TRANSFUNDIR PLAQUETAS
            </div>
            <div style={{ fontSize: '0.45rem', color: '#fecaca', lineHeight: 1.45 }}>
              {r.plateletTransfusionWhy}
            </div>
          </div>
        </div>
      )}

      <Block tone={r.profileSeverity} title="PATRÓN"
        body={r.profileLabel} caption={teach ? r.profileWhy : undefined} />

      <Block tone={r.hemolysisSeverity} title="HEMÓLISIS"
        body={r.hemolysisLabel} caption={teach ? r.hemolysisWhy : undefined} />

      <Block tone={phenotypeTone} title="¿SANGRA O TROMBOSA?"
        body={r.phenotypeLabel} caption={teach ? r.phenotypeWhy : undefined} />

      {/* ── Scores ──────────────────────────────────────────────────────── */}
      <ScoreRow
        title="ISTH (CID)" total={r.isth.total} max={8}
        verdict={r.isth.overt ? 'CID overt (≥ 5)' : 'No cumple criterio de CID overt'}
        detail={r.isth.detail} teach={teach}
        tone={r.isth.overt ? 'alert' : r.isth.total >= 3 ? 'warn' : 'ok'} />

      {ctx.heparinExposureH > 0 && (
        <ScoreRow
          title="4T (HIT)" total={r.fourT.total} max={8}
          verdict={`Probabilidad ${r.fourT.probability} · día ${(ctx.heparinExposureH / 24).toFixed(1)} de heparina`}
          detail={r.fourT.detail} teach={teach}
          tone={r.fourT.total >= 6 ? 'alert' : r.fourT.total >= 4 ? 'warn' : 'ok'} />
      )}

      {/* ── Recambio plasmático ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setPlasmaExchange(!pexOn)}
        style={{
          padding: '4px 8px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
          background: pexOn ? 'rgba(52,211,153,0.10)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${pexOn ? 'rgba(52,211,153,0.40)' : 'rgba(255,255,255,0.10)'}`,
          color: pexOn ? '#6ee7b7' : '#64748b',
          fontSize: '0.46rem', fontWeight: 700, fontFamily: 'ui-monospace, monospace',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
        }}
      >
        <span>PLASMAFÉRESIS {pexOn ? 'EN CURSO' : 'DETENIDA'}</span>
        <span style={{ fontSize: '0.4rem', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
          {hema.plasmaExchangeSessions} sesion{hema.plasmaExchangeSessions === 1 ? '' : 'es'}
        </span>
      </button>

      {teach && r.actions.length > 0 && (
        <div style={{
          border: '1px solid rgba(248,113,113,0.22)', borderRadius: 7,
          background: 'rgba(248,113,113,0.05)', padding: '6px 8px',
        }}>
          <div style={{
            fontSize: '0.4rem', fontWeight: 900, letterSpacing: '0.14em',
            color: '#b91c1c', fontFamily: 'ui-monospace, monospace', marginBottom: 3,
          }}>
            CONDUCTA SUGERIDA
          </div>
          {r.actions.map((a, i) => (
            <div key={i} style={{
              fontSize: '0.46rem', color: '#fecaca', lineHeight: 1.5,
              display: 'flex', gap: 5,
            }}>
              <span style={{ color: '#b91c1c' }}>{i + 1}.</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
