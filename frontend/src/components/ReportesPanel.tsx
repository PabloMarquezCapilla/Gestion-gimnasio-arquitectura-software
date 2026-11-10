import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from './PageHeader';
import { apiComprasCaja, apiSolicitudesMembresia } from '../services/api';
import type { CompraCaja, SolicitudMembresia } from '../services/api';

const card = 'rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3';
const pesos = (minor: number) => (minor / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
const mesDe = (fecha: string) => fecha.slice(0, 7);
const nombreMes = (mes: string) => new Date(mes + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
const MAX_PAGINAS = 10;

function ultimosMeses(n: number): string[] {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
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

// Reportes de negocio calculados desde los datos de Socios y Tienda (últimos registros, hasta 10 páginas).
export function ReportesPanel() {
  const [datos, setDatos] = useState<{ solicitudes: SolicitudMembresia[]; compras: CompraCaja[] } | null>(null);
  const [error, setError] = useState('');
  const cargar = useCallback(async () => {
    setDatos(null); setError('');
    try {
      const solicitudes: SolicitudMembresia[] = [];
      for (let p = 1; p <= MAX_PAGINAS; p++) {
        const r = await apiSolicitudesMembresia(p);
        solicitudes.push(...r.items);
        if (r.items.length < 20) break;
      }
      const compras: CompraCaja[] = [];
      for (let p = 1; p <= MAX_PAGINAS; p++) {
        const r = await apiComprasCaja(p);
        compras.push(...r.items);
        if (p * r.tamanio >= r.total) break;
      }
      setDatos({ solicitudes, compras });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron calcular los reportes.'); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const meses = ultimosMeses(6);
  const confirmadas = datos?.solicitudes.filter(s => s.estado === 'CONFIRMADA' && s.comprobante) ?? [];
  const ingresosMembresias = meses.map(m => confirmadas.filter(s => mesDe(s.comprobante!.confirmadoEn) === m).reduce((t, s) => t + s.importeMinor, 0));
  const ventasTienda = meses.map(m => (datos?.compras ?? []).filter(c => mesDe(c.creadaEn) === m).reduce((t, c) => t + c.totalMinor, 0));
  const porPlan = new Map<string, number>();
  confirmadas.forEach(s => porPlan.set(s.nombrePlan, (porPlan.get(s.nombrePlan) ?? 0) + 1));
  const porProducto = new Map<string, number>();
  (datos?.compras ?? []).forEach(c => c.items.forEach(i => porProducto.set(i.nombre, (porProducto.get(i.nombre) ?? 0) + i.unidades)));
  const grafana = `${window.location.protocol}//${window.location.hostname === 'localhost' ? 'localhost:3001' : 'grafana.' + window.location.host}`;

  return (
    <section className="app-page">
      <PageHeader eyebrow="ANÁLISIS" title="Reportes"
        description="Revisá los ingresos por membresías y las ventas registradas en la tienda."
        action={<button type="button" className="app-button" onClick={() => void cargar()}>Actualizar</button>} />
      <p className="text-sm">Ingresos y ventas de los últimos 6 meses. El estado técnico del sistema (errores, latencia, réplicas) está en el <a className="text-primary underline" href={grafana} target="_blank" rel="noreferrer">tablero de Grafana</a>.</p>
      {error && <p role="alert" className="text-error">{error}</p>}
      {!datos && !error && <p role="status">Calculando reportes…</p>}
      {datos && <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="font-bold">Ingresos por membresías (pagos confirmados)</h2>
          <p className="text-2xl font-bold text-primary">{pesos(ingresosMembresias.reduce((a, b) => a + b, 0))}</p>
          <Barras filas={meses.map((m, i) => ({ etiqueta: nombreMes(m), valor: ingresosMembresias[i], texto: pesos(ingresosMembresias[i]) }))} />
        </section>
        <section className={card}>
          <h2 className="font-bold">Ventas de la tienda (compras de socios)</h2>
          <p className="text-2xl font-bold text-primary">{pesos(ventasTienda.reduce((a, b) => a + b, 0))}</p>
          <Barras filas={meses.map((m, i) => ({ etiqueta: nombreMes(m), valor: ventasTienda[i], texto: pesos(ventasTienda[i]) }))} />
        </section>
        <section className={card}>
          <h2 className="font-bold">Membresías confirmadas por plan</h2>
          {porPlan.size === 0 ? <p className="text-xs">Sin membresías confirmadas.</p> :
            <Barras filas={[...porPlan].sort((a, b) => b[1] - a[1]).map(([plan, n]) => ({ etiqueta: plan, valor: n, texto: String(n) }))} />}
        </section>
        <section className={card}>
          <h2 className="font-bold">Productos más vendidos (unidades)</h2>
          {porProducto.size === 0 ? <p className="text-xs">Sin ventas de la tienda.</p> :
            <Barras filas={[...porProducto].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => ({ etiqueta: p, valor: n, texto: String(n) }))} />}
        </section>
      </div>}
    </section>
  );
}
