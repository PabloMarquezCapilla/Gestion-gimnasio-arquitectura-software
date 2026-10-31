import { useState, useEffect, useRef } from 'react';
import type { AuthResponse, AuthState } from './types/auth';
import { setApiSession } from './services/api';
import { AuthModal } from './components/AuthModal';
import { UserPanel } from './components/UserPanel';
import { CarCrudsPanel } from './components/CarCrudsPanel';
import { MembresiasPanel } from './components/MembresiasPanel';
import { AccesosPanel } from './components/AccesosPanel';

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
              { path: 'empleados-car-cruds', label: 'Empleados Car Cruds', icon: 'link' },
              { path: 'accesos', label: 'Recepción y Ocupación', icon: 'meeting_room' },
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
                  disabled={!['socios-y-membresias', 'planes-y-tarifas', 'empleados-car-cruds', 'accesos'].includes(item.path)}
                  title={!['socios-y-membresias', 'planes-y-tarifas', 'empleados-car-cruds', 'accesos'].includes(item.path) ? 'Sección pendiente de integración.' : undefined}
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
              onClick={() => setActiveNav('socios-y-membresias')} title="Gestionar solicitudes y pagos"
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
          {toastView}
          {activeNav === 'accesos' ? <AccesosPanel actorId={currentUser.socioId} /> : activeNav === 'empleados-car-cruds' ? <CarCrudsPanel onNuevoSocio={handleOpenRegister} /> : <MembresiasPanel actorId={currentUser.socioId} onNuevoSocio={handleOpenRegister} filtro={searchQuery} />}

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
