import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from './PageHeader';
import { apiSaludServicio } from '../services/api';
import type { ServicioSalud } from '../services/api';

const card = 'rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3';
const SERVICIOS: { id: ServicioSalud; nombre: string }[] = [
  { id: 'gateway', nombre: 'Gateway (entrada única)' },
  { id: 'socios', nombre: 'Socios y Membresías' },
  { id: 'clases', nombre: 'Clases y Reservas' },
  { id: 'accesos', nombre: 'Accesos y Ocupación' },
  { id: 'tienda', nombre: 'Tienda' },
];
const ETIQUETAS: Record<string, string> = {
  CATALOGO_FAV_CONFIGURADO: 'Catálogo de FAV conectado',
  CATALOGO_FAV_PENDIENTE_CREDENCIAL: 'Catálogo de FAV sin configurar (falta URL/clave)',
  CONFIGURADA: 'Clave para FAV configurada',
  PENDIENTE_CREDENCIAL: 'Falta la clave para FAV',
  CERRADO: 'Circuito hacia FAV cerrado (normal)',
  ABIERTO: 'Circuito hacia FAV ABIERTO (FAV no responde)',
  SEMIABIERTO: 'Circuito hacia FAV probando recuperación',
};

// Estado de los servicios y de las integraciones externas, más accesos a las herramientas de operación.
export function ConfiguracionPanel({ usuario }: { usuario: { nombre: string; rol: string; socioId: string } }) {
  const [salud, setSalud] = useState<Record<string, { ok: boolean; detalle: Record<string, unknown> }> | null>(null);
  const consultar = useCallback(async () => {
    setSalud(null);
    const r = await Promise.all(SERVICIOS.map(async s => [s.id, await apiSaludServicio(s.id)] as const));
    setSalud(Object.fromEntries(r));
  }, []);
  useEffect(() => { void consultar(); }, [consultar]);
  const local = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const grafana = local ? 'http://localhost:3001' : `${window.location.protocol}//grafana.${window.location.host}`;
  const tienda = salud?.tienda?.detalle ?? {};

  return (
    <section className="app-page">
      <PageHeader eyebrow="OPERACIÓN" title="Configuración y estado del sistema"
        description="Verificá los servicios, las integraciones y los datos de tu sesión." />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Servicios</h2>
            <button type="button" className="rounded-lg border border-outline-variant px-3 py-1 text-xs font-semibold" onClick={() => void consultar()}>Verificar ahora</button></div>
          {!salud ? <p role="status">Verificando…</p> : <ul className="space-y-2 text-sm">
            {SERVICIOS.map(s => <li key={s.id} className="flex items-center justify-between gap-2">
              <span>{s.nombre}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${salud[s.id].ok ? 'bg-primary/20 text-primary' : 'bg-error/20 text-error'}`}>
                {salud[s.id].ok ? 'OPERATIVO' : 'NO DISPONIBLE'}</span>
            </li>)}
          </ul>}
        </section>
        <section className={card}>
          <h2 className="font-bold">Integraciones con otros grupos</h2>
          {!salud ? <p role="status">Verificando…</p> : <ul className="space-y-1 text-sm">
            {['integracion', 'consignaciones', 'circuitoFav'].filter(k => typeof tienda[k] === 'string')
              .map(k => <li key={k}>• {ETIQUETAS[String(tienda[k])] ?? String(tienda[k])}</li>)}
            <li>• Car Cruds: el estado de la conexión se ve en <strong>Empleados Car Cruds</strong>.</li>
          </ul>}
          <p className="text-xs text-on-surface-variant">Las URL y claves de los proveedores se configuran en el servidor (archivo .env), nunca desde la web. Ver docs/DEPLOY.md.</p>
        </section>
        <section className={card}>
          <h2 className="font-bold">Herramientas de operación</h2>
          <ul className="space-y-1 text-sm">
            <li><a className="text-primary underline" href={grafana} target="_blank" rel="noreferrer">Tablero de Grafana</a> — instancias, errores, balanceo, circuito FAV, alertas.</li>
            {local && <li><a className="text-primary underline" href="http://localhost:9090/alerts" target="_blank" rel="noreferrer">Alertas de Prometheus</a></li>}
            <li><a className="text-primary underline" href="/consola.html" target="_blank" rel="noreferrer">Consola de API y trazas</a></li>
          </ul>
        </section>
        <section className={card}>
          <h2 className="font-bold">Sesión</h2>
          <p className="text-sm">{usuario.nombre} · <strong>{usuario.rol}</strong> · {usuario.socioId}</p>
          <p className="text-xs text-on-surface-variant">La sesión vive solo en memoria y vence según AUTH_JWT_TTL_SECONDS. El gateway valida la firma y limita los intentos de login.</p>
        </section>
      </div>
    </section>
  );
}
