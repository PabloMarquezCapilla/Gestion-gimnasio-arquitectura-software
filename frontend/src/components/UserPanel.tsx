import React, { useState, useEffect, useCallback } from 'react';
import { AuthUser, ClassSession, UserReservation } from '../types/auth';
import {
  apiObtenerClasesYReservas,
  apiReservarClase,
  apiUnirseEspera,
  apiCancelarReserva,
} from '../services/api';

interface UserPanelProps {
  user: AuthUser;
  onOpenAuth: () => void;
  onLogout: () => void;
  showToast: (msg: string, icon?: string) => void;
  onSwitchToAdmin?: () => void;
}

const INITIAL_CLASSES: ClassSession[] = [
  {
    id: 'cls-101',
    nombre: 'Spinning Ride High Intensity',
    disciplina: 'SPINNING',
    instructor: 'Facundo Rivas',
    sala: 'Estudio Ride A (Planta 2)',
    horario: '18:30 - 19:25',
    dia: 'Hoy',
    fechaIso: '2026-10-19T18:30:00',
    cupoMaximo: 24,
    cupoOcupado: 22,
    intensidad: 'ALTA',
    caloriasAprox: 680,
  },
  {
    id: 'cls-102',
    nombre: 'CrossFit WOD: Olympic Strength',
    disciplina: 'CROSSFIT',
    instructor: 'Romina Albarracín',
    sala: 'Box Central (Área Funcional)',
    horario: '19:00 - 20:00',
    dia: 'Hoy',
    fechaIso: '2026-10-19T19:00:00',
    cupoMaximo: 16,
    cupoOcupado: 16,
    intensidad: 'ALTA',
    caloriasAprox: 750,
  },
  {
    id: 'cls-103',
    nombre: 'Vinyasa Power Yoga & Soundbath',
    disciplina: 'YOGA',
    instructor: 'Lucía Santoro',
    sala: 'Sala Zen (Piso 3)',
    horario: '19:30 - 20:30',
    dia: 'Hoy',
    fechaIso: '2026-10-19T19:30:00',
    cupoMaximo: 20,
    cupoOcupado: 12,
    intensidad: 'CALMA',
    caloriasAprox: 320,
  },
  {
    id: 'cls-104',
    nombre: 'HIIT Circuit 360° Fat Burn',
    disciplina: 'FUNCIONAL',
    instructor: 'Marcos Benítez',
    sala: 'Pista de Atletismo & Funcional',
    horario: '20:00 - 20:50',
    dia: 'Hoy',
    fechaIso: '2026-10-19T20:00:00',
    cupoMaximo: 18,
    cupoOcupado: 15,
    intensidad: 'ALTA',
    caloriasAprox: 620,
  },
  {
    id: 'cls-105',
    nombre: 'Pilates Reformer Core & Alignment',
    disciplina: 'PILATES',
    instructor: 'Camila Rossi',
    sala: 'Estudio Reformer 1',
    horario: '08:30 - 09:20',
    dia: 'Mañana',
    fechaIso: '2026-10-20T08:30:00',
    cupoMaximo: 10,
    cupoOcupado: 7,
    intensidad: 'MEDIA',
    caloriasAprox: 380,
  },
  {
    id: 'cls-106',
    nombre: 'Boxeo Strike & Sparring Conditioning',
    disciplina: 'BOXEO',
    instructor: 'Esteban "Toro" Díaz',
    sala: 'Ring & Zona de Sacos',
    horario: '10:00 - 11:00',
    dia: 'Mañana',
    fechaIso: '2026-10-20T10:00:00',
    cupoMaximo: 15,
    cupoOcupado: 9,
    intensidad: 'ALTA',
    caloriasAprox: 710,
  },
];

