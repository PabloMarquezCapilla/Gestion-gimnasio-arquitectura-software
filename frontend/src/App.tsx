import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AuthUser } from './types/auth';
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

export interface ReceiptData {
  receiptNumber: string;
  date: string;
  member: Member;
  planTitle: string;
  baseAmount: number;
  discount: number;
  total: number;
  paymentMethod: 'cash' | 'transfer';
  cashGiven?: number;
  cashChange?: number;
  operationCode?: string;
  validityStart: string;
  validityEnd: string;
  cashier: string;
}

export default function App() {
  // --- Auth & Role View States ---
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    const saved = localStorage.getItem('pulse_auth_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    // Usuario por defecto: Valeria Méndez (ADMIN)
    return {
      socioId: 'admin-01',
      dni: '99999999',
      nombre: 'Valeria Méndez',
      email: 'admin@pulse.com',
      rol: 'ADMIN',
      estado: 'ACTIVO',
      createdAt: '2026-01-01T00:00:00.000Z',
      telefono: '+54 9 11 9999-0000',
    };
  });

  const [viewMode, setViewMode] = useState<'admin' | 'socio'>(() => {
    return currentUser?.rol === 'SOCIO' ? 'socio' : 'admin';
  });
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalInitialMode, setAuthModalInitialMode] = useState<'login' | 'register'>('login');

  // --- Navigation & Filter States ---
  const [activeNav, setActiveNav] = useState('socios-y-membresias');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'warning' | 'expired'>('all');
  const [planFilter, setPlanFilter] = useState<string>('');
  const [expiryFilter, setExpiryFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- Financial & KPI States ---
  const [cajaTotal, setCajaTotal] = useState<number>(284500);
  const [ingresosHoy, setIngresosHoy] = useState<number>(74200);

  // --- Modals State ---
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState<boolean>(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  // Form Payment States
  const [paymentPlanPrice, setPaymentPlanPrice] = useState<number>(24000);
  const [paymentPlanName, setPaymentPlanName] = useState<string>('Pase Libre Mensual');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer'>('cash');
  const [cashReceived, setCashReceived] = useState<number>(24000);
  const [operationCode, setOperationCode] = useState<string>('');
  const [validityStart, setValidityStart] = useState<string>('2025-02-16');

  // Receipt Modal State
  const [activeReceipt, setActiveReceipt] = useState<ReceiptData | null>(null);

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

  const handleAuthSuccess = (user: AuthUser) => {
    setCurrentUser(user);
    localStorage.setItem('pulse_auth_user', JSON.stringify(user));
    if (user.rol === 'SOCIO') {
      setViewMode('socio');
    } else {
      setViewMode('admin');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('pulse_auth_user');
    showToast('Sesión finalizada.', 'logout');
  };

  const handleOpenLogin = () => {
    setAuthModalInitialMode('login');
    setIsAuthModalOpen(true);
  };

  const handleOpenRegister = () => {
    setAuthModalInitialMode('register');
    setIsAuthModalOpen(true);
  };

  // --- Initial Members Data ---
  const [members, setMembers] = useState<Member[]>([
    {
      id: 'soc-1',
      code: '#P-1084',
      name: 'Agustín Pereyra',
      initials: 'AP',
      dni: '38.912.441',
      phone: '+54 9 11 3914-2201',
      planKey: 'musculacion',
      planName: 'Pase Libre Musculación',
      planDesc: 'Acceso Turno Completo',
      status: 'active',
      periodStart: '15 Ene 2025',
      periodEnd: '15 Feb 2025',
      validityNote: 'Vence en 3 días (Sábado)',
      lastAmount: 24000,
      lastMethod: 'Efectivo • 15/01',
      lastDate: '15/01',
    },
    {
      id: 'soc-2',
      code: '#P-0934',
      name: 'Mateo Benítez',
      avatarUrl:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuCDQLKom_jS5r7VTVwzau0ziNRfWf_qFXtSSYy0F3EhBJ_C80htUfB3escut2bynYzAscX0Vk_lJ8eaatC8Hs1n-QTka7xNBWQ1tr0RUG1vHVXKoga1VcCpWpF83EkL18TqHhrQBWOYUZTAPkuzeSLNjrGhI_pbdxABOcL26bST9h29Ev17hj_hF7qO7LtOBYzgmt9cXYIMcFyWc6yowi1tUeU_UQ9FpImKTvF2ILkz',
      dni: '39.402.115',
      phone: '+54 9 11 4829-1102',
      planKey: 'cross',
      planName: 'Full Functional & Cardio',
      planDesc: 'Musculación + Clases Grupales',
      status: 'active',
      periodStart: '12 Feb 2025',
      periodEnd: '12 Mar 2025',
      validityNote: 'Renovado hoy (30 días)',
      lastAmount: 21600,
      lastMethod: 'Efectivo (-10%) • Hoy',
      lastDate: 'Hoy',
    },
    {
      id: 'soc-3',
      code: '#P-1011',
      name: 'Camila Rossi',
      avatarUrl:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuCR2HC0xkJr74KzPnztXeh4hoAMB4c11t370W37m2L-r8rcTfkwKHkyLCXuNN6cEyPPyCxJ__TYS5BLiRJqhl-8gmFB-gJWt-AJ2oCIFjckw3GdC8IIzeB84UsTB2dXTm13qh3XhccNF2RvA75K2vfQ0Vh8S3i7SdI34xSW7BvvxAe2hJAUgbyH08VHYBqK9oteWaeTK-xObOscwwhO4fcssgd9ylaJhyVsz8xSmAKr',
      dni: '41.205.889',
      phone: '+54 9 11 5509-8833',
      planKey: 'estudiante',
      planName: 'Pase Estudiante',
      planDesc: 'Horario Reducido (13 a 17 hs)',
      status: 'expired',
      periodStart: '08 Ene 2025',
      periodEnd: '08 Feb 2025',
      validityNote: 'Vencido hace 4 días',
      lastAmount: 16500,
      lastMethod: 'Transferencia • 08/01',
      lastDate: '08/01',
    },
    {
      id: 'soc-4',
      code: '#P-0855',
      name: 'Franco Santillán',
      initials: 'FS',
      dni: '35.882.110',
      phone: '+54 9 11 6021-9988',
      planKey: 'trimestral',
      planName: 'Plan Trimestral VIP',
      planDesc: 'Pase Libre + Spa + Toallas',
      status: 'warning',
      periodStart: '01 Dic 2024',
      periodEnd: '01 Mar 2025',
      validityNote: 'Pausa médica hasta 20 Feb',
      lastAmount: 62000,
      lastMethod: 'Transferencia • 01/12',
      lastDate: '01/12',
    },
    {
      id: 'soc-5',
      code: '#P-0720',
      name: 'Lucía Herrera',
      avatarUrl:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuDcsA-DUk8j_SOuvQndUj0ZoBI4c8Do0yCv-gbHdyrp4GLjwWH-d5AchDvMNE4ulUzLSyNZ7bRIBnQz6LKcO7ITDgI0O72CpzFrSoLwwUHhLHxt4_T7f-aGiabSjC9f4ys_Nr3tHULsWPosJlI3XydYcPYm2C4KdoAQcmExiRLCfpcthQV4X3Rppniw6svAY2_6wSqfkFBulMEryuHJnFxGttUK-E9X2Soczn0_6VQT',
      dni: '36.441.902',
      phone: '+54 9 11 4110-3329',
      planKey: 'trimestral',
      planName: 'Semestral Elite',
      planDesc: 'Todas las Sedes + Nutrición',
      status: 'active',
      periodStart: '10 Nov 2024',
      periodEnd: '10 May 2025',
      validityNote: 'Vence en 87 días',
      lastAmount: 114000,
      lastMethod: 'Transferencia • 10/11',
      lastDate: '10/11',
    },
  ]);

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

  // Handlers
  const handleOpenPayment = (member?: Member) => {
    const target = member || members[0];
    setSelectedMember(target);
    setPaymentPlanPrice(24000);
    setPaymentPlanName('Pase Libre Mensual');
    setCashReceived(24000);
    setPaymentMethod('cash');
    setIsPaymentModalOpen(true);
  };

  const handleOpenReceipt = (member: Member) => {
    const receipt: ReceiptData = {
      receiptNumber: `#REC-2025-00${Math.floor(800 + Math.random() * 190)}`,
      date: '12/02/2025 — 11:24 hs',
      member,
      planTitle: `Renovación Membresía - ${member.planName}`,
      baseAmount: member.lastAmount || 24000,
      discount: member.lastMethod.includes('-10%') ? 2400 : 0,
      total: member.lastAmount || 21600,
      paymentMethod: member.lastMethod.toLowerCase().includes('efectivo') ? 'cash' : 'transfer',
      cashGiven: 22000,
      cashChange: 400,
      validityStart: member.periodStart,
      validityEnd: member.periodEnd,
      cashier: 'Valeria Méndez',
    };
    setActiveReceipt(receipt);
    setIsReceiptModalOpen(true);
  };

  const handleReactivate = (memberId: string) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? {
              ...m,
              status: 'active',
              validityNote: 'Reactivado hoy (Pase Activo)',
            }
          : m
      )
    );
    showToast('Socio reactivado exitosamente. Ingreso habilitado en molinetes.', 'verified');
  };

  const handleConfirmPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember) return;

    const discount = paymentMethod === 'cash' ? Math.round(paymentPlanPrice * 0.1) : 0;
    const finalTotal = paymentPlanPrice - discount;

    setMembers((prev) =>
      prev.map((m) =>
        m.id === selectedMember.id
          ? {
              ...m,
              status: 'active',
              planName: paymentPlanName,
              validityNote: 'Renovado hoy (30 días de vigencia)',
              lastAmount: finalTotal,
              lastMethod: paymentMethod === 'cash' ? 'Efectivo (-10%) • Hoy' : 'Transferencia • Hoy',
              periodStart: '16 Feb 2025',
              periodEnd: '16 Mar 2025',
            }
          : m
      )
    );

    setCajaTotal((prev) => prev + finalTotal);
    setIngresosHoy((prev) => prev + finalTotal);

    const newReceipt: ReceiptData = {
      receiptNumber: `#REC-2025-00${Math.floor(900 + Math.random() * 99)}`,
      date:
        new Date().toLocaleDateString('es-AR') +
        ' — ' +
        new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) +
        ' hs',
      member: { ...selectedMember, planName: paymentPlanName },
      planTitle: `Cobro Membresía — ${paymentPlanName}`,
      baseAmount: paymentPlanPrice,
      discount,
      total: finalTotal,
      paymentMethod,
      cashGiven: paymentMethod === 'cash' ? cashReceived : undefined,
      cashChange: paymentMethod === 'cash' ? Math.max(0, cashReceived - finalTotal) : undefined,
      operationCode: paymentMethod === 'transfer' ? operationCode || 'OP-8941029' : undefined,
      validityStart: validityStart,
      validityEnd: '16/03/2025',
      cashier: 'Valeria Méndez',
    };

    setIsPaymentModalOpen(false);
    setActiveReceipt(newReceipt);
    setIsReceiptModalOpen(true);
    showToast(`Pago de $${finalTotal.toLocaleString('es-AR')} registrado para ${selectedMember.name}.`, 'payments');
  };

  const discountAmount = paymentMethod === 'cash' ? Math.round(paymentPlanPrice * 0.1) : 0;
  const netPlanPrice = paymentPlanPrice - discountAmount;
  const cashChange = cashReceived - netPlanPrice;

  if (viewMode === 'socio') {
    return (
      <>
        {currentUser ? (
          <UserPanel
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
                  Accede a tu pase digital QR para molinetes, reserva clases en vivo y consulta tu membresía.
                </p>
              </div>
              <div className="space-y-3 pt-2">
                <button
                  onClick={handleOpenLogin}
                  className="w-full py-3 px-4 rounded-xl bg-[#CCFF00] hover:bg-[#b5e600] text-black font-['Space_Grotesk'] font-bold text-sm shadow-[0_0_20px_rgba(204,255,0,0.3)] transition-all flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">login</span>
                  <span>Iniciar Sesión como Socio</span>
                </button>
                <button
                  onClick={handleOpenRegister}
                  className="w-full py-3 px-4 rounded-xl bg-[#1E293B] hover:bg-[#283548] border border-[#334155] text-white font-['Space_Grotesk'] font-bold text-sm transition-all flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">person_add</span>
                  <span>Registrarme como Nuevo Socio</span>
                </button>
              </div>
              <div className="pt-4 border-t border-[#222A3D] text-[11px] text-gray-500">
                <button
                  onClick={() => setViewMode('admin')}
                  className="text-gray-400 hover:text-[#CCFF00] transition-colors"
                >
                  ← Ir a la Vista de Administrador / Caja
                </button>
              </div>
            </div>
          </div>
        )}
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
                  Estado Turno
                </span>
              </div>
              <span className="font-label-code text-[11px] text-secondary font-bold">ONLINE</span>
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
            <span className="font-label-code text-xs text-on-surface font-bold">68%</span>
          </div>
          <div className="text-center">
            <span className="font-label-code text-[10px] text-on-surface-variant/70">PULSE OS v2.4</span>
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
              <span className="font-semibold text-on-surface">Sede Central - Palermo</span>
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
                title="Probar portal del socio"
              >
                Ver como Socio
              </button>
            </div>

            {/* Primary Action Button (Volt Lime + Dark Text) */}
            <button
              onClick={() => handleOpenPayment()}
              className="flex items-center gap-1 bg-primary text-on-primary px-3 py-1 rounded-lg text-xs font-bold hover:bg-primary-hover shadow-sm transition-all active:scale-95"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Registrar Pago</span>
            </button>

            <button
              aria-label="Notificaciones de caja"
              onClick={() => showToast('Caja sin diferencias pendientes de conciliación.', 'notifications')}
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
            {/* Live Interactive Toast */}
            <div
              className={`fixed bottom-5 right-5 z-50 transform transition-all duration-300 pointer-events-none bg-surface-container-high text-on-surface px-3 py-2 rounded-lg shadow-xl flex items-center gap-2 border border-outline-variant ${
                toast.show ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0'
              }`}
            >
              <span className="material-symbols-outlined text-primary text-base">{toast.icon}</span>
              <span className="text-xs font-medium">{toast.message}</span>
            </div>

            {/* Top Banner / View Header */}
            <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4 pt-3">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-label-code text-primary uppercase tracking-wider flex items-center gap-1 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                    Terminal de Control en Vivo
                  </span>
                  <span className="text-on-surface-variant font-label-code text-[10px]">•</span>
                  <span className="font-label-code text-[10.5px] text-on-surface-variant">Sede Palermo Centro</span>
                </div>
                <h1 className="font-headline text-headline-lg text-on-surface tracking-tight font-bold">
                  Gestión de Membresías y Caja
                </h1>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Control de socios, estados de membresía y facturación diaria en Sede Central.
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
                      ${cajaTotal.toLocaleString('es-AR')}{' '}
                      <span className="font-label-code text-[10px] font-normal text-on-surface-variant">ARS</span>
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => showToast('Exportación a formato Excel (.xlsx) generada con éxito.', 'file_download')}
                  className="flex items-center gap-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors border border-outline-variant/40"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[16px]">file_download</span>
                  <span>Exportar Excel</span>
                </button>

                {/* Primary Button (+ Registrar Cobro / Pago) */}
                <button
                  onClick={() => handleOpenPayment()}
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
                  <span className="font-data-metric text-data-metric text-on-surface font-bold">418</span>
                  <div className="flex items-center gap-0.5 bg-secondary-container text-secondary px-1.5 py-0.2 rounded-full font-label-code text-[10.5px] font-bold">
                    <span className="material-symbols-outlined text-[13px]">arrow_upward</span>
                    <span>+12%</span>
                  </div>
                </div>
                <div className="w-full bg-surface-container h-1 rounded-full mt-2.5 overflow-hidden">
                  <div className="bg-secondary h-full rounded-full" style={{ width: '86%' }}></div>
                </div>
                <span className="font-body-sm text-[11px] text-on-surface-variant mt-1.5">
                  86% de aforo objetivo cubierto
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
                  <span className="font-data-metric text-data-metric text-on-surface font-bold">29</span>
                  <span className="font-label-code text-[10.5px] text-warning bg-warning-container px-1.5 py-0.2 rounded-full font-semibold">
                    Alerta Preventiva
                  </span>
                </div>
                <div className="w-full bg-surface-container h-1 rounded-full mt-2.5 overflow-hidden">
                  <div className="bg-warning h-full rounded-full" style={{ width: '44%' }}></div>
                </div>
                <span className="font-body-sm text-[11px] text-on-surface-variant mt-1.5">
                  Campaña de WhatsApp activa
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
                  <span className="font-data-metric text-data-metric text-on-surface font-bold">18</span>
                  <span className="font-label-code text-[10.5px] text-error bg-error-container px-1.5 py-0.2 rounded-full font-semibold">
                    Acceso Bloqueado
                  </span>
                </div>
                <div className="w-full bg-surface-container h-1 rounded-full mt-2.5 overflow-hidden">
                  <div className="bg-error h-full rounded-full" style={{ width: '28%' }}></div>
                </div>
                <span className="font-body-sm text-[11px] text-on-surface-variant mt-1.5">
                  3.8% de tasa de mora mensual
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
                    ${ingresosHoy.toLocaleString('es-AR')}
                  </span>
                  <span className="font-label-code text-[10px] text-on-surface-variant">ARS</span>
                </div>
                <div className="w-full bg-surface-container h-1 rounded-full mt-2.5 overflow-hidden">
                  <div className="bg-primary h-full rounded-full" style={{ width: '62%' }}></div>
                </div>
                <span className="font-body-sm text-[11px] text-on-surface-variant mt-1.5">
                  8 cobranzas registradas en turno
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
                      465
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
                      418
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
                      18
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
                      29
                    </span>
                  </button>
                </div>

                {/* Quick Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Plan selector */}
                  <div className="relative">
                    <select
                      value={planFilter}
                      onChange={(e) => setPlanFilter(e.target.value)}
                      className="appearance-none bg-surface-container-lowest text-on-surface text-xs pl-3 pr-7 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary border border-outline-variant/40"
                    >
                      <option value="">Todos los planes</option>
                      <option value="musculacion">Pase Libre Musculación</option>
                      <option value="cross">Full Cross & Fitness</option>
                      <option value="trimestral">Plan Trimestral VIP</option>
                      <option value="estudiante">Pase Estudiante</option>
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
                                onClick={() => handleOpenPayment(m)}
                                className="px-2.5 py-1 bg-primary text-on-primary hover:bg-primary-hover rounded-lg font-bold text-xs transition-all flex items-center gap-1 shadow-sm active:scale-95"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[15px]">payments</span>
                                Cobrar
                              </button>
                            )}
                            {m.status === 'expired' && (
                              <button
                                onClick={() => handleOpenPayment(m)}
                                className="px-2.5 py-1 bg-error text-white hover:opacity-90 rounded-lg font-bold text-xs transition-all flex items-center gap-1 shadow-md shadow-error/20 active:scale-95"
                                type="button"
                              >
                                <span className="material-symbols-outlined text-[15px]">point_of_sale</span>
                                Cobrar
                              </button>
                            )}
                            {m.status === 'warning' && (
                              <button
                                onClick={() => handleReactivate(m.id)}
                                className="px-2.5 py-1 bg-surface-container hover:bg-surface-container-high text-white rounded-lg text-xs font-medium transition-colors border border-outline-variant/40"
                                type="button"
                              >
                                Reactivar
                              </button>
                            )}

                            <button
                              onClick={() => handleOpenReceipt(m)}
                              className="p-1 bg-surface-container hover:bg-surface-container-highest text-white rounded-lg transition-colors border border-outline-variant/40"
                              title="Ver Comprobante"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                            </button>

                            <button
                              onClick={() =>
                                showToast(`Ficha técnica y biométrica de ${m.name} abierta en terminal.`, 'badge')
                              }
                              className="p-1 bg-surface-container hover:bg-surface-container-highest text-on-surface-variant hover:text-white rounded-lg transition-colors border border-outline-variant/40"
                              title="Ficha Socio"
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

              {/* Table Footer / Pagination */}
              <div className="flex flex-col sm:flex-row items-center justify-between px-3.5 py-2 bg-surface-container-lowest gap-2 border-t border-outline-variant/40">
                <span className="font-label-code text-[11px] text-on-surface-variant">
                  Mostrando {filteredMembers.length} de 465 socios registrados
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="p-1 rounded bg-surface-container text-on-surface-variant hover:text-white disabled:opacity-30"
                    disabled
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                  </button>
                  <button
                    className="w-6 h-6 rounded bg-primary text-on-primary font-label-code text-xs font-bold flex items-center justify-center shadow-sm"
                    type="button"
                  >
                    1
                  </button>
                  <button
                    className="w-6 h-6 rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-label-code text-xs flex items-center justify-center"
                    type="button"
                  >
                    2
                  </button>
                  <button
                    className="w-6 h-6 rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-label-code text-xs flex items-center justify-center"
                    type="button"
                  >
                    3
                  </button>
                  <span className="font-label-code text-xs text-on-surface-variant px-1">...</span>
                  <button
                    className="w-6 h-6 rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-label-code text-xs flex items-center justify-center"
                    type="button"
                  >
                    47
                  </button>
                  <button
                    className="p-1 rounded bg-surface-container text-on-surface-variant hover:text-white"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>

      {/* --- MODAL 1: REGISTRAR COBRO / PAGO DE MEMBRESÍA --- */}
      {isPaymentModalOpen && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 transition-opacity duration-200">
          <div className="bg-surface-container-low rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col border border-outline-variant/60">
            {/* Modal Header */}
            <div className="px-4 py-3 bg-surface-container-lowest flex items-center justify-between border-b border-outline-variant/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[18px]">point_of_sale</span>
                </div>
                <div>
                  <h2 className="font-bold text-sm text-on-surface">Registrar Pago de Membresía</h2>
                  <span className="font-label-code text-[10.5px] text-on-surface-variant">
                    Caja Operativa • Sede Palermo
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsPaymentModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-white flex items-center justify-center transition-colors"
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            {/* Modal Body Form */}
            <form onSubmit={handleConfirmPayment} className="p-4 flex flex-col gap-3 overflow-y-auto max-h-[85vh]">
              {/* Socio Selector */}
              <div className="flex flex-col gap-1">
                <label className="font-label-md text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">
                  Socio Seleccionado
                </label>
                <div className="bg-surface-container-lowest rounded-xl p-2.5 flex items-center justify-between border border-outline-variant/40">
                  <div className="flex items-center gap-2.5">
                    {selectedMember.avatarUrl ? (
                      <img
                        alt={selectedMember.name}
                        className="w-8 h-8 rounded-full object-cover ring-1 ring-surface-variant"
                        src={selectedMember.avatarUrl}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-surface-container text-primary font-bold text-xs flex items-center justify-center border border-primary/20">
                        {selectedMember.initials || 'AP'}
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-on-surface">
                        {selectedMember.name}
                      </span>
                      <span className="font-label-code text-[10.5px] text-on-surface-variant">
                        DNI {selectedMember.dni} • Socio {selectedMember.code}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const next = members[(members.findIndex((m) => m.id === selectedMember.id) + 1) % members.length];
                      setSelectedMember(next);
                    }}
                    className="text-primary font-label-code text-xs hover:underline font-semibold"
                    type="button"
                  >
                    Cambiar
                  </button>
                </div>
              </div>

              {/* Plan Selection */}
              <div className="flex flex-col gap-1">
                <label className="font-label-md text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">
                  Plan a Renovar / Activar
                </label>
                <div className="relative">
                  <select
                    value={paymentPlanPrice}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setPaymentPlanPrice(val);
                      setCashReceived(val);
                      if (val === 24000) setPaymentPlanName('Pase Libre Mensual');
                      else if (val === 62000) setPaymentPlanName('Plan Trimestral VIP');
                      else if (val === 18000) setPaymentPlanName('Pase 10 Clases Grupales');
                      else if (val === 114000) setPaymentPlanName('Semestral Elite Total');
                    }}
                    className="w-full appearance-none bg-surface-container-lowest text-on-surface text-xs px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary border border-outline-variant/40"
                  >
                    <option value={24000}>Pase Libre Mensual — $24.000 ARS</option>
                    <option value={62000}>Plan Trimestral VIP — $62.000 ARS (15% OFF)</option>
                    <option value={18000}>Pase 10 Clases Grupales — $18.000 ARS</option>
                    <option value={114000}>Semestral Elite Total — $114.000 ARS</option>
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-2.5 top-2 text-on-surface-variant text-[16px]">
                    expand_more
                  </span>
                </div>
              </div>

              {/* Payment Method Tabs */}
              <div className="flex flex-col gap-1">
                <label className="font-label-md text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">
                  Método de Pago
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-surface-container-lowest rounded-lg border border-outline-variant/40">
                  <button
                    onClick={() => setPaymentMethod('cash')}
                    className={`py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                      paymentMethod === 'cash'
                        ? 'bg-surface-container text-white border border-outline-variant'
                        : 'text-on-surface-variant hover:text-white'
                    }`}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px] text-secondary">payments</span>
                    <span>Efectivo (10% OFF)</span>
                  </button>
                  <button
                    onClick={() => setPaymentMethod('transfer')}
                    className={`py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                      paymentMethod === 'transfer'
                        ? 'bg-surface-container text-white border border-outline-variant'
                        : 'text-on-surface-variant hover:text-white'
                    }`}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary">qr_code_2</span>
                    <span>Transferencia / QR</span>
                  </button>
                </div>
              </div>

              {/* Cash Computation Grid */}
              {paymentMethod === 'cash' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/40">
                  <div className="flex flex-col gap-1">
                    <label className="font-label-code text-[11px] text-on-surface-variant">Monto Recibido</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1.5 font-label-code text-on-surface-variant text-xs">$</span>
                      <input
                        value={cashReceived}
                        onChange={(e) => setCashReceived(parseFloat(e.target.value) || 0)}
                        className="w-full bg-surface-container pl-6 pr-2.5 py-1.5 rounded-md font-label-code text-xs font-bold text-on-surface focus:outline-none focus:ring-1 focus:ring-primary border border-outline-variant/40"
                        type="number"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-label-code text-[11px] text-on-surface-variant">Vuelto a Entregar</label>
                    <div className="bg-surface-container px-2.5 py-1.5 rounded-md flex items-center justify-between border border-outline-variant/40">
                      <span
                        className={`font-label-code text-sm font-bold ${
                          cashChange >= 0 ? 'text-secondary' : 'text-error'
                        }`}
                      >
                        {cashChange >= 0
                          ? `$${cashChange.toLocaleString('es-AR')}`
                          : `-$${Math.abs(cashChange).toLocaleString('es-AR')}`}
                      </span>
                      <span className="font-label-code text-[10px] text-on-surface-variant">ARS</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Operation Number for Transfer */}
              {paymentMethod === 'transfer' && (
                <div className="flex flex-col gap-1">
                  <label className="font-label-md text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">
                    N° de Operación / Comprobante MP
                  </label>
                  <input
                    value={operationCode}
                    onChange={(e) => setOperationCode(e.target.value)}
                    className="w-full bg-surface-container-lowest px-3 py-2 rounded-lg text-xs text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-1 focus:ring-primary border border-outline-variant/40"
                    placeholder="Ej: OP-8941029482 o Alias 'PULSE.GYM.CENTRAL'"
                    type="text"
                  />
                </div>
              )}

              {/* Start Date & Cashier */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <label className="font-label-md text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">
                    Inicio Nueva Vigencia
                  </label>
                  <input
                    value={validityStart}
                    onChange={(e) => setValidityStart(e.target.value)}
                    className="w-full bg-surface-container-lowest text-on-surface text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary border border-outline-variant/40"
                    type="date"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-label-md text-[11px] text-on-surface-variant uppercase tracking-wider font-semibold">
                    Operador de Turno
                  </label>
                  <div className="bg-surface-container-lowest px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-on-surface-variant border border-outline-variant/40">
                    <span className="material-symbols-outlined text-[16px] text-primary">person_pin</span>
                    <span className="font-label-code text-xs text-on-surface">Valeria Méndez (Caja #1)</span>
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/40">
                <button
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-xs text-white transition-colors border border-outline-variant/40"
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold hover:bg-primary-hover shadow-md transition-all flex items-center gap-1.5 active:scale-95"
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>Confirmar y Emitir Comprobante</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: VISTA PREVIA DETALLADA DE COMPROBANTE INTERNO --- */}
      {isReceiptModalOpen && activeReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 transition-opacity duration-200">
          <div className="bg-surface-container-low rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col border border-outline-variant/60">
            {/* Receipt Top Bar */}
            <div className="px-4 py-2.5 bg-surface-container-lowest flex items-center justify-between border-b border-outline-variant/40">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-secondary text-[18px]">verified</span>
                <span className="font-bold text-xs text-on-surface">
                  Comprobante Interno Digital
                </span>
              </div>
              <button
                onClick={() => setIsReceiptModalOpen(false)}
                className="w-6 h-6 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-white flex items-center justify-center"
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            {/* Voucher Paper Styling */}
            <div className="p-4 bg-surface-container-lowest m-3 rounded-xl flex flex-col gap-2.5 text-xs relative shadow-inner border border-outline-variant/40">
              {/* Gym Branding */}
              <div className="flex items-center justify-between pb-2 border-b border-outline-variant/30">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-primary text-[22px]">bolt</span>
                  <div className="flex flex-col">
                    <span className="font-bold text-xs text-on-surface tracking-wide leading-none">
                      PULSE GYM & FITNESS
                    </span>
                    <span className="font-label-code text-[10px] text-on-surface-variant tracking-tight mt-0.5">
                      Sede Palermo • Av. Santa Fe 3420, CABA
                    </span>
                  </div>
                </div>
                <span className="font-label-code text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-primary font-bold border border-primary/20">
                  RECIBO OK
                </span>
              </div>

              <div className="bg-surface-container/60 p-1.5 rounded text-center border border-outline-variant/30">
                <span className="font-label-code text-[10px] text-on-surface-variant block uppercase tracking-wider">
                  Comprobante de Pago Interno (No fiscal)
                </span>
              </div>

              {/* Metadata */}
              <div className="flex items-center justify-between font-label-code text-[11px] py-1 border-b border-outline-variant/30">
                <div>
                  <span className="text-on-surface-variant block text-[10px]">N° Comprobante:</span>
                  <span className="text-on-surface font-bold">{activeReceipt.receiptNumber}</span>
                </div>
                <div className="text-right">
                  <span className="text-on-surface-variant block text-[10px]">Fecha y Hora:</span>
                  <span className="text-on-surface">{activeReceipt.date}</span>
                </div>
              </div>

              {/* Member Info */}
              <div className="bg-surface-container-low p-2 rounded-lg flex flex-col gap-1 border border-outline-variant/30">
                <span className="font-label-code text-[10px] text-on-surface-variant uppercase font-semibold">
                  Datos del Socio
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-on-surface">
                    {activeReceipt.member.name}
                  </span>
                  <span className="font-label-code text-[11px] text-secondary font-bold">
                    {activeReceipt.member.code}
                  </span>
                </div>
                <div className="flex items-center justify-between font-label-code text-[10.5px] text-on-surface-variant">
                  <span>DNI: {activeReceipt.member.dni}</span>
                  <span>Tel: {activeReceipt.member.phone}</span>
                </div>
              </div>

              {/* Breakdown */}
              <div className="flex flex-col gap-1 py-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-on-surface">
                    {activeReceipt.planTitle}
                  </span>
                  <span className="font-label-code text-xs text-on-surface font-bold">
                    ${activeReceipt.baseAmount.toLocaleString('es-AR')}
                  </span>
                </div>
                <span className="font-label-code text-[10.5px] text-on-surface-variant">
                  Período: {activeReceipt.validityStart} al {activeReceipt.validityEnd} (30 días de acceso)
                </span>
                <span className="font-label-code text-[10px] text-secondary">
                  Acceso incluido: Musculación, Clases guiadas y Lockers Sede Palermo
                </span>

                {activeReceipt.discount > 0 && (
                  <div className="flex items-center justify-between pt-1 text-secondary font-label-code text-xs font-bold">
                    <span>Descuento Promoción Efectivo (10%)</span>
                    <span>-${activeReceipt.discount.toLocaleString('es-AR')}</span>
                  </div>
                )}
              </div>

              {/* Highlighted Total (Volt Lime Container) */}
              <div className="bg-primary text-on-primary p-3 rounded-xl flex items-center justify-between shadow-md">
                <div className="flex flex-col">
                  <span className="font-label-code text-[10px] font-bold uppercase tracking-wider">
                    TOTAL ABONADO
                  </span>
                  <span className="font-label-code text-[10.5px] opacity-90 font-medium">
                    {activeReceipt.paymentMethod === 'cash'
                      ? `Efectivo (Entregado: $${(activeReceipt.cashGiven || activeReceipt.total).toLocaleString('es-AR')} | Vuelto: $${(activeReceipt.cashChange || 0).toLocaleString('es-AR')})`
                      : `Transferencia / QR (${activeReceipt.operationCode || 'Aprobada'})`}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold leading-none">
                    ${activeReceipt.total.toLocaleString('es-AR')}
                  </span>
                  <span className="font-label-code text-[10px] block text-right font-bold">ARS</span>
                </div>
              </div>

              {/* Cashier & QR */}
              <div className="flex items-center justify-between pt-1 gap-2">
                <div className="flex flex-col">
                  <span className="font-label-code text-[10px] text-on-surface-variant">Atendido por:</span>
                  <span className="text-xs text-on-surface font-semibold">
                    {activeReceipt.cashier}
                  </span>
                  <span className="font-label-code text-[9.5px] text-on-surface-variant">
                    Operador #04 • Caja Matutina
                  </span>
                </div>

                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-12 h-12 bg-white p-1 rounded-md flex items-center justify-center">
                    <svg className="w-full h-full text-black" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M2 2h8v8H2V2zm2 2v4h4V4H4zm10-2h8v8h-8V2zm2 2v4h4V4h-4zM2 14h8v8H2v-8zm2 2v4h4v-4H4zm10-2h3v3h-3v-3zm5 0h3v3h-3v-3zm-5 5h3v3h-3v-3zm5 0h3v3h-3v-3zm-2.5-2.5h3v3h-3v-3z"></path>
                    </svg>
                  </div>
                  <span className="font-label-code text-[8.5px] text-on-surface-variant">Molinete Habilitado</span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2.5 bg-surface-container flex flex-wrap items-center justify-between gap-1.5 border-t border-outline-variant/40">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1 px-3 py-1.5 bg-surface-container-high hover:bg-surface-bright text-white rounded-lg text-xs font-semibold transition-colors border border-outline-variant/40"
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">print</span>
                <span>Imprimir Térmico</span>
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() =>
                    alert(`Comprobante enviado exitosamente por WhatsApp a ${activeReceipt.member.phone}`)
                  }
                  className="flex items-center gap-1 px-3 py-1.5 bg-secondary text-on-secondary rounded-lg text-xs font-bold hover:bg-secondary-hover transition-colors shadow-sm"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[16px]">send</span>
                  <span>WhatsApp</span>
                </button>

                <button
                  onClick={() => showToast('Descargando archivo PDF del comprobante...', 'download')}
                  className="flex items-center gap-1 p-1.5 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-lg transition-colors border border-outline-variant/40"
                  title="Descargar PDF"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal (Login / Register) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        initialMode={authModalInitialMode}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
        showToast={showToast}
      />
    </div>
  );
}
