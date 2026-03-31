// src/hooks/useUnifiedAccounting.js
// Hook unificado para el ERP - Centraliza todas las operaciones contables
// CORREGIDO: Mejorada la detección de cuentas bancarias

import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import {
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    doc,
    getDoc,
    getDocs,
    startAfter,
    limit
} from 'firebase/firestore';

// ============================================
// HELPERS
// ============================================

const isAccountActive = (account) => {
    if (account?.isActive === false) return false;
    if (account?.active === false) return false;
    return true;
};

const normalizeNumber = (value) => Number(value) || 0;

// CORREGIDO: Función mejorada para detectar cuentas bancarias (formato DGI Nicaragua)
const isBancoAccount = (account) => {
    if (!account || account.isGroup) return false;
    
    // Verificar por subType
    if (account.subType === 'banco') return true;
    
    // Verificar por código (cuentas bancarias DGI: 110103 - Bancos Cuentas Corrientes)
    if (account.code && (
        account.code.startsWith('110103') ||  // Bancos
        account.code.startsWith('1102')       // Inversiones temporales
    )) return true;
    
    // Verificar por nombre
    if (account.name) {
        const nameLower = account.name.toLowerCase();
        if (nameLower.includes('banco') || 
            nameLower.includes('bac') || 
            nameLower.includes('banpro') || 
            nameLower.includes('lafise') ||
            nameLower.includes('bancario') ||
            nameLower.includes('cuenta corriente')) return true;
    }
    
    return false;
};

// CORREGIDO: Función EXCLUSIVA para detectar cuentas de caja (formato DGI Nicaragua)
// Solo acepta códigos 110101 (Caja General) y 110102 (Caja Chica)
// NUNCA 110104 (Dinero en Tránsito)
const isCajaAccount = (account) => {
    if (!account || account.isGroup) return false;
    
    const nameLower = (account.name || '').toLowerCase();
    
    // EXCLUIR explícitamente cuentas de tránsito por nombre
    if (nameLower.includes('transito') || nameLower.includes('tránsito')) {
        return false;
    }
    
    // EXCLUSIVAMENTE códigos 110101 y 110102
    if (account.code) {
        const code = account.code.replace(/\./g, ''); // Quitar puntos
        // RECHAZAR explícitamente 110104
        if (code === '110104' || code.startsWith('110104')) {
            return false;
        }
        if (code === '110101' || code === '110102') return true;
        if (code.startsWith('110101') || code.startsWith('110102')) return true;
    }
    
    // Verificar por subType - pero solo si NO es transito
    if (account.subType === 'caja') {
        return true;
    }
    
    // Verificar por nombre - palabras clave de caja (pero NO transito)
    if ((nameLower.includes('caja') || nameLower.includes('cajas')) && 
        !nameLower.includes('transito') && 
        !nameLower.includes('tránsito') &&
        !nameLower.includes('diferencia')) {
        return true;
    }
    
    return false;
};

// CORREGIDO: Función mejorada para detectar cuentas en tránsito (formato DGI Nicaragua)
const isTransitoAccount = (account) => {
    if (!account || account.isGroup) return false;
    
    // Verificar por subType
    if (account.subType === 'transito') return true;
    
    // Verificar por código (tránsito DGI: 110104 - Dinero en Tránsito)
    if (account.code && account.code.startsWith('110104')) return true;
    
    // Verificar por nombre
    if (account.name) {
        const nameLower = account.name.toLowerCase();
        if (nameLower.includes('transito') || nameLower.includes('tránsito')) return true;
    }
    
    return false;
};

// ============================================
// HOOK: PLAN DE CUENTAS CON CACHÉ
// ============================================

