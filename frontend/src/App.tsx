import { useState, useEffect, useRef } from 'react';
import type { AuthResponse, AuthState } from './types/auth';
import { apiAccesosOcupacion, apiAccesosSedes, setApiSession } from './services/api';
import { AuthModal } from './components/AuthModal';
import { UserPanel } from './components/UserPanel';
import { CarCrudsPanel } from './components/CarCrudsPanel';
import { MembresiasPanel } from './components/MembresiasPanel';
import { AccesosPanel } from './components/AccesosPanel';
import { TiendaStockPanel } from './components/TiendaStockPanel';
import { ClasesPanel } from './components/ClasesPanel';
import { PanelPrincipal } from './components/PanelPrincipal';
import { ReportesPanel } from './components/ReportesPanel';
import { ConfiguracionPanel } from './components/ConfiguracionPanel';

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
  const [activeNav, setActiveNav] = useState('panel-principal');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Aforo total de las sedes para el pie de la barra lateral (solo ADMIN puede consultarlo).
  const [aforo, setAforo] = useState<number | null>(null);
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
    setMenuOpen(false);
  };

  const handleAuthSuccess = (session: AuthResponse) => {
    setIsAuthModalOpen(false);
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

  useEffect(() => {
    if (!auth.token || currentUser?.rol !== 'ADMIN' || viewMode !== 'admin') return;
    let activo = true;
    const consultar = async () => {
      try {
        const sedes = (await apiAccesosSedes()).items;
        const valores = await Promise.all(sedes.map(s => apiAccesosOcupacion(s.sedeId)));
        if (activo) setAforo(valores.reduce((t, v) => t + v.ocupacion, 0));
      } catch { if (activo) setAforo(null); }
    };
    void consultar();
    const timer = window.setInterval(() => { void consultar(); }, 30000);
    return () => { activo = false; window.clearInterval(timer); };
  }, [auth.token, currentUser?.rol, viewMode]);

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
      if (e.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

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
          <div className="auth-page">
            <aside className="auth-intro">
              <div className="auth-brand">
                <span className="admin-brand-mark" aria-hidden="true"><i /><i /><i /></span>
                <span>PULSE <b>CLUB</b></span>
              </div>
              <div className="auth-intro-copy">
                <p className="auth-eyebrow">BIENVENIDO A TU CLUB</p>
                <h2>Tu gimnasio,<br />en un solo lugar.</h2>
                <p>Consultá tu membresía, encontrá tu próxima clase y gestioná tus reservas.</p>
              </div>
              <p className="auth-intro-footer">Espacio de socios y administración</p>
            </aside>
            <main className="auth-page-main">
              <AuthModal isOpen presentation="page" onSuccess={handleAuthSuccess} showToast={showToast} />
            </main>
          </div>
        )}
        {toastView}
        {currentUser && <AuthModal
          isOpen={isAuthModalOpen}
          initialMode={authModalInitialMode}
          onClose={() => setIsAuthModalOpen(false)}
          onSuccess={handleAuthSuccess}
          showToast={showToast}
        />}
      </>
    );
  }


  const sociosView = activeNav === 'socios-y-membresias';
  const initials = currentUser.nombre.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const navigation = [
    { path: 'panel-principal', label: 'Panel principal', icon: 'dashboard' },
    { path: 'socios-y-membresias', label: 'Socios y membresías', icon: 'group' },
    { path: 'planes-y-tarifas', label: 'Planes y tarifas', icon: 'card_membership' },
    { path: 'cobros-y-caja', label: 'Cobros y caja', icon: 'account_balance_wallet' },
    { path: 'clases-y-turnos', label: 'Clases y turnos', icon: 'calendar_month' },
    { path: 'accesos', label: 'Recepción y ocupación', icon: 'meeting_room' },
    { path: 'tienda-stock', label: 'Tienda y stock', icon: 'inventory_2' },
    { path: 'empleados-car-cruds', label: 'Empleados Car Cruds', icon: 'work' },
    { path: 'reportes', label: 'Reportes', icon: 'analytics' },
    { path: 'configuracion', label: 'Configuración', icon: 'settings' },
  ];
  return (
    <div className="admin-shell">
      <a className="admin-skip" href="#admin-content">Ir al contenido</a>
      {menuOpen && <button className="admin-backdrop" aria-label="Cerrar menú de navegación" onClick={() => setMenuOpen(false)} />}
      <aside id="admin-navigation" className={`admin-sidebar${menuOpen ? ' is-open' : ''}`}>
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>PULSE <b>CLUB</b></span>
          <button className="admin-mobile-close" aria-label="Cerrar menú" onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus(); }}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div className="admin-workspace"><span className="admin-workspace-logo">PC</span><div><span>Espacio de trabajo</span><strong>PULSE CLUB</strong></div></div>
        <nav aria-label="Administración">
          {navigation.map((item, index) => <div key={item.path}>
            {(index === 0 || index === 8) && <p className="admin-nav-group">{index === 0 ? 'GESTIÓN' : 'ANÁLISIS'}</p>}
            <button type="button" aria-current={activeNav === item.path ? 'page' : undefined} className={activeNav === item.path ? 'is-active' : ''}
              onClick={() => { setActiveNav(item.path); setMenuOpen(false); }}>
              <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
            </button>
          </div>)}
        </nav>
        <div className="admin-occupancy"><span>Personas en sedes</span><strong>{aforo ?? '—'}</strong></div>
        <div className="admin-account">
          <span className="admin-avatar">{initials}</span><div><strong>{currentUser.nombre}</strong><span>Administración</span></div>
          <button type="button" onClick={handleLogout} aria-label="Cerrar sesión" title="Cerrar sesión"><span className="material-symbols-outlined" aria-hidden="true">logout</span></button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <button ref={menuButtonRef} type="button" className="admin-menu-button" aria-label="Abrir menú" aria-controls="admin-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><span className="material-symbols-outlined" aria-hidden="true">menu</span></button>
          {sociosView ? <label className="admin-search">
            <span className="material-symbols-outlined" aria-hidden="true">search</span>
            <input ref={searchInputRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} aria-label="Buscar socio en esta página" placeholder="Buscar socio, DNI o email…" type="search" /><kbd>Ctrl K</kbd>
          </label> : <span className="admin-section-name">{navigation.find(item => item.path === activeNav)?.label}</span>}
          <button type="button" className="admin-portal-link" onClick={() => setViewMode('socio')}>Vista socio <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>
          <button type="button" className="admin-icon-button" aria-label="Ir a cobros pendientes" title="Ir a cobros pendientes" onClick={() => setActiveNav('cobros-y-caja')}><span className="material-symbols-outlined" aria-hidden="true">notifications</span></button>
          <span className="admin-avatar" title={currentUser.nombre}>{initials}</span>
        </header>
        <main id="admin-content" tabIndex={-1} className="admin-content">
          {toastView}
          {activeNav === 'panel-principal' ? <PanelPrincipal onIr={setActiveNav} /> : activeNav === 'reportes' ? <ReportesPanel /> : activeNav === 'configuracion' ? <ConfiguracionPanel usuario={currentUser} /> : activeNav === 'planes-y-tarifas' ? <MembresiasPanel key={'planes-' + currentUser.socioId} actorId={currentUser.socioId} onNuevoSocio={handleOpenRegister} seccion="planes" /> : activeNav === 'cobros-y-caja' ? <MembresiasPanel key={'cobros-' + currentUser.socioId} actorId={currentUser.socioId} onNuevoSocio={handleOpenRegister} seccion="cobros" /> : activeNav === 'clases-y-turnos' ? <ClasesPanel key={currentUser.socioId} actorId={currentUser.socioId} /> : activeNav === 'tienda-stock' ? <TiendaStockPanel actorId={currentUser.socioId} /> : activeNav === 'accesos' ? <AccesosPanel actorId={currentUser.socioId} /> : activeNav === 'empleados-car-cruds' ? <CarCrudsPanel onNuevoSocio={handleOpenRegister} /> : <MembresiasPanel key={currentUser.socioId} actorId={currentUser.socioId} onNuevoSocio={handleOpenRegister} filtro={searchQuery} />}
        </main>
      </div>
      <AuthModal isOpen={isAuthModalOpen} initialMode={authModalInitialMode} onClose={() => setIsAuthModalOpen(false)} onSuccess={handleAuthSuccess} showToast={showToast} allowRegistration={currentUser.rol === 'ADMIN'} />
    </div>
  );
}
