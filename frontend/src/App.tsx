import { useState, useMemo, useEffect, useRef } from 'react';
import type { AuthResponse, AuthState } from './types/auth';
import { setApiSession } from './services/api';
import { AuthModal } from './components/AuthModal';
import { UserPanel } from './components/UserPanel';

// --- Interfaces ---
export interface Member {
  id: string;
  code: string;
  name: string;
  initials?: string;
  avatarUrl?: string;
  dni: string;
  phone: string;
  planKey: string;
  planName: string;
  planDesc: string;
  status: 'active' | 'warning' | 'expired';
  periodStart: string;
  periodEnd: string;
  validityNote: string;
  lastAmount: number;
  lastMethod: string;
  lastDate: string;
}

export default function App() {
  // --- Auth & Role View States ---
  const [auth, setAuth] = useState<AuthState>({ user: null, token: null, isAuthenticated: false });
  const currentUser = auth.user;
  const [viewMode, setViewMode] = useState<'admin' | 'socio'>('socio');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState<'login' | 'register'>('login');

  // --- Navigation & Filter States ---
  const [activeNav, setActiveNav] = useState('socios-y-membresias');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'warning' | 'expired'>('all');
  const [planFilter, setPlanFilter] = useState<string>('');
  const [expiryFilter, setExpiryFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Toast Notification
  const [toast, setToast] = useState<{ show: boolean; message: string; icon: string }>({
    show: false,
    message: '',
    icon: 'check_circle',
  });

  const showToast = (message: string, icon = 'check_circle') => {
    setToast({ show: true, message, icon });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, show: false }));
    }, 3500);
  };

  const clearSession = () => {
    setApiSession(null);
    setAuth({ user: null, token: null, isAuthenticated: false });
    setViewMode('socio');
    setIsAuthModalOpen(false);
  };

  const handleAuthSuccess = (session: AuthResponse) => {
    setApiSession(session.token, () => {
      clearSession();
      showToast('La sesión venció o no es válida. Iniciá sesión nuevamente.', 'lock');
    });
    setAuth({ user: session.socio, token: session.token, isAuthenticated: true });
    setViewMode(session.socio.rol === 'ADMIN' ? 'admin' : 'socio');
  };

  const handleLogout = () => {
    clearSession();
    showToast('Sesión finalizada.', 'logout');
  };

  useEffect(() => {
    if (!auth.token) return;
    try {
      const payload = JSON.parse(atob(auth.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      if (!payload.exp) return;
      const timer = window.setTimeout(() => {
        clearSession();
        showToast('La sesión venció. Iniciá sesión nuevamente.', 'lock');
      }, Math.max(0, payload.exp * 1000 - Date.now()));
      return () => window.clearTimeout(timer);
    } catch {
      clearSession();
    }
  }, [auth.token]);

  const handleOpenLogin = () => {
    setAuthModalInitialMode('login');
    setIsAuthModalOpen(true);
  };

  const handleOpenRegister = () => {
    if (currentUser?.rol !== 'ADMIN') return;
    setAuthModalInitialMode('register');
    setIsAuthModalOpen(true);
  };

  // El listado administrativo todavía no cuenta con una consulta integrada.
  // No se muestra una nómina local como si fueran socios registrados.
  const members: Member[] = [];

  // Keyboard shortcut Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filtered members list
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (planFilter && m.planKey !== planFilter) return false;
      if (expiryFilter === 'expired' && m.status !== 'expired') return false;
      if (expiryFilter === '7days' && !m.validityNote.toLowerCase().includes('días')) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = m.name.toLowerCase().includes(query);
        const matchesDni = m.dni.replace(/\./g, '').includes(query.replace(/\./g, ''));
        const matchesCode = m.code.toLowerCase().includes(query);
        const matchesPhone = m.phone.includes(query);
        if (!matchesName && !matchesDni && !matchesCode && !matchesPhone) return false;
      }
      return true;
    });
  }, [members, statusFilter, planFilter, expiryFilter, searchQuery]);

  const toastView = toast.show ? (
    <div role="status" className="fixed bottom-6 right-6 z-[100] max-w-md bg-surface-container-high border border-outline-variant rounded-xl p-4 shadow-xl text-on-surface flex items-center gap-2">
      <span className="material-symbols-outlined text-primary">{toast.icon}</span>
      <span className="text-xs">{toast.message}</span>
    </div>
  ) : null;

  if (viewMode === 'socio' || currentUser?.rol !== 'ADMIN') {
    return (
      <>
        {currentUser ? (
          <UserPanel
            key={currentUser.socioId}
            user={currentUser}
            onLogout={handleLogout}
            showToast={showToast}
            onOpenAuth={handleOpenLogin}
            onSwitchToAdmin={currentUser.rol === 'ADMIN' ? () => setViewMode('admin') : undefined}
          />
        ) : (
          <div className="min-h-screen bg-[#070D1D] text-white flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md w-full p-8 rounded-3xl bg-[#0F172A] border border-[#222A3D] shadow-2xl space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-[#CCFF00] text-black font-black font-['Space_Grotesk'] text-3xl flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(204,255,0,0.4)]">
                P
              </div>
              <div className="space-y-2">
                <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-white">PORTAL DEL SOCIO PULSE</h1>
                <p className="text-xs text-gray-400">
                  Iniciá sesión para consultar tu membresía y gestionar tus reservas.
                </p>
              </div>
              <div className="space-y-3 pt-2">
                <button
                  onClick={handleOpenLogin}
                  className="w-full py-3 px-4 rounded-xl bg-[#CCFF00] hover:bg-[#b5e600] text-black font-['Space_Grotesk'] font-bold text-sm shadow-[0_0_20px_rgba(204,255,0,0.3)] transition-all flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">login</span>
                  <span>Iniciar Sesión</span>
                </button>
                <p className="text-xs text-gray-400">El administrador realiza las altas de socios.</p>
              </div>

            </div>
          </div>
        )}
        {toastView}
        <AuthModal
          isOpen={isAuthModalOpen}
          initialMode={authModalInitialMode}
          onClose={() => setIsAuthModalOpen(false)}
          onSuccess={handleAuthSuccess}
          showToast={showToast}
        />
      </>
    );
  }

  return (
    <div className="bg-background font-body text-on-surface antialiased min-h-screen">
      {/* --- ASIDE: NAVIGATION SIDEBAR --- */}
      <aside className="fixed left-0 top-0 h-full w-56 bg-surface-container-low z-50 flex flex-col justify-between py-3 border-r border-outline-variant/60 shadow-lg">
        <div className="flex flex-col">
          {/* Brand Logo Header */}
          <div className="flex items-center gap-2.5 px-3.5 h-14 border-b border-outline-variant/40">
            <span className="material-symbols-outlined text-primary text-[26px]">bolt</span>
            <div className="flex flex-col">
              <span className="font-headline text-headline-sm uppercase tracking-wider text-on-surface font-bold leading-none">
                PULSE
              </span>
              <span className="font-label-code text-[10px] text-primary tracking-widest leading-none mt-1 font-semibold">
                FITNESS CLUB
              </span>
            </div>
          </div>

          {/* Turn status indicator */}
          <div className="px-3 mt-3 mb-2">
            <div className="bg-surface-container-lowest px-2.5 py-1.5 rounded-lg flex items-center justify-between border border-outline-variant/40">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
                <span className="font-label-code text-[10.5px] text-on-surface-variant uppercase">
                  Sesión
                </span>
              </div>
              <span className="font-label-code text-[11px] text-secondary font-bold">INICIADA</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1 px-2 mt-1">
            {[
              { path: 'panel-principal', label: 'Panel Principal', icon: 'dashboard' },
              { path: 'socios-y-membresias', label: 'Socios & Membresías', icon: 'badge' },
              { path: 'cobros-y-caja', label: 'Cobros & Caja', icon: 'point_of_sale' },
              { path: 'planes-y-tarifas', label: 'Planes y Tarifas', icon: 'card_membership' },
              { path: 'clases-y-turnos', label: 'Clases & Turnos', icon: 'event_available' },
              { path: 'reportes', label: 'Reportes', icon: 'analytics' },
              { path: 'configuracion', label: 'Configuración', icon: 'settings' },
            ].map((item) => {
              const isActive = activeNav === item.path;
              return (
                <button
                  key={item.path}
                  disabled={item.path !== 'socios-y-membresias'}
                  title={item.path !== 'socios-y-membresias' ? 'Sección pendiente de integración.' : undefined}
                  onClick={() => setActiveNav(item.path)}
                  className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-all text-xs font-semibold w-full text-left ${
                    isActive
                      ? 'bg-surface-container-high text-on-surface font-bold border-l-2 border-primary shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <span className={`material-symbols-outlined text-[18px] ${isActive ? 'text-primary' : ''}`}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="px-3 flex flex-col gap-1.5">
          <div className="bg-surface-container px-2.5 py-1.5 rounded-lg flex items-center justify-between border border-outline-variant/40">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-on-surface-variant text-[16px]">fitness_center</span>
              <span className="font-label-code text-[11px] text-on-surface-variant">Aforo Sala</span>
            </div>
            <span className="font-label-code text-xs text-on-surface font-bold">Pendiente</span>
          </div>
          <div className="text-center">
            <span className="font-label-code text-[10px] text-on-surface-variant/70">PULSE CLUB</span>
          </div>
        </div>
      </aside>

      {/* --- MAIN CONTENT WRAPPER --- */}
      <div className="pl-56">
        {/* Top Header */}
        <header className="fixed top-0 left-56 right-0 h-14 bg-surface-container-lowest/95 backdrop-blur-md z-40 flex items-center justify-between px-5 border-b border-outline-variant/50 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-surface-container-low px-2.5 py-1 rounded-lg text-on-surface cursor-pointer hover:bg-surface-container transition-colors border border-outline-variant/40 text-xs">
              <span className="material-symbols-outlined text-primary text-[18px]">location_on</span>
              <span className="font-semibold text-on-surface">Administración</span>
              <span className="material-symbols-outlined text-on-surface-variant text-[16px]">expand_more</span>
            </div>
            <div className="relative flex items-center w-64">
              <span className="material-symbols-outlined absolute left-2.5 text-on-surface-variant text-[18px]">
                search
              </span>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface-container pl-8 pr-3 py-1.5 rounded-lg text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary border border-outline-variant/40"
                placeholder="Buscar socio (Ctrl+K)..."
                type="text"
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* View Switcher Pill */}
            <div className="flex items-center bg-surface-container rounded-lg p-0.5 border border-outline-variant/40">
              <button
                type="button"
                onClick={() => setViewMode('admin')}
                className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-primary text-on-primary shadow-sm"
              >
                Admin
              </button>
              <button
                type="button"
                onClick={() => setViewMode('socio')}
                className="px-2.5 py-0.5 rounded-md text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
                title="Ver mis clases, reservas y membresía"
              >
                Ver como Socio
              </button>
            </div>

            {/* Primary Action Button (Volt Lime + Dark Text) */}
            <button
              disabled title="Los pagos están pendientes de implementación."
              className="flex items-center gap-1 bg-primary text-on-primary px-3 py-1 rounded-lg text-xs font-bold hover:bg-primary-hover shadow-sm transition-all active:scale-95"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Registrar Pago</span>
            </button>

            <button
              aria-label="Notificaciones de caja"
              disabled title="La conciliación está pendiente de implementación."
              className="relative p-1 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-error"></span>
            </button>

            <div className="h-5 w-px bg-outline-variant/50"></div>

            {currentUser ? (
              <div className="flex items-center gap-2">
                <div className="flex flex-col text-right">
                  <span className="text-xs font-semibold text-on-surface leading-tight">
                    {currentUser.nombre}
                  </span>
                  <span className="text-[10px] font-label-code text-primary font-bold">
                    {currentUser.rol}
                  </span>
                </div>
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-secondary to-primary flex items-center justify-center text-on-primary font-bold text-xs ring-1 ring-primary/40">
                  {currentUser.nombre.slice(0, 2).toUpperCase()}
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="p-1 rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
                  title="Cerrar sesión"
                >
                  <span className="material-symbols-outlined text-base">logout</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleOpenLogin}
                  className="px-2.5 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface border border-outline-variant/40"
                >
                  Iniciar Sesión
                </button>
                <button
                  type="button"
                  onClick={handleOpenRegister}
                  className="px-2.5 py-1 rounded-lg bg-secondary text-on-secondary text-xs font-bold hover:bg-secondary-hover"
                >
                  Registrarse
                </button>
              </div>
            )}
          </div>
        </header>

        {/* --- MAIN BODY VIEWPORT --- */}
        <main className="w-full pt-14 bg-background px-4 sm:px-6 min-h-screen">
          <div className="flex flex-col w-full pb-6">
            {toastView}

            {/* Top Banner / View Header */}
            <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4 pt-3">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-label-code text-primary uppercase tracking-wider flex items-center gap-1 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                    Panel Administrativo
                  </span>
                  <span className="text-on-surface-variant font-label-code text-[10px]">•</span>
                  <span className="font-label-code text-[10.5px] text-on-surface-variant">Servicios del gimnasio</span>
                </div>
                <h1 className="font-headline text-headline-lg text-on-surface tracking-tight font-bold">
                  Gestión de Membresías y Caja
                </h1>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Altas de socios disponibles. Listado, pagos, reactivación y comprobantes pendientes de integración.
                </p>
              </div>

              {/* Main Global Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-xl border border-outline-variant/50">
                  <div className="w-7 h-7 rounded-lg bg-surface-container-high text-secondary flex items-center justify-center">
                    <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-label-code text-[10px] text-on-surface-variant">
                      Cierre de Caja del Día
                    </span>
                    <span className="font-data-metric text-sm text-on-surface font-bold tracking-tight">
                      Pendiente{' '}
                      <span className="font-label-code text-[10px] font-normal text-on-surface-variant">ARS</span>
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleOpenRegister}
                  className="flex items-center gap-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors border border-outline-variant/40"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[16px]">person_add</span>
                  <span>Alta de Socio</span>
                </button>

                {/* Primary Button (+ Registrar Cobro / Pago) */}
                <button
                  disabled title="Los pagos están pendientes de implementación."
                  className="flex items-center gap-1.5 bg-primary text-on-primary px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm hover:bg-primary-hover active:scale-95 transition-all"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">add_circle</span>
                  <span>Registrar Cobro / Pago</span>
                </button>
              </div>
            </section>

            {/* KPI Cards Grid */}
            <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
              {/* KPI 1: Socios Activos */}
              <div className="bg-surface-container-low rounded-xl p-3.5 relative overflow-hidden flex flex-col justify-between border border-outline-variant/40">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                    Socios Activos
                  </span>
                  <span className="w-7 h-7 rounded-lg bg-secondary-container text-secondary flex items-center justify-center">
                    <span className="material-symbols-outlined text-[16px]">group</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="font-data-metric text-data-metric text-on-surface font-bold">—</span>
                  <div className="flex items-center gap-0.5 bg-secondary-container text-secondary px-1.5 py-0.2 rounded-full font-label-code text-[10.5px] font-bold">
                    <span className="material-symbols-outlined text-[13px]">arrow_upward</span>
                    <span>Sin datos</span>
                  </div>
                </div>
                <div className="w-full bg-surface-container h-1 rounded-full mt-2.5 overflow-hidden">
                  <div className="bg-secondary h-full rounded-full" style={{ width: '0%' }}></div>
                </div>
                <span className="font-body-sm text-[11px] text-on-surface-variant mt-1.5">
                  Consulta de métricas pendiente
                </span>
              </div>

              {/* KPI 2: Por Vencer */}
              <div className="bg-surface-container-low rounded-xl p-3.5 relative overflow-hidden flex flex-col justify-between border border-outline-variant/40">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                    Por Vencer (7 días)
                  </span>
                  <span className="w-7 h-7 rounded-lg bg-warning-container text-warning flex items-center justify-center">
                    <span className="material-symbols-outlined text-[16px]">notification_important</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="font-data-metric text-data-metric text-on-surface font-bold">—</span>
                  <span className="font-label-code text-[10.5px] text-warning bg-warning-container px-1.5 py-0.2 rounded-full font-semibold">
                    Datos pendientes
                  </span>
                </div>
                <div className="w-full bg-surface-container h-1 rounded-full mt-2.5 overflow-hidden">
                  <div className="bg-warning h-full rounded-full" style={{ width: '0%' }}></div>
                </div>
                <span className="font-body-sm text-[11px] text-on-surface-variant mt-1.5">
                  Consulta de vencimientos pendiente
                </span>
              </div>

              {/* KPI 3: Vencidas */}
              <div className="bg-surface-container-low rounded-xl p-3.5 relative overflow-hidden flex flex-col justify-between border border-outline-variant/40">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                    Membresías Vencidas
                  </span>
                  <span className="w-7 h-7 rounded-lg bg-error-container text-error flex items-center justify-center">
                    <span className="material-symbols-outlined text-[16px]">cancel</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="font-data-metric text-data-metric text-on-surface font-bold">—</span>
                  <span className="font-label-code text-[10.5px] text-error bg-error-container px-1.5 py-0.2 rounded-full font-semibold">
                    Datos pendientes
                  </span>
                </div>
                <div className="w-full bg-surface-container h-1 rounded-full mt-2.5 overflow-hidden">
                  <div className="bg-error h-full rounded-full" style={{ width: '0%' }}></div>
                </div>
                <span className="font-body-sm text-[11px] text-on-surface-variant mt-1.5">
                  Consulta de vencimientos pendiente
                </span>
              </div>

              {/* KPI 4: Ingresos Hoy */}
              <div className="bg-surface-container-low rounded-xl p-3.5 relative overflow-hidden flex flex-col justify-between border border-outline-variant/40">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">
                    Ingresos Registrados Hoy
                  </span>
                  <span className="w-7 h-7 rounded-lg bg-secondary-container text-secondary flex items-center justify-center">
                    <span className="material-symbols-outlined text-[16px]">payments</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="font-data-metric text-data-metric text-primary font-bold tracking-tight">
                    Pendiente
                  </span>
                  <span className="font-label-code text-[10px] text-on-surface-variant">ARS</span>
                </div>
                <div className="w-full bg-surface-container h-1 rounded-full mt-2.5 overflow-hidden">
                  <div className="bg-primary h-full rounded-full" style={{ width: '0%' }}></div>
                </div>
                <span className="font-body-sm text-[11px] text-on-surface-variant mt-1.5">
                  Registro de pagos pendiente
                </span>
              </div>
            </section>

            {/* Filter & Search Control Bar */}
            <section className="bg-surface-container-low rounded-xl p-3 mb-3.5 flex flex-col gap-2.5 border border-outline-variant/40">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                {/* Status Tabs */}
                <div className="flex items-center gap-1 p-1 bg-surface-container-lowest rounded-lg overflow-x-auto border border-outline-variant/40">
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`px-3 py-1.5 rounded-md font-label-md text-xs transition-colors flex items-center gap-1.5 ${
                      statusFilter === 'all'
                        ? 'bg-surface-container-high text-white font-bold'
                        : 'text-on-surface-variant hover:text-white'
                    }`}
                    type="button"
                  >
                    <span>Todos</span>
                    <span className="font-label-code text-[11px] px-1.5 py-0.2 rounded-md bg-surface-container text-white font-bold">
                      —
                    </span>
                  </button>

                  <button
                    onClick={() => setStatusFilter('active')}
                    className={`px-3 py-1.5 rounded-md font-label-md text-xs transition-colors flex items-center gap-1.5 ${
                      statusFilter === 'active'
                        ? 'bg-surface-container-high text-white font-bold'
                        : 'text-on-surface-variant hover:text-white'
                    }`}
                    type="button"
                  >
                    <span>Activos</span>
                    <span className="font-label-code text-[11px] px-1.5 py-0.2 rounded-md bg-secondary-container text-secondary font-bold">
                      —
                    </span>
                  </button>

                  <button
                    onClick={() => setStatusFilter('warning')}
                    className={`px-3 py-1.5 rounded-md font-label-md text-xs transition-colors flex items-center gap-1.5 ${
                      statusFilter === 'warning'
                        ? 'bg-surface-container-high text-white font-bold'
                        : 'text-on-surface-variant hover:text-white'
                    }`}
                    type="button"
                  >
                    <span>Suspendidos</span>
                    <span className="font-label-code text-[11px] px-1.5 py-0.2 rounded-md bg-warning-container text-warning font-bold">
                      —
                    </span>
                  </button>

                  <button
                    onClick={() => setStatusFilter('expired')}
                    className={`px-3 py-1.5 rounded-md font-label-md text-xs transition-colors flex items-center gap-1.5 ${
                      statusFilter === 'expired'
                        ? 'bg-surface-container-high text-white font-bold'
                        : 'text-on-surface-variant hover:text-white'
                    }`}
                    type="button"
                  >
                    <span>Vencidos</span>
                    <span className="font-label-code text-[11px] px-1.5 py-0.2 rounded-md bg-error-container text-error font-bold">
                      —
                    </span>
                  </button>
                </div>

                {/* Quick Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Plan selector */}
                  <div className="relative">
                    <select
                      value={planFilter}
                      disabled
                      title="La consulta de planes está pendiente de integración."
                      onChange={(e) => setPlanFilter(e.target.value)}
                      className="appearance-none bg-surface-container-lowest text-on-surface text-xs pl-3 pr-7 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary border border-outline-variant/40"
                    >
                      <option value="">Planes pendientes de consulta</option>
                    </select>
                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-2 text-on-surface-variant text-[16px]">
                      expand_more
                    </span>
                  </div>

                  {/* Expiration Range */}
                  <div className="relative">
                    <select
                      value={expiryFilter}
                      onChange={(e) => setExpiryFilter(e.target.value)}
                      className="appearance-none bg-surface-container-lowest text-on-surface text-xs pl-3 pr-7 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary border border-outline-variant/40"
                    >
                      <option value="">Vencimiento: Cualquiera</option>
                      <option value="today">Vence hoy</option>
                      <option value="7days">Próximos 7 días</option>
                      <option value="30days">Este mes</option>
                      <option value="expired">Ya vencidos</option>
                    </select>
                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-2 text-on-surface-variant text-[16px]">
                      calendar_today
                    </span>
                  </div>

                  {/* Reset filters */}
                  <button
                    onClick={() => {
                      setStatusFilter('all');
                      setPlanFilter('');
                      setExpiryFilter('');
                      setSearchQuery('');
                      showToast('Filtros restablecidos.');
                    }}
                    className="p-2 bg-surface-container-lowest hover:bg-surface-container text-on-surface-variant hover:text-white rounded-lg transition-colors border border-outline-variant/40"
                    title="Restablecer filtros"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">refresh</span>
                  </button>
                </div>
              </div>

              {/* Live Search Line */}
              <div className="relative w-full">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-[18px]">
                  search
                </span>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-container-lowest pl-9 pr-16 py-2 rounded-lg text-xs text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-1 focus:ring-primary transition-all border border-outline-variant/40"
                  placeholder="Buscar por Nombre, DNI, Teléfono o N° Socio (ej: Pereyra, 38.912.441 o #P-1042)..."
                  type="text"
                />
                <span className="absolute right-3 top-2 font-label-code text-[10px] text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded hidden md:inline border border-outline-variant/40">
                  ⌘ + K
                </span>
              </div>
            </section>

            {/* Main Table Section */}
            <section className="bg-surface-container-low rounded-xl overflow-hidden shadow-xl mb-6 border border-outline-variant/40">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-lowest text-on-surface-variant font-label-md text-[11px] uppercase tracking-wider h-9 border-b border-outline-variant/40">
                      <th className="px-3.5 py-2 font-semibold">Socio & Identificación</th>
                      <th className="px-3.5 py-2 font-semibold">Plan Actual</th>
                      <th className="px-3.5 py-2 font-semibold">Estado Membresía</th>
                      <th className="px-3.5 py-2 font-semibold">Vigencia & Vencimiento</th>
                      <th className="px-3.5 py-2 font-semibold text-right">Último Pago</th>
                      <th className="px-3.5 py-2 font-semibold text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container font-body-sm text-xs">
                    {filteredMembers.map((m) => (
                      <tr key={m.id} className="hover:bg-surface-container-high/40 transition-colors group">
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center gap-2.5">
                            {m.avatarUrl ? (
                              <img
                                alt={m.name}
                                className="w-8 h-8 rounded-full object-cover ring-1 ring-surface-variant flex-shrink-0"
                                src={m.avatarUrl}
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-surface-container-highest text-primary flex items-center justify-center font-bold text-xs border border-primary/20 flex-shrink-0">
                                {m.initials}
                              </div>
                            )}
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs text-on-surface truncate">{m.name}</span>
                                <span className="font-label-code text-[10px] px-1 py-0.2 rounded bg-surface-container text-on-surface-variant">
                                  {m.code}
                                </span>
                              </div>
                              <span className="font-label-code text-[10.5px] text-on-surface-variant truncate">
                                DNI: {m.dni} • Tel: {m.phone}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="px-3.5 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs text-on-surface font-semibold">{m.planName}</span>
                            <span className="font-label-code text-[10.5px] text-on-surface-variant">{m.planDesc}</span>
                          </div>
                        </td>

                        <td className="px-3.5 py-2.5">
                          {m.status === 'active' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-code text-[10.5px] font-bold bg-secondary-container text-secondary">
                              <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                              Activo
                            </span>
                          )}
                          {m.status === 'warning' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-code text-[10.5px] font-bold bg-warning-container text-warning">
                              <span className="w-1.5 h-1.5 rounded-full bg-warning"></span>
                              Suspendido
                            </span>
                          )}
                          {m.status === 'expired' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-code text-[10.5px] font-bold bg-error-container text-error">
                              <span className="w-1.5 h-1.5 rounded-full bg-error"></span>
                              Vencido
                            </span>
                          )}
                        </td>

                        <td className="px-3.5 py-2.5">
                          <div className="flex flex-col">
                            <span
                              className={`text-xs ${
                                m.status === 'expired' ? 'text-on-surface-variant line-through' : 'text-on-surface'
                              }`}
                            >
                              {m.periodStart} — {m.periodEnd}
                            </span>
                            <span
                              className={`font-label-code text-[10.5px] font-medium ${
                                m.status === 'expired'
                                  ? 'text-error'
                                  : m.status === 'warning'
                                  ? 'text-warning'
                                  : m.validityNote.includes('días')
                                  ? 'text-warning'
                                  : 'text-secondary'
                              }`}
                            >
                              {m.validityNote}
                            </span>
                          </div>
                        </td>

                        <td className="px-3.5 py-2.5 text-right">
                          <div className="flex flex-col items-end">
                            <span className="font-label-code text-xs font-bold text-on-surface">
                              ${m.lastAmount.toLocaleString('es-AR')}
                            </span>
                            <div className="flex items-center gap-1 text-on-surface-variant">
                              <span className="material-symbols-outlined text-[13px]">payments</span>
                              <span className="font-label-code text-[10.5px]">{m.lastMethod}</span>
                            </div>
                          </div>
                        </td>

                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Primary Cobrar Button (Volt Lime + Dark Text) */}
                            {m.status === 'active' && (
                              <button
                                disabled title="Los pagos están pendientes de implementación."
                                className="px-2.5 py-1 bg-primary text-on-primary hover:bg-primary-hover rounded-lg font-bold text-xs transition-all flex items-center gap-1 shadow-sm active:scale-95"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[15px]">payments</span>
                                Cobrar
                              </button>
                            )}
                            {m.status === 'expired' && (
                              <button
                                disabled title="Los pagos están pendientes de implementación."
                                className="px-2.5 py-1 bg-error text-white hover:opacity-90 rounded-lg font-bold text-xs transition-all flex items-center gap-1 shadow-md shadow-error/20 active:scale-95"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[15px]">point_of_sale</span>
                                Cobrar
                              </button>
                            )}
                            {m.status === 'warning' && (
                              <button
                                disabled title="La reactivación está pendiente de implementación."
                                className="px-2.5 py-1 bg-surface-container hover:bg-surface-container-high text-white rounded-lg text-xs font-medium transition-colors border border-outline-variant/40"
                                type="button"
                              >
                                Reactivar
                              </button>
                            )}

                            <button
                              disabled title="Los comprobantes internos están pendientes de implementación."
                              className="p-1 bg-surface-container hover:bg-surface-container-highest text-white rounded-lg transition-colors border border-outline-variant/40"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                            </button>

                            <button
                              disabled title="La ficha no está implementada."
                              className="p-1 bg-surface-container hover:bg-surface-container-highest text-on-surface-variant hover:text-white rounded-lg transition-colors border border-outline-variant/40"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[16px]">badge</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-3.5 py-3 bg-surface-container-lowest border-t border-outline-variant/40 text-xs text-on-surface-variant">
                El listado administrativo está pendiente de integración. Podés crear un socio desde «Alta de Socio», sin asignarle una membresía ni registrar pagos.
              </div>
            </section>
          </div>
        </main>
      </div>

      {/* Auth Modal (Login / Register) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        initialMode={authModalInitialMode}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
        showToast={showToast}
        allowRegistration={currentUser?.rol === 'ADMIN'}
      />
    </div>
  );
}
