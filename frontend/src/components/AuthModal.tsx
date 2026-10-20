import React, { useState, useEffect } from 'react';
import { AuthResponse } from '../types/auth';
import { apiLogin, apiRegistro } from '../services/api';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'register';
  onClose: () => void;
  onSuccess: (session: AuthResponse) => void;
  allowRegistration?: boolean;
  showToast: (msg: string, icon?: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'login',
  onClose,
  onSuccess,
  showToast,
  allowRegistration = false,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Login Form State
  const [loginIdentificador, setLoginIdentificador] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register Form State
  const [regNombre, setRegNombre] = useState('');
  const [regDni, setRegDni] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regTelefono, setRegTelefono] = useState('');
  const [regPassword, setRegPassword] = useState('');
  useEffect(() => {
    if (isOpen) {
      setMode(allowRegistration ? initialMode : 'login');
      setErrorMessage('');
      setLoginPassword('');
      setRegPassword('');
      setShowPassword(false);
    }
  }, [isOpen, initialMode, allowRegistration]);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdentificador || !loginPassword) {
      setErrorMessage('Por favor ingrese su email o DNI y contraseña.');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const res = await apiLogin(loginIdentificador, loginPassword);
      showToast(`¡Bienvenido, ${res.socio.nombre}!`, 'verified_user');
      onSuccess(res);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Credenciales inválidas. Verifique sus datos.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowRegistration) return;
    if (!regNombre || !regDni || !regEmail || !regPassword) {
      setErrorMessage('Nombre, DNI, Email y Contraseña son obligatorios.');
      return;
    }

    if (regPassword.length < 6) {
      setErrorMessage('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const res = await apiRegistro({
        nombre: regNombre,
        dni: regDni,
        email: regEmail,
        telefono: regTelefono,
        password: regPassword,
      });

      showToast(`Socio ${res.socio.nombre} creado sin membresía. Plan y pago pendientes.`, 'person_add');
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al registrar socio.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-surface-container border border-outline-variant/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="relative px-5 pt-5 pb-3.5 border-b border-outline-variant/50 bg-surface-container-low">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-on-primary font-black font-headline text-lg shadow-sm">
              P
            </div>
            <div>
              <h3 className="font-headline text-headline-sm font-bold tracking-tight text-on-surface flex items-center gap-2">
                PULSE CLUB <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/15 text-primary border border-primary/30 font-label-code">AUTH</span>
              </h3>
              <p className="text-[11px] text-on-surface-variant">Acceso integral para Socios y Equipo Administrativo</p>
            </div>
          </div>

          {/* Selector de Pestañas */}
          {allowRegistration && <div className="mt-3.5 grid grid-cols-2 p-0.5 bg-surface-container-lowest rounded-lg border border-outline-variant/40">
            <button
              type="button"
              onClick={() => { setMode('login'); setErrorMessage(''); }}
              className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                mode === 'login'
                  ? 'bg-surface-container text-primary font-bold shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setErrorMessage(''); }}
              className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                mode === 'register'
                  ? 'bg-surface-container text-primary font-bold shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Alta de Socio
            </button>
          </div>}
        </div>

        {/* Mensaje de Error si hay */}
        {errorMessage && (
          <div className="mx-5 mt-3 p-2.5 rounded-lg bg-error-container border border-error/30 flex items-center gap-2 text-error text-xs animate-shake">
            <span className="material-symbols-outlined text-base">error</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Contenido Scrollable */}
        <div className="p-5 overflow-y-auto space-y-3.5 text-on-surface">
          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-3">
              <div>
                <label className="block text-label-code text-label-code text-on-surface-variant uppercase tracking-wider mb-1">
                  Email o Documento (DNI)
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-base">
                    person
                  </span>
                  <input
                    type="text"
                    required
                    value={loginIdentificador}
                    onChange={(e) => setLoginIdentificador(e.target.value)}
                    placeholder="Email o DNI registrado"
                    className="w-full bg-surface-container-low border border-outline-variant focus:border-primary rounded-lg pl-8 pr-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-label-code text-label-code text-on-surface-variant uppercase tracking-wider">
                    Contraseña
                  </label>
                  <span className="text-[10px] text-on-surface-variant/70 font-label-code">Sesión de acceso</span>
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-base">
                    lock
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-surface-container-low border border-outline-variant focus:border-primary rounded-lg pl-8 pr-8 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-base">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Botón de Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-1 py-2.5 px-3 bg-primary hover:bg-primary-hover text-on-primary font-headline font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-on-primary border-t-transparent rounded-full animate-spin"></span>
                    <span>Verificando...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-base">login</span>
                    <span>Ingresar al Club</span>
                  </>
                )}
              </button>

              <p className="text-[11px] text-on-surface-variant">Las altas de socios las realiza el administrador.</p>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-label-code text-[10.5px] uppercase tracking-wider text-on-surface-variant mb-1">
                    Nombre Completo
                  </label>
                  <input
                    type="text"
                    required
                    value={regNombre}
                    onChange={(e) => setRegNombre(e.target.value)}
                    placeholder="Martín Rossi"
                    className="w-full bg-surface-container-low border border-outline-variant focus:border-primary rounded-lg px-2.5 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-label-code text-[10.5px] uppercase tracking-wider text-on-surface-variant mb-1">
                    DNI / Documento
                  </label>
                  <input
                    type="text"
                    required
                    value={regDni}
                    onChange={(e) => setRegDni(e.target.value)}
                    placeholder="39.812.900"
                    className="w-full bg-surface-container-low border border-outline-variant focus:border-primary rounded-lg px-2.5 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-label-code text-[10.5px] uppercase tracking-wider text-on-surface-variant mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="martin@correo.com"
                    className="w-full bg-surface-container-low border border-outline-variant focus:border-primary rounded-lg px-2.5 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-label-code text-[10.5px] uppercase tracking-wider text-on-surface-variant mb-1">
                    WhatsApp / Teléfono
                  </label>
                  <input
                    type="text"
                    value={regTelefono}
                    onChange={(e) => setRegTelefono(e.target.value)}
                    placeholder="+54 9 11 2345-6789"
                    className="w-full bg-surface-container-low border border-outline-variant focus:border-primary rounded-lg px-2.5 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-label-code text-[10.5px] uppercase tracking-wider text-on-surface-variant mb-1">
                  Contraseña (mínimo 6 caracteres)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-surface-container-low border border-outline-variant focus:border-primary rounded-lg pl-2.5 pr-8 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-base">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-on-surface-variant">Se creará un socio sin membresía. La elección del plan y su habilitación requieren confirmar el pago; ese flujo está pendiente.</p>

              {/* Botón de Submit Registro */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 px-3 bg-secondary hover:bg-secondary-hover text-on-secondary font-headline font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-on-secondary border-t-transparent rounded-full animate-spin"></span>
                    <span>Registrando socio...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-base">person_add</span>
                    <span>Crear Socio sin Membresía</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Footer info de seguridad */}
        <div className="px-5 py-2.5 border-t border-outline-variant/50 bg-surface-container-lowest flex items-center justify-between text-[10px] text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-primary text-xs">lock</span>
            La sesión se cierra al salir o vencer.
          </span>
          <span className="font-label-code text-on-surface-variant/70">PULSE CLUB</span>
        </div>
      </div>
    </div>
  );
};
