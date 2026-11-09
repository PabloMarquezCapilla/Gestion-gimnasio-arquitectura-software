import { useCallback, useEffect, useState } from 'react';
import {
  apiAccesosOcupacion, apiAccesosSedes, apiBuscarClases, apiComprasCaja, apiConsultarStockTienda,
  apiPlanesMembresia, apiSolicitudesMembresia,
} from '../services/api';
import type { ClaseCatalogo, PlanMembresia, SolicitudMembresia } from '../services/api';

const card = 'rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-2';
const link = 'text-xs font-semibold text-primary hover:underline';
const pesos = (minor: number) => (minor / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

// Cada bloque se carga por separado: si un servicio no responde, el resto del panel sigue disponible.
function useDato<T>(cargar: () => Promise<T>, revision: number) {
  const [estado, setEstado] = useState<{ dato?: T; error?: string }>({});
  useEffect(() => {
    let activo = true;
    setEstado({});
    cargar().then(dato => { if (activo) setEstado({ dato }); })
      .catch(e => { if (activo) setEstado({ error: e instanceof Error ? e.message : 'No disponible' }); });
    return () => { activo = false; };
  }, [cargar, revision]);
  return estado;
}

function Bloque<T>({ titulo, estado, ir, children }: { titulo: string; estado: { dato?: T; error?: string }; ir?: () => void; children: (dato: T) => React.ReactNode }) {
  return (
    <section className={card}>
      <div className="flex items-center justify-between"><h2 className="font-bold text-sm">{titulo}</h2>{ir && <button type="button" className={link} onClick={ir}>Ver más</button>}</div>
      {estado.error ? <p role="alert" className="text-xs text-error">{estado.error}</p>
        : estado.dato === undefined ? <p role="status" className="text-xs text-on-surface-variant">Consultando…</p>
        : children(estado.dato)}
    </section>
  );
}

export function PanelPrincipal({ onIr }: { onIr: (seccion: string) => void }) {
  const [revision, setRevision] = useState(0);
  const ocupacion = useDato(useCallback(async () => {
    const sedes = (await apiAccesosSedes()).items;
    return Promise.all(sedes.map(async s => ({ ...s, ocupacion: (await apiAccesosOcupacion(s.sedeId)).ocupacion })));
  }, []), revision);
  const cobros = useDato(useCallback(async () => (await apiSolicitudesMembresia(1)).items, []), revision);
  const planes = useDato(useCallback(async () => (await apiPlanesMembresia()).items, []), revision);
  const clases = useDato(useCallback(async () => (await apiBuscarClases({ orden: 'inicio_asc', tamanio: 5, desde: new Date().toISOString() })).items, []), revision);
  const tienda = useDato(useCallback(async () => {
    const [stock, caja] = await Promise.all([apiConsultarStockTienda(), apiComprasCaja(1)]);
    const hoy = new Date().toDateString();
    const deHoy = caja.items.filter(c => new Date(c.creadaEn).toDateString() === hoy);
    return { conStock: stock.items.filter(i => i.unidadesDisponibles > 0).length, sinStock: stock.items.filter(i => i.unidadesDisponibles === 0).length,
      comprasHoy: deHoy.length, ventasHoy: deHoy.reduce((t, c) => t + c.totalMinor, 0) };
  }, []), revision);

  return (
    <section className="py-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-headline text-2xl font-bold">Panel principal</h1>
        <button type="button" className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold hover:bg-surface-container-high" onClick={() => setRevision(r => r + 1)}>Actualizar</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Bloque titulo="Ocupación actual" estado={ocupacion} ir={() => onIr('accesos')}>
          {sedes => <>
            <p className="text-3xl font-bold text-primary">{sedes.reduce((t, s) => t + s.ocupacion, 0)} <span className="text-sm font-normal text-on-surface-variant">personas en el gimnasio</span></p>
            <ul className="text-xs space-y-1">{sedes.map(s => <li key={s.sedeId}>{s.nombre}: <strong>{s.ocupacion}</strong></li>)}</ul>
          </>}
        </Bloque>
        <Bloque titulo="Cobros pendientes" estado={cobros} ir={() => onIr('cobros-y-caja')}>
          {(items: SolicitudMembresia[]) => {
            const pendientes = items.filter(s => s.estado === 'PENDIENTE');
            return <>
              <p className="text-3xl font-bold text-primary">{pendientes.length} <span className="text-sm font-normal text-on-surface-variant">solicitudes por cobrar</span></p>
              <p className="text-xs">A cobrar: <strong>{pesos(pendientes.reduce((t, s) => t + s.importeMinor, 0))}</strong> · {pendientes.filter(s => s.pago).length} con cobro registrado sin confirmar</p>
            </>;
          }}
        </Bloque>
        <Bloque titulo="Tienda" estado={tienda} ir={() => onIr('tienda-stock')}>
          {t => <>
            <p className="text-3xl font-bold text-primary">{pesos(t.ventasHoy)} <span className="text-sm font-normal text-on-surface-variant">vendido hoy ({t.comprasHoy} compras)</span></p>
            <p className="text-xs">{t.conStock} variantes con stock · <span className={t.sinStock ? 'text-error font-semibold' : ''}>{t.sinStock} agotadas</span></p>
          </>}
        </Bloque>
        <Bloque titulo="Próximas clases" estado={clases} ir={() => onIr('clases-y-turnos')}>
          {(items: ClaseCatalogo[]) => items.length === 0 ? <p className="text-xs">No hay clases programadas.</p> :
            <ul className="text-xs space-y-1">{items.map(c => <li key={c.claseId} className="flex justify-between gap-2">
              <span>{new Date(c.inicio).toLocaleString('es-AR', { weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · {c.nombre}</span>
              <strong className={c.cuposDisponibles === 0 ? 'text-error' : ''}>{c.cuposDisponibles}/{c.capacidad}</strong>
            </li>)}</ul>}
        </Bloque>
        <Bloque titulo="Planes activos" estado={planes} ir={() => onIr('planes-y-tarifas')}>
          {(items: PlanMembresia[]) => <ul className="text-xs space-y-1">{items.filter(p => p.estado === 'ACTIVO').map(p => <li key={p.planId} className="flex justify-between"><span>{p.nombre}</span><strong>{pesos(p.importeMinor)}</strong></li>)}</ul>}
        </Bloque>
      </div>
    </section>
  );
}