export const UserPanel: React.FC<UserPanelProps> = ({
  user,
  onLogout,
  showToast,
  onSwitchToAdmin,
}) => {
  const [classes, setClasses] = useState<ClassSession[]>(INITIAL_CLASSES);
  const [activeTab, setActiveTab] = useState<'clases' | 'mis-reservas' | 'membresia'>('clases');
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>('TODAS');
  const [selectedDay, setSelectedDay] = useState<string>('TODOS');
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [qrCountdown, setQrCountdown] = useState<number>(30);
  const [gateUnlocked, setGateUnlocked] = useState<boolean>(false);

  // User's active reservations
  const [reservations, setReservations] = useState<UserReservation[]>([
    {
      reservaId: 'res-991',
      claseId: 'cls-101',
      nombreClase: 'Spinning Ride High Intensity',
      disciplina: 'SPINNING',
      instructor: 'Facundo Rivas',
      sala: 'Estudio Ride A (Planta 2)',
      horario: 'Hoy a las 18:30',
      fechaTexto: 'Hoy, 18:30 hs',
      estado: 'CONFIRMADA',
      fechaCreacion: '2026-10-19T10:00:00',
    },
  ]);

  // QR rotating countdown effect
  useEffect(() => {
    const timer = setInterval(() => {
      setQrCountdown((prev) => (prev <= 1 ? 30 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const syncWithBackend = useCallback(async () => {
    const data = await apiObtenerClasesYReservas(user.socioId);
    if (!data || !data.items || data.items.length === 0) return;

    const backendSessions: ClassSession[] = data.items
      .filter((item) => Date.parse(item.inicio) > Date.now() - 3600000)
      .map((item) => {
        const dt = new Date(item.inicio);
        const horaInicio = dt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const horaFin = new Date(dt.getTime() + 3600000).toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const isYoga = item.nombre.toLowerCase().includes('yoga');
        const isPilates = item.nombre.toLowerCase().includes('pilates');
        const disciplina = isYoga ? 'YOGA' : isPilates ? 'PILATES' : 'FUNCIONAL';
        return {
          id: item.claseId,
          nombre: item.nombre,
          disciplina,
          instructor: isYoga ? 'Lucía Santoro' : 'Camila Rossi',
          sala: item.sedeId === 'sede-demo-01' ? 'Sede Central Palermo' : 'Sede Belgrano Norte',
          horario: `${horaInicio} - ${horaFin}`,
          dia: 'Hoy',
          fechaIso: item.inicio,
          cupoMaximo: item.capacidad,
          cupoOcupado: Math.max(0, item.capacidad - item.cuposDisponibles),
          intensidad: isYoga ? 'CALMA' : 'MEDIA',
          caloriasAprox: isYoga ? 320 : 410,
        };
      });

    if (backendSessions.length > 0) {
      setClasses([...backendSessions, ...INITIAL_CLASSES]);
    }

    const mappedRes: UserReservation[] = [
      ...data.reservasSocio.map((r) => {
        const cls = data.items.find((i) => i.claseId === r.claseId);
        return {
          reservaId: r.reservaId,
          claseId: r.claseId,
          nombreClase: cls?.nombre || r.claseId,
          disciplina: cls?.nombre.toLowerCase().includes('yoga') ? 'YOGA' : 'PILATES',
          instructor: cls?.nombre.toLowerCase().includes('yoga') ? 'Lucía Santoro' : 'Camila Rossi',
          sala: cls?.sedeId === 'sede-demo-01' ? 'Sede Central Palermo' : 'Sede Belgrano',
          horario: cls ? new Date(cls.inicio).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'Programada',
          fechaTexto: cls ? new Date(cls.inicio).toLocaleString('es-AR') : '',
          estado: 'CONFIRMADA' as const,
          fechaCreacion: r.createdAt,
        };
      }),
      ...data.esperaSocio.map((e) => {
        const cls = data.items.find((i) => i.claseId === e.claseId);
        return {
          reservaId: e.esperaId,
          claseId: e.claseId,
          nombreClase: cls?.nombre || e.claseId,
          disciplina: cls?.nombre.toLowerCase().includes('yoga') ? 'YOGA' : 'PILATES',
          instructor: cls?.nombre.toLowerCase().includes('yoga') ? 'Lucía Santoro' : 'Camila Rossi',
          sala: cls?.sedeId === 'sede-demo-01' ? 'Sede Central Palermo' : 'Sede Belgrano',
          horario: cls ? new Date(cls.inicio).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'En espera',
          fechaTexto: cls ? new Date(cls.inicio).toLocaleString('es-AR') : '',
          estado: 'LISTA_ESPERA' as const,
          posicionEspera: e.orden,
          fechaCreacion: e.createdAt,
        };
      }),
    ];

    if (mappedRes.length > 0) {
      setReservations(mappedRes);
    }
  }, [user.socioId]);

  useEffect(() => {
    void syncWithBackend();
  }, [syncWithBackend]);

  const filteredClasses = classes.filter((c) => {
    const matchesDisc = selectedDiscipline === 'TODAS' || c.disciplina === selectedDiscipline;
    const matchesDay = selectedDay === 'TODOS' || c.dia === selectedDay;
    return matchesDisc && matchesDay;
  });

  const isClassBooked = (classId: string) => {
    return reservations.some((r) => r.claseId === classId && r.estado !== 'CANCELADA');
  };

  const handleBookClass = async (c: ClassSession) => {
    if (isClassBooked(c.id)) {
      showToast('Ya tienes una reserva activa para esta sesión.', 'info');
      return;
    }

    // Si es una clase del backend real (clase-demo-*), ejecutar flujo real contra PostgreSQL
    if (c.id.startsWith('clase-')) {
      try {
        if (c.cupoOcupado >= c.cupoMaximo) {
          const res = await apiUnirseEspera(c.id, user.socioId);
          if (res.ok) {
            showToast(`¡Te uniste a la Lista de Espera (#${res.data.orden || 1}) en PostgreSQL!`, 'hourglass_top');
            await syncWithBackend();
            return;
          }
          showToast(res.data?.mensaje || 'No se pudo ingresar a la lista de espera.', 'error');
          return;
        }

        const res = await apiReservarClase(c.id, user.socioId, true);
        if (res.ok) {
          if (res.data?.estado === 'LISTA_ESPERA') {
            showToast(`Clase completa: ingresaste a la Lista de Espera (#${res.data.espera?.orden || 1}).`, 'hourglass_top');
          } else {
            showToast(`¡Reserva confirmada en PostgreSQL (${res.data.reservaId})!`, 'event_available');
          }
          await syncWithBackend();
          return;
        }
        showToast(res.data?.mensaje || `No se pudo reservar (${res.data?.codigo || res.status}).`, 'error');
        return;
      } catch {
        // Fallback local si el backend no está levantado
      }
    }

    if (c.cupoOcupado >= c.cupoMaximo) {
      const waitlistRes: UserReservation = {
        reservaId: `wait-${Date.now()}`,
        claseId: c.id,
        nombreClase: c.nombre,
        disciplina: c.disciplina,
        instructor: c.instructor,
        sala: c.sala,
        horario: `${c.dia} a las ${c.horario.split(' - ')[0]}`,
        fechaTexto: `${c.dia}, ${c.horario}`,
        estado: 'LISTA_ESPERA',
        posicionEspera: 1,
        fechaCreacion: new Date().toISOString(),
      };
      setReservations([waitlistRes, ...reservations]);
      showToast('¡Te uniste a la Lista de Espera (#1)!', 'hourglass_top');
      return;
    }

    const newRes: UserReservation = {
      reservaId: `res-${Date.now()}`,
      claseId: c.id,
      nombreClase: c.nombre,
      disciplina: c.disciplina,
      instructor: c.instructor,
      sala: c.sala,
      horario: `${c.dia} a las ${c.horario.split(' - ')[0]}`,
      fechaTexto: `${c.dia}, ${c.horario}`,
      estado: 'CONFIRMADA',
      fechaCreacion: new Date().toISOString(),
    };

    setReservations([newRes, ...reservations]);
    setClasses((prev) =>
      prev.map((item) => (item.id === c.id ? { ...item, cupoOcupado: item.cupoOcupado + 1 } : item))
    );
    showToast(`¡Lugar confirmado en ${c.nombre}!`, 'event_available');
  };

  const handleCancelReservation = async (reservaId: string, claseId: string) => {
    if (claseId.startsWith('clase-') && reservaId.startsWith('res-')) {
      try {
        const res = await apiCancelarReserva(reservaId);
        if (res.ok) {
          if (res.data?.promocion) {
            showToast(
              `Reserva cancelada. ¡Promoción automática activada para ${res.data.promocion.socioId}!`,
              'event_busy'
            );
          } else {
            showToast('Reserva cancelada en PostgreSQL. Cupo liberado.', 'event_busy');
          }
          await syncWithBackend();
          return;
        }
      } catch {
        // Fallback local
      }
    }

    setReservations((prev) => prev.filter((r) => r.reservaId !== reservaId));
    setClasses((prev) =>
      prev.map((item) => (item.id === claseId ? { ...item, cupoOcupado: Math.max(0, item.cupoOcupado - 1) } : item))
    );
    showToast('Reserva cancelada. Cupo liberado.', 'event_busy');
  };

  const handleSimulateTurnstile = () => {
    setGateUnlocked(true);
    showToast('¡Molinete habilitado! Acceso registrado.', 'lock_open');
    setTimeout(() => {
      setGateUnlocked(false);
    }, 4000);
  };

  const planTitle = user.membresia?.tipoPlan === 'FULL_ANUAL'
    ? 'PASE FULL ANUAL BLACK'
    : user.membresia?.tipoPlan === 'MENSUAL'
    ? 'PASE LIBRE MENSUAL'
    : 'STANDARD SEMESTRAL';

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
            <p className="text-[10px] text-on-surface-variant leading-none mt-0.5">Sede Belgrano Central • Acceso Digital</p>
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
            onClick={() => setShowQrModal(true)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary hover:bg-primary-hover text-on-primary font-headline font-bold text-xs shadow-sm transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-base">qr_code_2</span>
            <span>Mi Pase QR</span>
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
                  ACCESO HABILITADO
                </span>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-tertiary-container/20 text-tertiary-fixed-dim text-[10.5px] border border-tertiary-fixed-dim/30">
                  <span className="material-symbols-outlined text-xs">verified</span>
                  Apto Médico Vigente
                </span>
              </div>

              <h1 className="text-xl sm:text-2xl font-bold font-headline text-on-surface">
                ¡A entrenar hoy, {user.nombre}!
              </h1>
              <p className="text-xs text-on-surface-variant max-w-xl">
                Acceso habilitado en todas las salas de musculación, clases de alta intensidad y zona recovery.
              </p>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-3 gap-2 bg-surface-container-lowest border border-outline-variant/40 rounded-lg p-2.5 text-center min-w-[280px]">
              <div>
                <span className="text-[9.5px] uppercase font-label-code text-on-surface-variant block">Asistencias</span>
                <span className="font-headline text-lg font-bold text-on-surface">14</span>
                <span className="text-[9.5px] text-secondary block font-medium">este mes</span>
              </div>
              <div className="border-x border-outline-variant/40 px-2">
                <span className="text-[9.5px] uppercase font-label-code text-on-surface-variant block">Racha</span>
                <span className="font-headline text-lg font-bold text-primary">4 sem</span>
                <span className="text-[9.5px] text-on-surface-variant block">imparable 🔥</span>
              </div>
              <div>
                <span className="text-[9.5px] uppercase font-label-code text-on-surface-variant block">Pulse Pts</span>
                <span className="font-headline text-lg font-bold text-tertiary-fixed-dim">1.280</span>
                <span className="text-[9.5px] text-on-surface-variant block">Pro Athlete</span>
              </div>
            </div>
          </div>
        </section>

        {/* Tab Switcher */}
        <div className="flex border-b border-outline-variant/50 gap-4">
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
        </div>

        {/* Tab 1: Clases y Reservas */}
        {activeTab === 'clases' && (
          <div className="space-y-3.5">
            {/* Filter Pills */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              {/* Disciplines */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { key: 'TODAS', label: 'Todas' },
                  { key: 'SPINNING', label: 'Spinning' },
                  { key: 'CROSSFIT', label: 'CrossFit' },
                  { key: 'FUNCIONAL', label: 'Funcional' },
                  { key: 'YOGA', label: 'Yoga' },
                  { key: 'PILATES', label: 'Pilates' },
                  { key: 'BOXEO', label: 'Boxeo' },
                ].map((d) => (
                  <button
                    key={d.key}
                    onClick={() => setSelectedDiscipline(d.key)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                      selectedDiscipline === d.key
                        ? 'bg-primary text-on-primary font-bold shadow-sm'
                        : 'bg-surface-container text-on-surface-variant hover:text-on-surface border border-outline-variant/40'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {/* Day filter */}
              <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded-md border border-outline-variant/40 self-start sm:self-auto">
                {['TODOS', 'Hoy', 'Mañana'].map((day) => (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={`px-2.5 py-0.5 text-xs rounded font-medium transition-colors ${
                      selectedDay === day
                        ? 'bg-surface-container-high text-on-surface font-bold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            {/* Classes Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredClasses.map((clase) => {
                const booked = isClassBooked(clase.id);
                const isFull = clase.cupoOcupado >= clase.cupoMaximo;
                const percent = Math.round((clase.cupoOcupado / clase.cupoMaximo) * 100);

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
                          {clase.disciplina}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10.5px] text-on-surface-variant font-label-code">
                            ~{clase.caloriasAprox} kcal
                          </span>
                          <span
                            className={`text-[9px] px-1 py-0.2 rounded font-bold ${
                              clase.intensidad === 'ALTA'
                                ? 'bg-error-container text-error'
                                : clase.intensidad === 'MEDIA'
                                ? 'bg-warning-container text-warning'
                                : 'bg-tertiary-container/20 text-tertiary-fixed-dim'
                            }`}
                          >
                            {clase.intensidad}
                          </span>
                        </div>
                      </div>

                      {/* Title */}
                      <h3 className="font-headline text-sm font-bold text-on-surface tracking-tight leading-snug">
                        {clase.nombre}
                      </h3>

                      {/* Instructor & Room */}
                      <div className="space-y-1 text-xs text-on-surface-variant">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm text-primary">sports_handball</span>
                          <span>Coach: <strong className="text-on-surface">{clase.instructor}</strong></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm text-tertiary-fixed-dim">location_on</span>
                          <span>{clase.sala}</span>
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
                            Lugar Reservado
                          </span>
                          <button
                            onClick={() => {
                              const res = reservations.find((r) => r.claseId === clase.id);
                              if (res) handleCancelReservation(res.reservaId, clase.id);
                            }}
                            className="text-[11px] text-error hover:underline font-semibold"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : isFull ? (
                        <button
                          onClick={() => handleBookClass(clase)}
                          className="w-full py-1.5 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high border border-warning/40 text-warning font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-sm">hourglass_top</span>
                          <span>Unirme a Lista de Espera</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleBookClass(clase)}
                          className="w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary-hover text-on-primary font-headline font-bold text-xs transition-all shadow-sm flex items-center justify-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-sm">add_circle</span>
                          <span>Reservar Lugar</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
                Cancelación sin penalidad hasta 2 horas antes
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
                            {res.disciplina}
                          </span>
                          {res.estado === 'CONFIRMADA' ? (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-secondary-container text-secondary flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
                              Confirmada
                            </span>
                          ) : (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-warning-container text-warning flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs">hourglass_top</span>
                              Lista de Espera #{res.posicionEspera}
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
                        <span className="text-on-surface font-medium">{res.horario}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs text-tertiary-fixed-dim">location_on</span>
                        <span>{res.sala}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs text-secondary">sports_handball</span>
                        <span>Coach: <strong className="text-on-surface">{res.instructor}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        onClick={() => showToast('Sincronizado con Google Calendar.', 'calendar_add_on')}
                        className="text-xs text-on-surface-variant hover:text-on-surface flex items-center gap-1 transition-colors"
                      >
                        <span className="material-symbols-outlined text-sm">calendar_add_on</span>
                        <span>Agendar</span>
                      </button>

                      <button
                        onClick={() => handleCancelReservation(res.reservaId, res.claseId)}
                        className="px-2.5 py-1 rounded-md bg-error-container hover:opacity-85 text-error text-xs font-semibold border border-error/30 transition-colors flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-xs">cancel</span>
                        <span>Cancelar</span>
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
            {/* Membership Details */}
            <div className="lg:col-span-2 space-y-4">
              <div className="p-4 sm:p-5 rounded-xl bg-surface-container-low border border-outline-variant/60 space-y-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold font-headline text-on-surface">Detalle de tu Plan</h3>
                  <span className="text-[10px] font-label-code px-2 py-0.5 rounded bg-secondary-container text-secondary border border-secondary/30 font-bold">
                    ESTADO: ACTIVO
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/40">
                    <span className="text-[11px] text-on-surface-variant block mb-0.5">Tipo de Membresía</span>
                    <span className="text-sm font-bold text-on-surface font-headline">{planTitle}</span>
                    <span className="text-[11px] text-primary block mt-0.5">Acceso libre multi-sede</span>
                  </div>

                  <div className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/40">
                    <span className="text-[11px] text-on-surface-variant block mb-0.5">Vigencia hasta</span>
                    <span className="text-sm font-bold text-on-surface font-label-code">
                      {user.membresia?.fechaFin ? new Date(user.membresia.fechaFin).toLocaleDateString('es-AR') : '31/12/2026'}
                    </span>
                    <span className="text-[11px] text-secondary block mt-0.5">Renovación automática bonificada</span>
                  </div>
                </div>

                <div className="pt-2">
                  <h4 className="text-[10.5px] font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5 font-label-code">
                    Beneficios Exclusivos Incluidos:
                  </h4>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-on-surface">
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-xs">check</span>
                      Acceso libre a 12 sedes de la red
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-xs">check</span>
                      Clases ilimitadas de Spinning, CrossFit y Yoga
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-xs">check</span>
                      2 Pases de cortesía para invitados al mes
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-xs">check</span>
                      Evaluación antropométrica mensual
                    </li>
                  </ul>
                </div>
              </div>

              {/* Invoices and Receipts */}
              <div className="p-4 sm:p-5 rounded-xl bg-surface-container-low border border-outline-variant/60 space-y-3">
                <h3 className="text-base font-bold font-headline text-on-surface">Historial de Pagos</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-outline-variant/50 text-on-surface-variant uppercase font-label-code text-[10px]">
                        <th className="py-1.5">Periodo</th>
                        <th className="py-1.5">Concepto</th>
                        <th className="py-1.5">Monto</th>
                        <th className="py-1.5">Método</th>
                        <th className="py-1.5 text-right">Comprobante</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/30 text-on-surface">
                      <tr>
                        <td className="py-2.5 font-label-code text-[11px]">Oct 2026</td>
                        <td className="font-semibold text-on-surface">Cuota Membresía Mensual</td>
                        <td className="font-label-code text-primary font-bold">$24.000</td>
                        <td>Efectivo (10% OFF)</td>
                        <td className="text-right">
                          <button
                            onClick={() => showToast('Descargando comprobante fiscal PDF...', 'download')}
                            className="text-tertiary-fixed-dim hover:underline flex items-center justify-end gap-1 ml-auto text-[11px]"
                          >
                            <span className="material-symbols-outlined text-xs">download</span>
                            <span>Recibo #004-189</span>
                          </button>
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-label-code text-[11px]">Sep 2026</td>
                        <td className="font-semibold text-on-surface">Cuota Membresía Mensual</td>
                        <td className="font-label-code text-primary font-bold">$24.000</td>
                        <td>Transferencia bancaria</td>
                        <td className="text-right">
                          <button
                            onClick={() => showToast('Descargando comprobante fiscal PDF...', 'download')}
                            className="text-tertiary-fixed-dim hover:underline flex items-center justify-end gap-1 ml-auto text-[11px]"
                          >
                            <span className="material-symbols-outlined text-xs">download</span>
                            <span>Recibo #003-912</span>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Side Card: Physical Clearance & Medical check */}
            <div className="space-y-4">
              <div className="p-4 sm:p-5 rounded-xl bg-surface-container-low border border-outline-variant/60 space-y-2.5 shadow-lg">
                <div className="w-9 h-9 rounded-lg bg-secondary-container text-secondary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">health_and_safety</span>
                </div>
                <h4 className="font-headline text-sm font-bold text-on-surface">
                  Apto Físico Obligatorio
                </h4>
                <p className="text-xs text-on-surface-variant">
                  Tu certificado de aptitud física médica se encuentra validado y al día.
                </p>
                <div className="p-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Médico:</span>
                    <span className="text-on-surface font-medium">Dr. Alberto Ferrara</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Vencimiento:</span>
                    <span className="text-secondary font-label-code font-bold">15/12/2026</span>
                  </div>
                </div>
              </div>

              {/* Support & WhatsApp */}
              <div className="p-4 sm:p-5 rounded-xl bg-surface-container-low border border-outline-variant/60 space-y-2">
                <h4 className="font-headline text-xs font-bold text-on-surface flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary text-sm">chat</span>
                  ¿Consultas sobre tu pase?
                </h4>
                <p className="text-[11px] text-on-surface-variant">
                  Escríbenos directamente a recepción o habla con tu entrenador asignado.
                </p>
                <button
                  onClick={() => showToast('Abriendo WhatsApp de Recepción...', 'chat')}
                  className="w-full py-2 px-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant text-xs font-semibold text-on-surface flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-secondary text-xs">call</span>
                  <span>WhatsApp Recepción Belgrano</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL PASE DIGITAL QR */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/85 backdrop-blur-md animate-in fade-in">
          <div
            className="w-full max-w-xs rounded-2xl bg-surface-container border border-primary/40 p-5 shadow-2xl text-center relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Close */}
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-3.5 right-3.5 text-on-surface-variant hover:text-on-surface p-1 rounded-md"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>

            {/* Club Brand */}
            <div className="flex items-center justify-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded bg-primary flex items-center justify-center text-on-primary font-black text-[10px]">
                P
              </span>
              <span className="font-headline font-bold text-on-surface tracking-widest text-xs">
                PULSE DIGITAL PASS
              </span>
            </div>

            <p className="text-[11px] text-on-surface-variant mb-4">
              Apoya este código frente al molinete
            </p>

            {/* QR Visual Container with animated scanning laser beam */}
            <div className="relative mx-auto w-44 h-44 rounded-xl bg-white p-3 flex items-center justify-center shadow-inner overflow-hidden">
              {/* Laser beam animation */}
              <div className="absolute left-0 right-0 h-0.5 bg-primary shadow-[0_0_8px_#ccff00] animate-[bounce_2s_infinite] pointer-events-none z-10 opacity-80"></div>

              {/* Dynamic QR SVG */}
              <svg viewBox="0 0 100 100" className="w-full h-full text-black">
                <rect width="100" height="100" fill="white" />
                <rect x="5" y="5" width="26" height="26" fill="black" />
                <rect x="8" y="8" width="20" height="20" fill="white" />
                <rect x="12" y="12" width="12" height="12" fill="black" />
                <rect x="69" y="5" width="26" height="26" fill="black" />
                <rect x="72" y="8" width="20" height="20" fill="white" />
                <rect x="76" y="12" width="12" height="12" fill="black" />
                <rect x="5" y="69" width="26" height="26" fill="black" />
                <rect x="8" y="72" width="20" height="20" fill="white" />
                <rect x="12" y="76" width="12" height="12" fill="black" />
                <rect x="36" y="10" width="6" height="6" fill="black" />
                <rect x="46" y="14" width="6" height="6" fill="black" />
                <rect x="56" y="10" width="6" height="6" fill="black" />
                <rect x="36" y="24" width="6" height="6" fill="black" />
                <rect x="46" y="24" width="6" height="6" fill="black" />
                <rect x="10" y="36" width="6" height="6" fill="black" />
                <rect x="20" y="44" width="6" height="6" fill="black" />
                <rect x="36" y="40" width="8" height="8" fill="black" />
                <rect x="50" y="36" width="8" height="8" fill="black" />
                <rect x="65" y="44" width="6" height="6" fill="black" />
                <rect x="80" y="36" width="6" height="6" fill="black" />
                <rect x="36" y="56" width="6" height="6" fill="black" />
                <rect x="48" y="52" width="8" height="8" fill="black" />
                <rect x="60" y="60" width="6" height="6" fill="black" />
                <rect x="75" y="54" width="6" height="6" fill="black" />
                <rect x="36" y="72" width="6" height="6" fill="black" />
                <rect x="46" y="80" width="6" height="6" fill="black" />
                <rect x="60" y="72" width="8" height="8" fill="black" />
                <rect x="75" y="75" width="6" height="6" fill="black" />
                <rect x="85" y="85" width="6" height="6" fill="black" />
              </svg>
            </div>

            {/* Dynamic Countdown */}
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-label-code text-on-surface">
              <span className="material-symbols-outlined text-xs text-primary">sync</span>
              <span>Rota en <strong className="text-primary">{qrCountdown}s</strong></span>
            </div>

            {/* Member Card Details */}
            <div className="mt-3 pt-3 border-t border-outline-variant/40 text-left text-xs space-y-0.5">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Socio:</span>
                <span className="font-bold text-on-surface">{user.nombre}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">DNI:</span>
                <span className="font-label-code text-on-surface">{user.dni}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Estado:</span>
                <span className="text-secondary font-semibold">ACTIVA (Al Día)</span>
              </div>
            </div>

            {/* Simulator Button */}
            <button
              onClick={handleSimulateTurnstile}
              disabled={gateUnlocked}
              className={`w-full mt-3.5 py-2 px-3 rounded-lg font-headline font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                gateUnlocked
                  ? 'bg-secondary text-on-secondary shadow-md'
                  : 'bg-primary hover:bg-primary-hover text-on-primary shadow-sm'
              }`}
            >
              <span className="material-symbols-outlined text-base">
                {gateUnlocked ? 'check_circle' : 'sensor_door'}
              </span>
              <span>{gateUnlocked ? '¡Paso Habilitado!' : 'Simular Lectura de Molinete'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
