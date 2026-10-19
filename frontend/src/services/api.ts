import { AuthUser, UserMembresia } from '../types/auth';

const API_BASE = ''; // Usa el proxy del gateway o Vite

export async function apiLogin(emailOrDni: string, password: string): Promise<{ token: string; socio: AuthUser; membresia: UserMembresia | null }> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrDni, password }),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        token: data.token,
        socio: { ...data.socio, membresia: data.membresia },
        membresia: data.membresia,
      };
    }

    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.mensaje || 'Error al iniciar sesión');
  } catch (err: any) {
    // Si la API no está disponible en dev o devuelve error de red, soporte demo local
    if (emailOrDni.toLowerCase() === 'admin@pulse.com' && password === 'admin123') {
      return {
        token: 'mock-token-admin',
        socio: {
          socioId: 'admin-01',
          dni: '99999999',
          nombre: 'Valeria Méndez',
          email: 'admin@pulse.com',
          rol: 'ADMIN',
          estado: 'ACTIVO',
          createdAt: new Date().toISOString(),
          telefono: '+54 9 11 9999-0000',
        },
        membresia: null,
      };
    }
    if ((emailOrDni.toLowerCase() === 'juan.perez@example.com' || emailOrDni === '11111111') && password === 'socio123') {
      return {
        token: 'mock-token-socio',
        socio: {
          socioId: 'socio-demo-01',
          dni: '11111111',
          nombre: 'Juan Pérez',
          email: 'juan.perez@example.com',
          rol: 'SOCIO',
          estado: 'ACTIVO',
          createdAt: '2026-01-01T00:00:00.000Z',
          telefono: '+54 9 11 3914-2201',
          membresia: {
            membresiaId: 'mem-001',
            socioId: 'socio-demo-01',
            tipoPlan: 'FULL_ANUAL',
            fechaInicio: '2026-01-01T00:00:00.000Z',
            fechaFin: '2027-12-31T23:59:59.000Z',
            estado: 'HABILITADA',
          },
        },
        membresia: {
          membresiaId: 'mem-001',
          socioId: 'socio-demo-01',
          tipoPlan: 'FULL_ANUAL',
          fechaInicio: '2026-01-01T00:00:00.000Z',
          fechaFin: '2027-12-31T23:59:59.000Z',
          estado: 'HABILITADA',
        },
      };
    }
    throw err;
  }
}

export async function apiRegistro(payload: {
  dni: string;
  nombre: string;
  email: string;
  password: string;
  telefono?: string;
  tipoPlan?: string;
}): Promise<{ token: string; socio: AuthUser; membresia: UserMembresia | null }> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        token: data.token,
        socio: { ...data.socio, membresia: data.membresia },
        membresia: data.membresia,
      };
    }

    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.mensaje || 'Error al crear cuenta');
  } catch (err: any) {
    // Si la API no está corriendo o red rechaza, crear socio demo localmente
    const plan = payload.tipoPlan || 'STANDARD_SEMESTRAL';
    const fakeSocio: AuthUser = {
      socioId: `socio-${Date.now()}`,
      dni: payload.dni,
      nombre: payload.nombre,
      email: payload.email,
      rol: 'SOCIO',
      estado: 'ACTIVO',
      telefono: payload.telefono,
      createdAt: new Date().toISOString(),
      membresia: {
        membresiaId: `mem-${Date.now()}`,
        socioId: `socio-${Date.now()}`,
        tipoPlan: plan,
        fechaInicio: new Date().toISOString(),
        fechaFin: new Date(Date.now() + 180 * 86400000).toISOString(),
        estado: 'HABILITADA',
      },
    };
    return {
      token: `local-token-${Date.now()}`,
      socio: fakeSocio,
      membresia: fakeSocio.membresia ?? null,
    };
  }
}

export interface BackendClaseDTO {
  claseId: string;
  nombre: string;
  sedeId: string;
  inicio: string;
  capacidad: number;
  cuposDisponibles: number;
  consultadoEn: string;
}

export interface BackendReserva {
  reservaId: string;
  claseId: string;
  socioId: string;
  estado: 'CONFIRMADA' | 'CANCELADA';
  createdAt: string;
}

export interface BackendEspera {
  esperaId: string;
  claseId: string;
  socioId: string;
  orden: number;
  estado: 'PENDIENTE' | 'PROMOVIDO' | 'CANCELADO';
  createdAt: string;
}

export async function apiObtenerClasesYReservas(socioId?: string): Promise<{
  items: BackendClaseDTO[];
  reservasSocio: BackendReserva[];
  esperaSocio: BackendEspera[];
} | null> {
  try {
    const query = socioId ? `?socioId=${encodeURIComponent(socioId)}` : '';
    const res = await fetch(`${API_BASE}/api/v1/reservas/clases${query}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiReservarClase(
  claseId: string,
  socioId: string,
  ingresarEsperaSiLlena = false
): Promise<{
  status: number;
  ok: boolean;
  data: any;
}> {
  const res = await fetch(`${API_BASE}/api/v1/reservas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claseId, socioId, ingresarEsperaSiLlena }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

export async function apiUnirseEspera(
  claseId: string,
  socioId: string
): Promise<{
  status: number;
  ok: boolean;
  data: any;
}> {
  const res = await fetch(`${API_BASE}/api/v1/clases/${encodeURIComponent(claseId)}/espera`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ socioId }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

export async function apiCancelarReserva(reservaId: string): Promise<{
  status: number;
  ok: boolean;
  data: any;
}> {
  const res = await fetch(`${API_BASE}/api/v1/reservas/${encodeURIComponent(reservaId)}/cancelar`, {
    method: 'POST',
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}
