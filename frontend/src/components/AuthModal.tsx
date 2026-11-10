import React, { useState, useEffect, useId, useRef } from 'react';
import { AuthResponse } from '../types/auth';
import { ApiError, apiLogin, apiRegistro } from '../services/api';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'register';
  onClose?: () => void;
  onSuccess: (session: AuthResponse) => void;
  allowRegistration?: boolean;
  presentation?: 'dialog' | 'page';
  showToast: (msg: string, icon?: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'login',
  onClose,
  onSuccess,
  showToast,
  allowRegistration = false,
  presentation = 'dialog',
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(allowRegistration ? initialMode : 'login');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const formId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

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

  useEffect(() => {
    if (!isOpen || presentation !== 'dialog') return;
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLInputElement>('input')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current?.();
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isOpen, presentation]);

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
      onClose?.();
    } catch (err: unknown) {
      setErrorMessage(err instanceof ApiError && err.status >= 500
        ? `El servicio de acceso no pudo completar la solicitud (HTTP ${err.status}). Comprobá que el backend esté iniciado y volvé a intentar.`
        : err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
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
      onClose?.();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al registrar socio.');
    } finally {
      setLoading(false);
    }
  };

  const Heading = presentation === 'page' ? 'h1' : 'h2';
  return (
    <div className={presentation === 'dialog' ? 'auth-modal' : 'auth-inline'}>
      <div ref={dialogRef} className="auth-card" role={presentation === 'dialog' ? 'dialog' : undefined}
        aria-modal={presentation === 'dialog' ? true : undefined} aria-labelledby={formId + '-heading'}>
        <header className="auth-card-header">
          <div className="auth-brand">
            <span className="admin-brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span>PULSE <b>CLUB</b></span>
          </div>
          {presentation === 'dialog' && <button type="button" className="auth-close"
            aria-label="Cerrar formulario de acceso" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>}
          <p className="auth-eyebrow">{mode === 'register' ? 'ADMINISTRACIÓN' : 'TU ESPACIO PULSE'}</p>
          <Heading id={formId + '-heading'}>{mode === 'register' ? 'Nuevo socio' : 'Ingresá a tu cuenta'}</Heading>
          <p>{mode === 'register'
            ? 'Completá los datos para dar de alta al socio.'
            : 'Usá tu email o DNI y la contraseña de tu cuenta.'}</p>
        </header>
        {allowRegistration && <div className="auth-tabs" aria-label="Opciones de acceso">
          <button type="button" className={mode === 'login' ? 'is-active' : ''}
            aria-pressed={mode === 'login'} disabled={loading}
            onClick={() => { setMode('login'); setErrorMessage(''); }}>Iniciar sesión</button>
          <button type="button" className={mode === 'register' ? 'is-active' : ''}
            aria-pressed={mode === 'register'} disabled={loading}
            onClick={() => { setMode('register'); setErrorMessage(''); }}>Alta de socio</button>
        </div>}
        {errorMessage && <div id={formId + '-error'} role="alert" className="auth-error">
          <span className="material-symbols-outlined" aria-hidden="true">error</span>
          <p>{errorMessage}</p>
        </div>}
        <div className="auth-card-content">
          {mode === 'login' ? <form onSubmit={handleLoginSubmit} aria-describedby={errorMessage ? formId + '-error' : undefined}>
            <label htmlFor={formId + '-identifier'}>Email o DNI</label>
            <div className="auth-input-wrap">
              <span className="material-symbols-outlined" aria-hidden="true">person</span>
              <input id={formId + '-identifier'} name="username" type="text" autoComplete="username"
                required disabled={loading} value={loginIdentificador}
                onChange={event => setLoginIdentificador(event.target.value)} placeholder="Email o DNI registrado" />
            </div>
            <label htmlFor={formId + '-password'}>Contraseña</label>
            <div className="auth-input-wrap">
              <span className="material-symbols-outlined" aria-hidden="true">lock</span>
              <input id={formId + '-password'} name="password" type={showPassword ? 'text' : 'password'}
                autoComplete="current-password" required disabled={loading} value={loginPassword}
                onChange={event => setLoginPassword(event.target.value)} placeholder="Ingresá tu contraseña" />
              <button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onClick={() => setShowPassword(!showPassword)}>
                <span className="material-symbols-outlined" aria-hidden="true">{showPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? 'Verificando…' : 'Ingresar al club'}
              <span className="material-symbols-outlined" aria-hidden="true">{loading ? 'hourglass_top' : 'arrow_forward'}</span>
            </button>
            <p className="auth-help">Las altas de socios las realiza el administrador.</p>
          </form> : <form onSubmit={handleRegisterSubmit} aria-describedby={errorMessage ? formId + '-error' : undefined}>
            <div className="auth-form-grid">
              <div>
                <label htmlFor={formId + '-name'}>Nombre completo</label>
                <input id={formId + '-name'} name="name" autoComplete="name" required disabled={loading}
                  value={regNombre} onChange={event => setRegNombre(event.target.value)} placeholder="Nombre y apellido" />
              </div>
              <div>
                <label htmlFor={formId + '-dni'}>DNI</label>
                <input id={formId + '-dni'} name="dni" required disabled={loading}
                  value={regDni} onChange={event => setRegDni(event.target.value)} placeholder="Número de documento" />
              </div>
              <div>
                <label htmlFor={formId + '-email'}>Email</label>
                <input id={formId + '-email'} name="email" type="email" autoComplete="email" required disabled={loading}
                  value={regEmail} onChange={event => setRegEmail(event.target.value)} placeholder="nombre@correo.com" />
              </div>
              <div>
                <label htmlFor={formId + '-phone'}>Teléfono</label>
                <input id={formId + '-phone'} name="tel" type="tel" autoComplete="tel" disabled={loading}
                  value={regTelefono} onChange={event => setRegTelefono(event.target.value)} placeholder="Teléfono de contacto" />
              </div>
            </div>
            <label htmlFor={formId + '-new-password'}>Contraseña inicial</label>
            <div className="auth-input-wrap">
              <span className="material-symbols-outlined" aria-hidden="true">lock</span>
              <input id={formId + '-new-password'} name="new-password" type={showPassword ? 'text' : 'password'}
                autoComplete="new-password" minLength={6} required disabled={loading} value={regPassword}
                onChange={event => setRegPassword(event.target.value)} placeholder="Mínimo 6 caracteres" />
              <button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onClick={() => setShowPassword(!showPassword)}>
                <span className="material-symbols-outlined" aria-hidden="true">{showPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
            <p className="auth-help">Se creará un socio sin membresía. Elegí el plan desde Socios y membresías y confirmá el pago desde Cobros y caja para habilitarla.</p>
            <button type="submit" className="auth-submit" disabled={loading}>{loading ? 'Registrando socio…' : 'Crear socio sin membresía'}</button>
          </form>}
        </div>
        <footer className="auth-card-footer">
          <span className="material-symbols-outlined" aria-hidden="true">lock</span>
          La sesión se cierra al salir o vencer.
        </footer>
      </div>
    </div>
  );
};
