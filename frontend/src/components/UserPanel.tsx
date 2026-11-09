import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { AuthUser, ClassSession, UserReservation } from '../types/auth';
import { ApiError, apiBuscarClases, apiObtenerClasesYReservas, apiObtenerSocio, apiReservarClase, apiUnirseEspera, apiCancelarReserva, apiRetirarEspera } from '../services/api';
import type { FiltrosCatalogo, OrdenCatalogo } from '../services/api';
import { MisSolicitudes } from './MembresiasPanel';
import { TiendaPanel } from './TiendaPanel';

interface UserPanelProps {
  user: AuthUser;
  onOpenAuth: () => void;
  onLogout: () => void;
  showToast: (msg: string, icon?: string) => void;
  onSwitchToAdmin?: () => void;
}

function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return 'Hoy';
  if (date.toDateString() === tomorrow.toDateString()) return 'Mañana';
  return date.toLocaleDateString('es-AR');
}
function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';
const filtrosIniciales = { texto: '', sedeId: '', profesor: '', desde: '', hasta: '', soloConCupo: false, orden: 'inicio_asc' as OrdenCatalogo };
const filterInput = 'w-full rounded-lg border border-outline-variant bg-surface-container p-2 text-xs text-on-surface';

export const UserPanel: React.FC<UserPanelProps> = ({ user, onLogout, showToast, onSwitchToAdmin }) => {
  const [profile, setProfile] = useState(user);
  const [profileError, setProfileError] = useState('');
  const [classes, setClasses] = useState<ClassSession[]>([]);
  const [reservations, setReservations] = useState<UserReservation[]>([]);
  const [activeTab, setActiveTab] = useState<'clases' | 'mis-reservas' | 'membresia' | 'tienda'>('clases');
  const [formulario, setFormulario] = useState(filtrosIniciales);
  const [consulta, setConsulta] = useState<FiltrosCatalogo>({ pagina: 1, tamanio: 20 });
  const [catalogoLoading, setCatalogoLoading] = useState(true);
  const [catalogoError, setCatalogoError] = useState('');
  const [formError, setFormError] = useState('');
  const [total, setTotal] = useState(0);
  const [recarga, setRecarga] = useState(0);
  const personalQuery = useRef(0);
  const scope = useRef(0);
  const accionEnCurso = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    scope.current++;
    return () => { scope.current++; personalQuery.current++; };
  }, []);

  useEffect(() => {
    let active = true;
    setProfile(user);
    setProfileError('');
    apiObtenerSocio(user.socioId).then(data => { if (active) setProfile(data); })
      .catch(error => { if (active) setProfileError(errorMessage(error)); });
    return () => { active = false; };
  }, [user, activeTab]);

  const syncWithBackend = useCallback(async () => {
    const requestId = ++personalQuery.current;
    setLoading(true);
    try {
      const data = await apiObtenerClasesYReservas(user.socioId);
      if (requestId !== personalQuery.current) return;
      const sessions = data.clasesPersonales ?? data.items;
      const details = (claseId: string) => {
        const clase = sessions.find(item => item.claseId === claseId);
        return {
          claseId, nombreClase: clase?.nombre ?? claseId, sedeId: clase?.sedeId,
          inicio: clase?.inicio, horario: clase ? timeLabel(clase.inicio) : 'Horario no disponible',
          fechaTexto: clase ? dayLabel(clase.inicio) : 'Fecha no disponible',
        };
      };
      const confirmed: UserReservation[] = data.reservasSocio
        .filter(item => item.estado === 'CONFIRMADA')
        .map(item => ({ ...details(item.claseId), reservaId: item.reservaId, tipo: 'RESERVA',
          estado: 'CONFIRMADA', fechaCreacion: item.createdAt }));
      const waiting: UserReservation[] = data.esperaSocio
        .filter(item => item.estado === 'PENDIENTE')
        .map(item => ({ ...details(item.claseId), reservaId: item.esperaId, tipo: 'ESPERA',
          estado: 'LISTA_ESPERA', fechaCreacion: item.createdAt }));
      setReservations([...confirmed, ...waiting]);
      setLoadError('');
    } catch (error) {
      if (requestId === personalQuery.current) setLoadError(errorMessage(error));
    } finally {
      if (requestId === personalQuery.current) setLoading(false);
    }
  }, [user.socioId]);

  useEffect(() => { void syncWithBackend(); }, [syncWithBackend]);
  useEffect(() => {
    let actual = true;
    const controller = new AbortController();
    setCatalogoLoading(true);
    setCatalogoError('');
    void apiBuscarClases(consulta, controller.signal).then(data => {
      if (!actual) return;
      setClasses(data.items.map(item => ({
        id: item.claseId, nombre: item.nombre, actividad: item.actividad, profesor: item.profesor,
        sedeId: item.sedeId, fechaIso: item.inicio, dia: dayLabel(item.inicio), horario: timeLabel(item.inicio),
        cupoMaximo: item.capacidad, cupoOcupado: item.capacidad - item.cuposDisponibles,
        reservaDirectaDisponible: item.reservaDirectaDisponible,
      })));
      setTotal(data.total);
    }).catch(error => {
      if (actual) setCatalogoError(errorMessage(error));
    }).finally(() => {
      if (actual) setCatalogoLoading(false);
    });
    return () => { actual = false; controller.abort(); };
  }, [consulta, recarga]);

  const actualizarDatos = async () => {
    setCatalogoLoading(true);
    setRecarga(value => value + 1);
    await syncWithBackend();
  };

  const buscar = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');
    try {
      for (const [campo, limite] of [['texto', 200], ['sedeId', 50], ['profesor', 100]] as const) {
        if (Array.from(formulario[campo]).length > limite) {
          setFormError(`El filtro ${campo} admite hasta ${limite} caracteres.`);
          return;
        }
      }
      const desde = formulario.desde ? new Date(formulario.desde).toISOString() : undefined;
      const hasta = formulario.hasta ? new Date(formulario.hasta).toISOString() : undefined;
      if (desde && hasta && Date.parse(desde) >= Date.parse(hasta)) {
        setFormError('La fecha hasta debe ser posterior a desde.');
        return;
      }
      setCatalogoLoading(true);
      setConsulta({ ...formulario, desde, hasta, pagina: 1, tamanio: 20 });
    } catch { setFormError('Revisá las fechas y horas de la búsqueda.'); }
  };
  const isClassBooked = (id: string) => reservations.some(item => item.claseId === id);

  const handleBookClass = async (clase: ClassSession, joinWaiting = false) => {
    if (accionEnCurso.current || loading || loadError || catalogoLoading || catalogoError || isClassBooked(clase.id)) return;
    accionEnCurso.current = true;
    const actualScope = scope.current;
    setPendingAction(clase.id);
    try {
      if (joinWaiting) {
        await apiUnirseEspera(clase.id, user.socioId);
        if (actualScope !== scope.current) return;
        showToast('Inscripción a la lista de espera registrada.', 'hourglass_top');
      } else {
        await apiReservarClase(clase.id, user.socioId, false);
        if (actualScope !== scope.current) return;
        showToast('Reserva confirmada.', 'event_available');
      }
      await actualizarDatos();
    } catch (error) {
      if (actualScope !== scope.current) return;
      showToast(errorMessage(error), 'error');
      await actualizarDatos();
    } finally {
      accionEnCurso.current = false;
      if (actualScope === scope.current) setPendingAction(null);
    }
  };

  const handleCancelEntry = async (reservaId: string) => {
    const reservation = reservations.find(item => item.reservaId === reservaId);
    if (!reservation || accionEnCurso.current || loading || loadError) return;
    accionEnCurso.current = true;
    const actualScope = scope.current;
    setPendingAction(reservation.claseId);
    try {
      const esEspera = reservation.tipo === 'ESPERA';
      const result = esEspera ? await apiRetirarEspera(reservation.claseId, reservaId) : await apiCancelarReserva(reservaId);
      if (actualScope !== scope.current) return;
      if (!result.exito) throw new Error('El servidor no confirmó la cancelación.');
      showToast(esEspera ? 'Te retiraste de la lista de espera.' : result.reasignacionPendiente
        ? 'Reserva cancelada. La reasignación del cupo está pendiente.'
        : 'Reserva cancelada.', 'event_busy');
      await actualizarDatos();
    } catch (error) {
      if (actualScope !== scope.current) return;
      const promovida = reservation.tipo === 'ESPERA' && error instanceof ApiError && error.codigo === 'ESPERA_PROMOVIDA';
      showToast(promovida ? 'La espera ya fue promovida. Revisá Mis Reservas para cancelarla si sigue confirmada.' : errorMessage(error), promovida ? 'event_available' : 'error');
      await actualizarDatos();
      if (promovida && actualScope === scope.current) setActiveTab('mis-reservas');
    } finally {
      accionEnCurso.current = false;
      if (actualScope === scope.current) setPendingAction(null);
    }
  };

  const planTitle = profile.membresia?.tipoPlan ?? 'SIN MEMBRESÍA';
  const membershipStatus = profileError ? 'ESTADO SIN ACTUALIZAR'
    : profile.membresia?.estado ?? 'SIN MEMBRESÍA';
  return (
    <div className="min-h-screen bg-background text-on-surface font-body flex flex-col antialiased">
      {/* Top Banner Navigation */}
      <header className="border-b border-outline-variant/60 bg-surface-container-lowest/95 backdrop-blur-md sticky top-0 z-40 px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-on-primary font-black font-headline text-sm shadow-sm">
            P
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-headline font-bold text-on-surface tracking-wide text-sm">PULSE CLUB</span>
              <span className="text-[9.5px] uppercase font-label-code px-1.5 py-0.2 rounded bg-secondary-container text-secondary border border-secondary/30">
                PORTAL DEL SOCIO
              </span>
            </div>
            <p className="text-[10px] text-on-surface-variant leading-none mt-0.5">Clases, reservas, membresía y tienda</p>
          </div>
        </div>

        {/* Actions & User Profile */}
        <div className="flex items-center gap-2.5">
          {user.rol === 'ADMIN' && onSwitchToAdmin && (
            <button
              onClick={onSwitchToAdmin}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container hover:bg-surface-container-high border border-outline-variant text-xs font-semibold text-on-surface transition-colors"
              title="Volver al panel administrativo"
            >
              <span className="material-symbols-outlined text-sm text-primary">admin_panel_settings</span>
              <span>Panel Admin</span>
            </button>
          )}

          <button
            disabled title="Los accesos se registran en recepción. No hay pase QR implementado."
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary hover:bg-primary-hover text-on-primary font-headline font-bold text-xs shadow-sm transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-base">qr_code_2</span>
            <span>Pase QR no disponible</span>
          </button>

          <div className="h-5 w-px bg-outline-variant/60"></div>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-secondary to-primary flex items-center justify-center text-on-primary font-bold text-xs ring-1 ring-primary/40">
              {user.nombre.slice(0, 2).toUpperCase()}
            </div>
            <div className="hidden md:block text-left">
              <span className="block text-xs font-semibold text-on-surface leading-tight">{user.nombre}</span>
              <span className="text-[10px] text-on-surface-variant font-label-code">DNI {user.dni}</span>
            </div>
            <button
              onClick={onLogout}
              className="p-1 rounded-md text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
              title="Cerrar Sesión"
            >
              <span className="material-symbols-outlined text-base">logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Hero Card: Member Status & Identity */}
        <section className="relative overflow-hidden rounded-xl bg-surface-container-low border border-outline-variant/60 p-4 sm:p-5 shadow-lg">
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-primary/15 text-primary text-[10.5px] font-label-code font-bold border border-primary/30">
                  {planTitle}
                </span>
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-secondary-container text-secondary text-[10.5px] font-semibold border border-secondary/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
                  {membershipStatus}
                </span>
              </div>

              <h1 className="text-xl sm:text-2xl font-bold font-headline text-on-surface">
                ¡A entrenar hoy, {user.nombre}!
              </h1>
              <p className="text-xs text-on-surface-variant max-w-xl">
                Las reservas se habilitan según tu membresía al reservar y en la fecha de la clase.
              </p>
            </div>

            <div className="rounded-lg border border-outline-variant/40 p-3 text-xs text-on-surface-variant">
              Las reservas y membresías se consultan al servidor.
              {profileError && <p className="text-error mt-2">No se pudo actualizar tu membresía: {profileError}</p>}
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between gap-3 text-xs text-on-surface-variant" role="status">
          <span>{loading ? 'Actualizando reservas…' : loadError ? 'No se pudieron actualizar las reservas: ' + loadError : 'Reservas consultadas al servidor.'}</span>
          <button onClick={() => void actualizarDatos()} disabled={loading || !!pendingAction} className="px-3 py-1 rounded-lg border border-outline-variant disabled:opacity-50">Actualizar</button>
        </div>

        {/* Tab Switcher */}
        <div className="flex flex-wrap border-b border-outline-variant/50 gap-4">
          <button
            onClick={() => setActiveTab('clases')}
            className={`pb-2 text-xs font-semibold flex items-center gap-1.5 transition-all relative ${
              activeTab === 'clases'
                ? 'text-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">calendar_month</span>
            <span>Clases y Reservas</span>
            {activeTab === 'clases' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary shadow-sm"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('mis-reservas')}
            className={`pb-2 text-xs font-semibold flex items-center gap-1.5 transition-all relative ${
              activeTab === 'mis-reservas'
                ? 'text-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">fact_check</span>
            <span>Mis Reservas</span>
            <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-primary text-on-primary font-bold">
              {reservations.length}
            </span>
            {activeTab === 'mis-reservas' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary shadow-sm"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('membresia')}
            className={`pb-2 text-xs font-semibold flex items-center gap-1.5 transition-all relative ${
              activeTab === 'membresia'
                ? 'text-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-base">badge</span>
            <span>Membresía y Pagos</span>
            {activeTab === 'membresia' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary shadow-sm"></span>
            )}
          </button>
          <button type="button" onClick={() => setActiveTab('tienda')}
            className={`pb-2 text-xs font-semibold flex items-center gap-1.5 transition-all relative ${activeTab === 'tienda'
              ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <span className="material-symbols-outlined text-base">storefront</span>
            <span>Tienda</span>
            {activeTab === 'tienda' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary shadow-sm"></span>}
          </button>
        </div>

        {activeTab === 'tienda' && <TiendaPanel />}

        {/* Tab 1: Clases y Reservas */}
        {activeTab === 'clases' && (
          <div className="space-y-3.5">
            <form onSubmit={buscar} className="rounded-xl border border-outline-variant/60 bg-surface-container-low p-3.5 space-y-3">
              <h2 className="font-headline text-sm font-bold">Buscar clases</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <label>Texto en nombre, actividad o profesor
                  <input aria-label="Texto de búsqueda" className={filterInput} value={formulario.texto}
                    onChange={event => setFormulario({ ...formulario, texto: event.target.value,
                      orden: !event.target.value.trim() && formulario.orden === 'relevancia' ? 'inicio_asc' : formulario.orden })} />
                </label>
                <label>Sede, identificador mostrado en las clases
                  <input aria-label="Sede de búsqueda" className={filterInput} value={formulario.sedeId}
                    onChange={event => setFormulario({ ...formulario, sedeId: event.target.value })} />
                </label>
                <label>Profesor, nombre completo
                  <input aria-label="Profesor de búsqueda" className={filterInput} value={formulario.profesor}
                    onChange={event => setFormulario({ ...formulario, profesor: event.target.value })} />
                </label>
                <label>Inicio desde, inclusive
                  <input aria-label="Desde" type="datetime-local" className={filterInput} value={formulario.desde}
                    onChange={event => setFormulario({ ...formulario, desde: event.target.value })} />
                </label>
                <label>Inicio hasta, exclusivo
                  <input aria-label="Hasta" type="datetime-local" className={filterInput} value={formulario.hasta}
                    onChange={event => setFormulario({ ...formulario, hasta: event.target.value })} />
                </label>
                <label>Orden
                  <select aria-label="Orden de búsqueda" className={filterInput} value={formulario.orden}
                    onChange={event => setFormulario({ ...formulario, orden: event.target.value as OrdenCatalogo })}>
                    <option value="inicio_asc">Horario ascendente</option>
                    <option value="inicio_desc">Horario descendente</option>
                    <option value="relevancia" disabled={!formulario.texto.trim()}>Relevancia del texto</option>
                  </select>
                </label>
              </div>
              <p className="text-[11px] text-on-surface-variant">Fechas y horas de tu equipo. Aplicá los filtros con Buscar. Se muestran 20 clases por página.</p>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={formulario.soloConCupo}
                  onChange={event => setFormulario({ ...formulario, soloConCupo: event.target.checked })} />
                Solo con cupo para reservar directamente
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={!!pendingAction} className="rounded-lg px-4 py-2 bg-primary text-on-primary text-xs font-bold disabled:opacity-50">Buscar</button>
                <button type="button" disabled={!!pendingAction} className="rounded-lg px-4 py-2 border border-outline-variant text-xs disabled:opacity-50"
                  onClick={() => { setFormulario(filtrosIniciales); setFormError(''); setCatalogoLoading(true); setConsulta({ pagina: 1, tamanio: 20 }); }}>Limpiar filtros</button>
              </div>
              {formError && <p role="alert" className="text-error text-xs">{formError}</p>}
            </form>

            {catalogoLoading && <p role="status" className="text-xs p-3">Buscando clases…</p>}
            {catalogoError && <div role="alert" className="text-error text-xs p-3"><p>{catalogoError}</p>
              <button type="button" onClick={() => { setCatalogoLoading(true); setRecarga(value => value + 1); }} className="underline mt-2">Reintentar búsqueda</button>
            </div>}
            {!catalogoLoading && !catalogoError && <p role="status" className="text-xs text-on-surface-variant">{total} clases encontradas · Página {consulta.pagina ?? 1} de {Math.max(1, Math.ceil(total / 20))}</p>}
            {!catalogoLoading && !catalogoError && classes.length === 0 && <p className="text-xs text-on-surface-variant p-4">No hay clases disponibles para estos filtros.</p>}
            {/* Classes Grid */}
            {!catalogoLoading && !catalogoError && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {classes.map((clase) => {
                const booked = isClassBooked(clase.id);
                const isFull = clase.cupoOcupado >= clase.cupoMaximo;
                const percent = clase.cupoMaximo ? Math.round((clase.cupoOcupado / clase.cupoMaximo) * 100) : 0;
                const entry = reservations.find(item => item.claseId === clase.id);
                const actionDisabled = !!pendingAction || loading || !!loadError || new Date(clase.fechaIso).getTime() <= Date.now();

                return (
                  <div
                    key={clase.id}
                    className={`rounded-xl border bg-surface-container-low p-3.5 flex flex-col justify-between transition-all duration-200 hover:border-outline shadow-md ${
                      booked ? 'border-primary/60 ring-1 ring-primary/30' : 'border-outline-variant/60'
                    }`}
                  >
                    <div className="space-y-2">
                      {/* Class Badge & Intensity */}
                      <div className="flex items-center justify-between">
                        <span className="text-[9.5px] font-label-code uppercase px-1.5 py-0.2 rounded bg-surface-container text-on-surface border border-outline-variant/40">
                          {clase.actividad || 'Clase grupal'}
                        </span>
                      </div>

                      {/* Title */}
                      <h3 className="font-headline text-sm font-bold text-on-surface tracking-tight leading-snug">
                        {clase.nombre}
                      </h3>

                      {/* Instructor & Room */}
                      <div className="space-y-1 text-xs text-on-surface-variant">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm text-primary">sports_handball</span>
                          <span>Profesor <strong className="text-on-surface">{clase.profesor || 'No informado'}</strong></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm text-tertiary-fixed-dim">location_on</span>
                          <span>Sede: {clase.sedeId}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm text-secondary">schedule</span>
                          <span className="font-semibold text-on-surface">{clase.dia} • {clase.horario}</span>
                        </div>
                      </div>

                      {/* Capacity Bar */}
                      <div className="pt-1">
                        <div className="flex justify-between text-[10.5px] mb-1 font-label-code">
                          <span className="text-on-surface-variant">Cupos</span>
                          <span className={isFull ? 'text-error font-bold' : 'text-on-surface'}>
                            {clase.cupoOcupado} / {clase.cupoMaximo} {isFull && '(COMPLETO)'}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-surface-container-lowest overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 rounded-full ${
                              isFull
                                ? 'bg-error'
                                : percent > 80
                                ? 'bg-warning'
                                : 'bg-gradient-to-r from-secondary to-primary'
                            }`}
                            style={{ width: `${percent}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Booking Action */}
                    <div className="mt-3 pt-2.5 border-t border-outline-variant/40">
                      {booked ? (
                        <div className="flex items-center justify-between p-1.5 rounded-lg bg-primary/10 border border-primary/30 text-xs text-primary">
                          <span className="flex items-center gap-1 font-bold text-[11px]">
                            <span className="material-symbols-outlined text-sm">check_circle</span>
                            {entry?.tipo === 'ESPERA' ? 'En lista de espera' : 'Lugar Reservado'}
                          </span>
                          <button
                            onClick={() => {
                              const res = reservations.find((r) => r.claseId === clase.id);
                              if (res) void handleCancelEntry(res.reservaId);
                            }}
                            disabled={actionDisabled}
                            className="disabled:opacity-50 text-[11px] text-error hover:underline font-semibold"
                          >
                            {entry?.tipo === 'ESPERA' ? 'Salir de espera' : 'Cancelar reserva'}
                          </button>
                        </div>
                      ) : !clase.reservaDirectaDisponible ? (
                        <button
                          disabled={actionDisabled}
                          onClick={() => void handleBookClass(clase, true)}
                          className="w-full py-1.5 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high border border-warning/40 text-warning font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-sm">hourglass_top</span>
                          <span>Unirme a Lista de Espera</span>
                        </button>
                      ) : (
                        <button
                          disabled={actionDisabled}
                          onClick={() => void handleBookClass(clase, false)}
                          className="disabled:opacity-50 w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary-hover text-on-primary font-headline font-bold text-xs transition-all shadow-sm flex items-center justify-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-sm">add_circle</span>
                          <span>Reservar Lugar</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>}
            <nav aria-label="Páginas de clases" className="flex items-center gap-3 text-xs">
              <button type="button" className="rounded-lg border border-outline-variant px-3 py-2 disabled:opacity-50"
                disabled={catalogoLoading || !!catalogoError || !!pendingAction || (consulta.pagina ?? 1) <= 1}
                onClick={() => { setCatalogoLoading(true); setConsulta(current => ({ ...current, pagina: (current.pagina ?? 1) - 1 })); }}>Anterior</button>
              <button type="button" className="rounded-lg border border-outline-variant px-3 py-2 disabled:opacity-50"
                disabled={catalogoLoading || !!catalogoError || !!pendingAction || (consulta.pagina ?? 1) * 20 >= total || (consulta.pagina ?? 1) >= 1000000}
                onClick={() => { setCatalogoLoading(true); setConsulta(current => ({ ...current, pagina: (current.pagina ?? 1) + 1 })); }}>Siguiente</button>
            </nav>
          </div>
        )}

        {/* Tab 2: Mis Reservas Activas */}
        {activeTab === 'mis-reservas' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold font-headline text-on-surface">
                Tus Clases Programadas ({reservations.length})
              </h2>
              <span className="text-[11px] text-on-surface-variant">
                Podés cancelar una reserva o salir de la espera hasta antes del inicio.
              </span>
            </div>


            {reservations.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-surface-container-low border border-outline-variant/50 space-y-2">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant">event_busy</span>
                <h3 className="text-sm font-bold text-on-surface">No tienes reservas activas</h3>
                <p className="text-xs text-on-surface-variant max-w-xs mx-auto">
                  Explora las clases disponibles y asegura tu cupo.
                </p>
                <button
                  onClick={() => setActiveTab('clases')}
                  className="mt-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-bold text-xs font-headline"
                >
                  Ver Grilla de Clases
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {reservations.map((res) => (
                  <div
                    key={res.reservaId}
                    className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/60 flex flex-col justify-between space-y-3 shadow-md"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[9.5px] font-label-code px-1.5 py-0.2 rounded bg-surface-container text-on-surface-variant">
                            {res.tipo === 'ESPERA' ? 'ESPERA' : 'RESERVA'}
                          </span>
                          {res.estado === 'CONFIRMADA' ? (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-secondary-container text-secondary flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
                              Confirmada
                            </span>
                          ) : (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-warning-container text-warning flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs">hourglass_top</span>
                              Lista de Espera
                            </span>
                          )}
                        </div>
                        <h4 className="font-headline text-sm font-bold text-on-surface">
                          {res.nombreClase}
                        </h4>
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-surface-container-lowest border border-outline-variant/40 flex items-center justify-center text-primary">
                        <span className="material-symbols-outlined text-base">fitness_center</span>
                      </div>
                    </div>

                    <div className="space-y-1 text-xs text-on-surface-variant bg-surface-container-lowest/60 p-2.5 rounded-lg border border-outline-variant/40">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs text-primary">schedule</span>
                        <span className="text-on-surface font-medium">{res.fechaTexto} • {res.horario}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs text-tertiary-fixed-dim">location_on</span>
                        <span>{res.sedeId ? 'Sede: ' + res.sedeId : 'Sede no disponible'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs text-secondary">sports_handball</span>
                        <span>Coach: <strong className="text-on-surface">No informado</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        disabled title="La integración con calendario no está implementada."
                        className="text-xs text-on-surface-variant hover:text-on-surface flex items-center gap-1 transition-colors"
                      >
                        <span className="material-symbols-outlined text-sm">calendar_add_on</span>
                        <span>Agendar</span>
                      </button>

                      <button
                        disabled={!!pendingAction || loading || !!loadError || !res.inicio || new Date(res.inicio).getTime() <= Date.now()}
                        onClick={() => void handleCancelEntry(res.reservaId)}
                        className="px-2.5 py-1 rounded-md bg-error-container hover:opacity-85 text-error text-xs font-semibold border border-error/30 transition-colors flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-xs">cancel</span>
                        <span>{res.tipo === 'ESPERA' ? 'Salir de espera' : 'Cancelar reserva'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Mi Membresía y Pagos */}
        {activeTab === 'membresia' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <div className="p-4 sm:p-5 rounded-xl bg-surface-container-low border border-outline-variant/60 space-y-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold font-headline">Detalle de tu Plan</h3>
                  <span className="text-[10px] font-label-code px-2 py-0.5 rounded bg-surface-container border border-outline-variant">{membershipStatus}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/40">
                    <span className="text-[11px] text-on-surface-variant block">Tipo de Membresía</span>
                    <span className="text-sm font-bold">{planTitle}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/40">
                    <span className="text-[11px] text-on-surface-variant block">Vigencia</span>
                    <span className="text-xs">{profile.membresia
                      ? new Date(profile.membresia.fechaInicio).toLocaleDateString('es-AR') + ' — ' + new Date(profile.membresia.fechaFin).toLocaleDateString('es-AR')
                      : 'Sin membresía asignada'}</span>
                  </div>
                </div>
              </div>
              <MisSolicitudes socioId={user.socioId} />
            </div>
            <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/60 space-y-3 h-fit">
              <h4 className="text-sm font-bold">Gestión de membresía</h4>
              <p className="text-xs text-on-surface-variant">El administrador elige el plan, registra y confirma el pago. Las solicitudes pendientes o rechazadas no habilitan el uso. Reactivación de períodos superpuestos pendiente de una política aprobada.</p>
              <button disabled className="px-3 py-2 rounded-lg border border-outline-variant text-xs opacity-50">Reactivación pendiente</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