export const usePlanCuentas = () => {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Cargar desde caché al inicio
    useEffect(() => {
        const cached = localStorage.getItem('erp_cache_planCuentas');
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                // Solo usar caché si tiene menos de 10 minutos
                if (Date.now() - parsed.timestamp < 10 * 60 * 1000) {
                    setAccounts(parsed.data);
                    setLoading(false);
                }
            } catch (e) {
                console.log('Caché inválido, recargando...');
            }
        }
    }, []);

    useEffect(() => {
        const accountsRef = collection(db, 'planCuentas');
        const q = query(accountsRef, orderBy('code'));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const data = snapshot.docs
                    .map((d) => ({ id: d.id, ...d.data() }))
                    .filter(isAccountActive);

                // Guardar en caché
                localStorage.setItem('erp_cache_planCuentas', JSON.stringify({
                    data,
                    timestamp: Date.now()
                }));

                setAccounts(data);
                setError(null);
                setLoading(false);
            },
            (err) => {
                console.error('Error cargando plan de cuentas:', err);
                setError(err.message);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    const getAccountByCode = useCallback((code) => {
        return accounts.find((a) => a.code === code) || null;
    }, [accounts]);

    const getAccountById = useCallback((id) => {
        return accounts.find((a) => a.id === id) || null;
    }, [accounts]);

    const getAccountsByType = useCallback((type) => {
        return accounts.filter((a) => a.type === type && !a.isGroup);
    }, [accounts]);

    // CORREGIDO: getCajaAccounts mejorado
    const getCajaAccounts = useCallback((currency = 'NIO') => {
        return accounts
            .filter((a) =>
                isCajaAccount(a) &&
                ((a.currency || 'NIO') === currency)
            )
            .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    }, [accounts]);

    // CORREGIDO: getBancoAccounts mejorado con detección flexible
    const getBancoAccounts = useCallback((currency = 'NIO') => {
        return accounts
            .filter((acc) =>
                isBancoAccount(acc) &&
                ((acc.currency || 'NIO') === currency)
            )
            .filter((acc, index, arr) =>
                index === arr.findIndex((x) => x.code === acc.code)
            )
            .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    }, [accounts]);

    // CORREGIDO: getTransitoAccounts mejorado
    const getTransitoAccounts = useCallback((currency = null) => {
        return accounts
            .filter((a) => {
                if (!isTransitoAccount(a)) return false;
                if (!currency) return true;
                return (a.currency || 'NIO') === currency;
            })
            .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    }, [accounts]);

    const getGastoAccounts = useCallback(() => {
        return accounts
            .filter((a) => (a.type === 'GASTO' || a.type === 'COSTO') && !a.isGroup)
            .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    }, [accounts]);

    const getPasivoAccounts = useCallback((predicate = null) => {
        const cuentas = accounts
            .filter((a) => a.type === 'PASIVO' && !a.isGroup)
            .sort((a, b) => (a.code || '').localeCompare(b.code || ''));

        return typeof predicate === 'function' ? cuentas.filter(predicate) : cuentas;
    }, [accounts]);

    // NUEVO: Obtener cuentas de ingresos
    const getIngresoAccounts = useCallback(() => {
        return accounts
            .filter((a) => a.type === 'INGRESO' && !a.isGroup)
            .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    }, [accounts]);

    // NUEVO: Obtener cuentas de proveedores (formato DGI Nicaragua: 210101)
    const getProveedoresAccount = useCallback(() => {
        return accounts.find((a) => 
            a.code === '210101' || 
            a.code === '2101' ||
            (a.type === 'PASIVO' && a.name?.toLowerCase().includes('proveedores'))
        ) || null;
    }, [accounts]);

    return {
        accounts,
        loading,
        error,
        getAccountByCode,
        getAccountById,
        getAccountsByType,
        getCajaAccounts,
        getBancoAccounts,
        getTransitoAccounts,
        getGastoAccounts,
        getPasivoAccounts,
        getIngresoAccounts,
        getProveedoresAccount
    };
};

// ============================================
// HOOK: MOVIMIENTOS CONTABLES CON PAGINACIÓN
// ============================================

export const useMovimientosContables = (filters = {}, options = {}) => {
    const { pageSize = 50, useCache = true } = options;
    const [movimientos, setMovimientos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    const [lastDoc, setLastDoc] = useState(null);

    // Cargar desde caché al inicio
    useEffect(() => {
        if (!useCache) return;
        const cacheKey = `erp_cache_movimientos_${JSON.stringify(filters)}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Date.now() - parsed.timestamp < 5 * 60 * 1000) {
                    setMovimientos(parsed.data);
                    setLoading(false);
                }
            } catch (e) {
                // Caché inválido
            }
        }
    }, [filters, useCache]);

    useEffect(() => {
        setLoading(true);
        const movimientosRef = collection(db, 'movimientosContables');
        let q = query(movimientosRef, orderBy('timestamp', 'desc'), limit(pageSize));

        if (filters.accountId) {
            q = query(movimientosRef, where('accountId', '==', filters.accountId), orderBy('timestamp', 'desc'), limit(pageSize));
        }

        if (filters.documentoTipo) {
            q = query(movimientosRef, where('documentoTipo', '==', filters.documentoTipo), orderBy('timestamp', 'desc'), limit(pageSize));
        }

        if (filters.moduloOrigen) {
            q = query(movimientosRef, where('moduloOrigen', '==', filters.moduloOrigen), orderBy('timestamp', 'desc'), limit(pageSize));
        }

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                let data = snapshot.docs.map((d) => {
                    const raw = d.data();
                    const tipo = raw.tipo || raw.type || '';

                    return {
                        id: d.id,
                        ...raw,
                        tipo,
                        type: raw.type || tipo
                    };
                });

                // Aplicar filtros adicionales en cliente
                if (filters.fechaDesde) {
                    data = data.filter((m) => m.fecha >= filters.fechaDesde);
                }
                if (filters.fechaHasta) {
                    data = data.filter((m) => m.fecha <= filters.fechaHasta);
                }
                if (filters.referencia) {
                    data = data.filter((m) => m.referencia?.includes(filters.referencia));
                }

                // Guardar en caché
                if (useCache) {
                    const cacheKey = `erp_cache_movimientos_${JSON.stringify(filters)}`;
                    localStorage.setItem(cacheKey, JSON.stringify({
                        data,
                        timestamp: Date.now()
                    }));
                }

                setMovimientos(data);
                setHasMore(snapshot.docs.length === pageSize);
                setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
                setError(null);
                setLoading(false);
            },
            (err) => {
                console.error('Error cargando movimientos:', err);
                setError(err.message);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [
        filters.accountId,
        filters.documentoTipo,
        filters.moduloOrigen,
        filters.fechaDesde,
        filters.fechaHasta,
        filters.referencia,
        pageSize,
        useCache
    ]);

    // Cargar más (paginación)
    const loadMore = useCallback(async () => {
        if (!lastDoc || !hasMore) return;
        
        const movimientosRef = collection(db, 'movimientosContables');
        let q = query(
            movimientosRef, 
            orderBy('timestamp', 'desc'), 
            startAfter(lastDoc),
            limit(pageSize)
        );

        if (filters.accountId) {
            q = query(q, where('accountId', '==', filters.accountId));
        }

        const snapshot = await getDocs(q);
        const newData = snapshot.docs.map((d) => {
            const raw = d.data();
            const tipo = raw.tipo || raw.type || '';

            return {
                id: d.id,
                ...raw,
                tipo,
                type: raw.type || tipo
            };
        });
        
        setMovimientos(prev => [...prev, ...newData]);
        setHasMore(snapshot.docs.length === pageSize);
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
    }, [lastDoc, hasMore, filters, pageSize]);

    const getMovimientosByDocumento = useCallback((documentoId, documentoTipo) => {
        return movimientos.filter(
            (m) => m.documentoId === documentoId && m.documentoTipo === documentoTipo
        );
    }, [movimientos]);

    const getMovimientosByCuenta = useCallback((accountId) => {
        return movimientos.filter((m) => m.accountId === accountId);
    }, [movimientos]);

    return {
        movimientos,
        loading,
        error,
        hasMore,
        loadMore,
        getMovimientosByDocumento,
        getMovimientosByCuenta
    };
};

// ============================================
// HOOK: CIERRES DE CAJA ERP
// ============================================

export const useCierresCajaERP = (filters = {}) => {
    const [cierres, setCierres] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const cierresRef = collection(db, 'cierresCajaERP');
        const q = query(cierresRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                let data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

                if (filters.estado) {
                    data = data.filter((c) => c.estado === filters.estado);
                }
                if (filters.fechaDesde) {
                    data = data.filter((c) => c.fecha >= filters.fechaDesde);
                }
                if (filters.fechaHasta) {
                    data = data.filter((c) => c.fecha <= filters.fechaHasta);
                }
                if (filters.caja) {
                    data = data.filter((c) => c.caja === filters.caja);
                }
                if (filters.cajero) {
                    data = data.filter((c) => c.cajero === filters.cajero);
                }

                setCierres(data);
                setError(null);
                setLoading(false);
            },
            (err) => {
                console.error('Error cargando cierres:', err);
                setError(err.message);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [filters.estado, filters.fechaDesde, filters.fechaHasta, filters.caja, filters.cajero]);

    const getCierreById = useCallback(async (id) => {
        const cierreRef = doc(db, 'cierresCajaERP', id);
        const snap = await getDoc(cierreRef);
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }, []);

    const getCierresPendientes = useCallback(() => {
        return cierres.filter((c) => c.estado === 'pendiente');
    }, [cierres]);

    const getCierresNoCuadrados = useCallback(() => {
        return cierres.filter((c) => c.estado === 'borrador' && !c.cuadre?.estaCuadrado);
    }, [cierres]);

    // NUEVO: Obtener cierres completados
    const getCierresCompletados = useCallback(() => {
        return cierres.filter((c) => c.estado === 'completado' || c.estado === 'cerrado');
    }, [cierres]);

    return {
        cierres,
        loading,
        error,
        getCierreById,
        getCierresPendientes,
        getCierresNoCuadrados,
        getCierresCompletados
    };
};

// ============================================
// HOOK: DEPÓSITOS EN TRÁNSITO
// ============================================

export const useDepositosTransitoERP = (estado = null) => {
    const [depositos, setDepositos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const depositosRef = collection(db, 'depositosTransito');
        const q = query(depositosRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                let data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

                if (estado) {
                    data = data.filter((d) => d.estado === estado);
                }

                setDepositos(data);
                setError(null);
                setLoading(false);
            },
            (err) => {
                console.error('Error cargando depósitos:', err);
                setError(err.message);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [estado]);

    const getDepositosPendientes = useCallback(() => {
        return depositos.filter((d) => d.estado === 'pendiente');
    }, [depositos]);

    return {
        depositos,
        loading,
        error,
        getDepositosPendientes
    };
};

// ============================================
// HOOK: DEPÓSITOS BANCARIOS
// ============================================

export const useDepositosBancariosERP = (filters = {}) => {
    const [depositos, setDepositos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const depositosRef = collection(db, 'depositosBancarios');
        const q = query(depositosRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                let data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

                if (filters.bancoId) {
                    data = data.filter((d) => d.bancoDestinoId === filters.bancoId);
                }
                if (filters.fechaDesde) {
                    data = data.filter((d) => d.fecha >= filters.fechaDesde);
                }
                if (filters.fechaHasta) {
                    data = data.filter((d) => d.fecha <= filters.fechaHasta);
                }

                setDepositos(data);
                setError(null);
                setLoading(false);
            },
            (err) => {
                console.error('Error cargando depósitos bancarios:', err);
                setError(err.message);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [filters.bancoId, filters.fechaDesde, filters.fechaHasta]);

    return {
        depositos,
        loading,
        error
    };
};

// ============================================
// HOOK: AJUSTES MANUALES
// ============================================

export const useAjustesManuales = (estado = null) => {
    const [ajustes, setAjustes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const ajustesRef = collection(db, 'ajustesManuales');
        const q = query(ajustesRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                let data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

                if (estado) {
                    data = data.filter((a) => a.estado === estado);
                }

                setAjustes(data);
                setError(null);
                setLoading(false);
            },
            (err) => {
                console.error('Error cargando ajustes:', err);
                setError(err.message);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [estado]);

    const getAjustesPendientes = useCallback(() => {
        return ajustes.filter((a) => a.estado === 'pendiente');
    }, [ajustes]);

    return {
        ajustes,
        loading,
        error,
        getAjustesPendientes
    };
};

// ============================================
// HOOK: DASHBOARD ERP
// ============================================

export const useDashboardERP = () => {
    const { accounts, loading: accountsLoading } = usePlanCuentas();
    const [dashboard, setDashboard] = useState({
        saldos: {
            activos: 0,
            pasivos: 0,
            capital: 0,
            patrimonio: 0
        },
        cajas: { NIO: [], USD: [] },
        bancos: { NIO: [], USD: [] },
        transito: { NIO: [], USD: [] },
        totales: {
            cajas: { NIO: 0, USD: 0 },
            bancos: { NIO: 0, USD: 0 },
            transito: { NIO: 0, USD: 0 }
        }
    });

    useEffect(() => {
        if (accountsLoading) return;

        const activos = accounts.filter((a) => a.type === 'ACTIVO' && !a.isGroup);
        const pasivos = accounts.filter((a) => a.type === 'PASIVO' && !a.isGroup);
        const capital = accounts.filter((a) => ['CAPITAL', 'PATRIMONIO'].includes(a.type) && !a.isGroup);

        const saldos = {
            activos: activos.reduce((sum, a) => sum + normalizeNumber(a.balance), 0),
            pasivos: pasivos.reduce((sum, a) => sum + normalizeNumber(a.balance), 0),
            capital: capital.reduce((sum, a) => sum + normalizeNumber(a.balance), 0),
            patrimonio: 0
        };

        saldos.patrimonio = saldos.activos - saldos.pasivos;

        // CORREGIDO: Usar funciones mejoradas de detección
        const cajasNIO = accounts.filter((a) => isCajaAccount(a) && ((a.currency || 'NIO') === 'NIO'));
        const cajasUSD = accounts.filter((a) => isCajaAccount(a) && a.currency === 'USD');

        const bancosNIO = accounts.filter((a) => isBancoAccount(a) && ((a.currency || 'NIO') === 'NIO'));
        const bancosUSD = accounts.filter((a) => isBancoAccount(a) && a.currency === 'USD');

        const transitoNIO = accounts.filter((a) => isTransitoAccount(a) && ((a.currency || 'NIO') === 'NIO'));
        const transitoUSD = accounts.filter((a) => isTransitoAccount(a) && a.currency === 'USD');

        setDashboard({
            saldos,
            cajas: { NIO: cajasNIO, USD: cajasUSD },
            bancos: { NIO: bancosNIO, USD: bancosUSD },
            transito: { NIO: transitoNIO, USD: transitoUSD },
            totales: {
                cajas: {
                    NIO: cajasNIO.reduce((sum, a) => sum + normalizeNumber(a.balance), 0),
                    USD: cajasUSD.reduce((sum, a) => sum + normalizeNumber(a.balanceUSD), 0)
                },
                bancos: {
                    NIO: bancosNIO.reduce((sum, a) => sum + normalizeNumber(a.balance), 0),
                    USD: bancosUSD.reduce((sum, a) => sum + normalizeNumber(a.balanceUSD), 0)
                },
                transito: {
                    NIO: transitoNIO.reduce((sum, a) => sum + normalizeNumber(a.balance), 0),
                    USD: transitoUSD.reduce((sum, a) => sum + normalizeNumber(a.balanceUSD), 0)
                }
            }
        });
    }, [accounts, accountsLoading]);

    return { dashboard, loading: accountsLoading };
};

// ============================================
// HOOK PRINCIPAL UNIFICADO
// ============================================

export const useUnifiedAccounting = () => {
    const planCuentas = usePlanCuentas();
    const movimientos = useMovimientosContables();
    const dashboard = useDashboardERP();

    return {
        ...planCuentas,
        movimientos: movimientos.movimientos,
        movimientosLoading: movimientos.loading,
        movimientosError: movimientos.error,
        dashboard: dashboard.dashboard,
        dashboardLoading: dashboard.loading
    };
};

export default {
    usePlanCuentas,
    useMovimientosContables,
    useCierresCajaERP,
    useDepositosTransitoERP,
    useDepositosBancariosERP,
    useAjustesManuales,
    useDashboardERP,
    useUnifiedAccounting
};
