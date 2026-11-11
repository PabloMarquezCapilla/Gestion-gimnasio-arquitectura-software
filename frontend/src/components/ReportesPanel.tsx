import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from './PageHeader';
import { apiResumenCompras, apiResumenMembresias } from '../services/api';
import type { ResumenComprasAdmin, ResumenMembresias } from '../services/api';

const card = 'rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3';
const pesos = (minor: number) => (minor / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
const dinero = (minor: number, moneda: string) => {
  const formato = new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda });
  return formato.format(minor / 10 ** (formato.resolvedOptions().maximumFractionDigits ?? 2));
};
const nombreMes = (mes: string) => new Date(mes + '-15T12:00:00Z').toLocaleDateString('es-AR', {
  month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires',
});

function ultimosMeses(mesActual: string, n = 6): string[] {
  const [anio, mes] = mesActual.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(Date.UTC(anio, mes - 1 - (n - 1 - i), 1));
    return m.toISOString().slice(0, 7);
  });
}

function Barras({ filas }: { filas: { etiqueta: string; valor: number; texto: string }[] }) {
  const max = Math.max(1, ...filas.map(f => f.valor));
  return (
    <ul className="space-y-2">{filas.map(f => (
      <li key={f.etiqueta} className="text-xs">
        <div className="flex justify-between"><span className="capitalize">{f.etiqueta}</span><strong>{f.texto}</strong></div>
        <div className="h-2 rounded bg-surface-container"><div className="h-2 rounded bg-primary" style={{ width: `${(f.valor / max) * 100}%` }} /></div>
      </li>
    ))}</ul>
  );
}

// Cada propietario agrega todos sus registros en una consulta, con calendario de Argentina.
export function ReportesPanel() {
  const [datos, setDatos] = useState<{ membresias: ResumenMembresias; compras: ResumenComprasAdmin } | null>(null);
  const [error, setError] = useState('');
  const cargaActual = useRef(0);
  const cargar = useCallback(async () => {
    const carga = ++cargaActual.current;
    setDatos(null); setError('');
    try {
      const [membresias, compras] = await Promise.all([apiResumenMembresias(), apiResumenCompras()]);
      if (carga === cargaActual.current) setDatos({ membresias, compras });
    } catch (e) { if (carga === cargaActual.current) setError(e instanceof Error ? e.message : 'No se pudieron calcular los reportes.'); }
  }, []);
  useEffect(() => { void cargar(); return () => { cargaActual.current++; }; }, [cargar]);

  const mesesMembresias = datos ? ultimosMeses(datos.membresias.mesActual) : [];
  const mesesTienda = datos ? ultimosMeses(datos.compras.mesActual) : [];
  const grafana = `${window.location.protocol}//${window.location.hostname === 'localhost' ? 'localhost:3001' : 'grafana.' + window.location.host}`;

  return (
    <section className="app-page">
      <PageHeader eyebrow="ANÁLISIS" title="Reportes"
        description="Revisá los ingresos por membresías y las ventas registradas en la tienda."
        action={<button type="button" className="app-button" onClick={() => void cargar()}>Actualizar</button>} />
      <p className="text-sm">Ingresos y ventas de los últimos 6 meses, según el calendario de Argentina. El estado técnico del sistema (errores, latencia, réplicas) está en el <a className="text-primary underline" href={grafana} target="_blank" rel="noreferrer">tablero de Grafana</a>.</p>
      {error && <p role="alert" className="text-error">{error}</p>}
      {!datos && !error && <p role="status">Calculando reportes…</p>}
      {datos && <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="font-bold">Ingresos por membresías (pagos confirmados)</h2>
          {datos.membresias.ingresosPeriodo.length === 0 && <p>Sin pagos confirmados en los últimos seis meses.</p>}
          {datos.membresias.ingresosPeriodo.map(total => <div key={total.moneda}>
            <p className="text-2xl font-bold text-primary">{dinero(total.importeMinor, total.moneda)}</p>
            <Barras filas={mesesMembresias.map(mes => {
              const valor = datos.membresias.ingresosMensuales.find(i => i.mes === mes && i.moneda === total.moneda)?.importeMinor ?? 0;
              return { etiqueta: nombreMes(mes), valor, texto: dinero(valor, total.moneda) };
            })} />
          </div>)}
        </section>
        <section className={card}>
          <h2 className="font-bold">Ventas de la tienda (compras de socios)</h2>
          <p className="text-2xl font-bold text-primary">{pesos(datos.compras.mensuales.reduce((suma, mes) => suma + mes.importeMinor, 0))}</p>
          <Barras filas={mesesTienda.map(mes => {
            const valor = datos.compras.mensuales.find(i => i.mes === mes)?.importeMinor ?? 0;
            return { etiqueta: nombreMes(mes), valor, texto: pesos(valor) };
          })} />
        </section>
        <section className={card}>
          <h2 className="font-bold">Membresías confirmadas por plan — histórico</h2>
          {datos.membresias.confirmadasPorPlan.length === 0 ? <p className="text-xs">Sin membresías confirmadas.</p> :
            <Barras filas={datos.membresias.confirmadasPorPlan.map(p => ({ etiqueta: p.nombrePlan, valor: p.cantidad, texto: String(p.cantidad) }))} />}
        </section>
        <section className={card}>
          <h2 className="font-bold">Productos más vendidos — histórico (unidades)</h2>
          {datos.compras.productos.length === 0 ? <p className="text-xs">Sin ventas de la tienda.</p> :
            <Barras filas={datos.compras.productos.map(p => ({ etiqueta: p.nombre, valor: p.unidades, texto: String(p.unidades) }))} />}
        </section>
      </div>}
    </section>
  );
}
