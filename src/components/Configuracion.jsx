// src/components/Configuracion.jsx - Configuración ERP Completa
import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { 
    collection, doc, getDoc, setDoc, onSnapshot, 
    addDoc, updateDoc, deleteDoc, query, orderBy, getDocs 
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { initPlanCuentasDGI, checkPlanCuentasExists } from '../utils/initPlanCuentas';
import { resetERPDatabase } from '../services/unifiedAccountingService';
import { getBranchIsActive, normalizeBranch } from '../utils/branches';
import { 
    Settings, Building2, DollarSign, Link2, BookOpen,
    Plus, Edit2, Trash2, Save, RefreshCw, CheckCircle, AlertCircle,
    Store, CreditCard, Wallet, Landmark, Info, Database
} from 'lucide-react';

const RESET_PHRASE_WORDS = [
    'BORRON',
    'CUENTA',
    'NUEVA',
    'REINICIO',
    'SEGURO',
    'ERP',
    'LIMPIO',
    'FENIX'
];

const getSecureRandomIndex = (max) => {
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        const values = new Uint32Array(1);
        window.crypto.getRandomValues(values);
        return values[0] % max;
    }

    return Math.floor(Math.random() * max);
};

const generateResetPhrase = () => {
    const firstWord = RESET_PHRASE_WORDS[getSecureRandomIndex(RESET_PHRASE_WORDS.length)];
    const secondWord = RESET_PHRASE_WORDS[getSecureRandomIndex(RESET_PHRASE_WORDS.length)];
    const code = String(1000 + getSecureRandomIndex(9000));

    return `${firstWord}-${secondWord}-${code}`;
};

const Configuracion = () => {
    const { user, userRole, ROLES } = useAuth();
    const [activeTab, setActiveTab] = useState('cuentas');
    const [accounts, setAccounts] = useState([]);
    const [accountsLoading, setAccountsLoading] = useState(true);
    
    // Configuración de cuentas vinculadas
    const [configCuentas, setConfigCuentas] = useState({
        cajaEfectivoNIO: '',
        cajaEfectivoUSD: '',
        bancoBAC: '',
        bancoBANPRO: '',
        bancoLAFISE: '',
        transferenciaBAC: '',
        transferenciaBANPRO: '',
        transferenciaLAFISE: '',
        transferenciaBAC_USD: '',
        transferenciaLAFISE_USD: '',
        posBAC: '',
        posBANPRO: '',
        posLAFISE: '',
        proveedores: '',
        dineroTransitoNIO: '',
        dineroTransitoUSD: '',
    });
    
    // Tasa de cambio
    const [tasaCambio, setTasaCambio] = useState({
        compra: 36.50,
        venta: 36.80,
        fecha: new Date().toISOString().split('T')[0]
    });
    const [savingTasa, setSavingTasa] = useState(false);
    
    // Sucursales
    const [sucursales, setSucursales] = useState([]);
    const [sucursalForm, setSucursalForm] = useState({
        name: '',
        code: '',
        address: '',
        phone: '',
        active: true,
        isActive: true
    });
    const [editingSucursal, setEditingSucursal] = useState(null);
    const [savingSucursal, setSavingSucursal] = useState(false);
    
    // Inicialización Plan DGI
    const [initLoading, setInitLoading] = useState(false);
    const [initResult, setInitResult] = useState(null);
    const [planStatus, setPlanStatus] = useState({ exists: false, count: 0 });
    const [resetPhrase, setResetPhrase] = useState(generateResetPhrase);
    const [resetConfirmationInput, setResetConfirmationInput] = useState('');
    const [resettingData, setResettingData] = useState(false);
    const [lastResetInfo, setLastResetInfo] = useState(null);
    const [resetSummary, setResetSummary] = useState(null);
    
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    // Cargar cuentas del plan
    useEffect(() => {
        const q = query(collection(db, 'planCuentas'), orderBy('code'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAccounts(data);
            setAccountsLoading(false);
            setPlanStatus({ exists: data.length > 0, count: data.length });
        }, (err) => {
            console.error('Error cargando cuentas:', err);
            setAccountsLoading(false);
            showMessage('Error cargando cuentas: ' + err.message, 'error');
        });
        return () => unsubscribe();
    }, []);

    // Cargar configuración
    useEffect(() => {
        const loadConfig = async () => {
            try {
                // Cargar cuentas vinculadas
                const configDoc = await getDoc(doc(db, 'configuracion', 'cuentas'));
                if (configDoc.exists()) {
                    setConfigCuentas(prev => ({ ...prev, ...configDoc.data() }));
                }
                
                // Cargar tasa de cambio
                const tasaDoc = await getDoc(doc(db, 'configuracion', 'tasaCambio'));
                if (tasaDoc.exists()) {
                    const data = tasaDoc.data();
                    setTasaCambio({
                        compra: data.compra || 36.50,
                        venta: data.venta || 36.80,
                        fecha: data.fecha || new Date().toISOString().split('T')[0]
                    });
                }

                const resetDoc = await getDoc(doc(db, 'configuracion', 'ultimoReinicioSistema'));
                if (resetDoc.exists()) {
                    setLastResetInfo(resetDoc.data());
                }
                
                setLoading(false);
            } catch (err) {
                console.error('Error cargando configuración:', err);
                setLoading(false);
                showMessage('Error cargando configuración: ' + err.message, 'error');
            }
        };
        
        loadConfig();
    }, []);

    // Cargar sucursales
    useEffect(() => {
        const q = query(collection(db, 'branches'), orderBy('name'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setSucursales(
                snapshot.docs
                    .map((d) => normalizeBranch({ id: d.id, ...d.data() }))
                    .sort((left, right) => (left.name || '').localeCompare(right.name || ''))
            );
        }, (err) => {
            console.error('Error cargando sucursales:', err);
        });
        return () => unsubscribe();
    }, []);

    const saveCuentasConfig = async () => {
        setSaving(true);
        try {
            await setDoc(doc(db, 'configuracion', 'cuentas'), {
                ...configCuentas,
                updatedAt: new Date()
            });
            showMessage('Configuración de cuentas guardada', 'success');
        } catch (err) {
            showMessage('Error al guardar: ' + err.message, 'error');
        }
        setSaving(false);
    };

    const saveTasaCambio = async () => {
        setSavingTasa(true);
        try {
            await setDoc(doc(db, 'configuracion', 'tasaCambio'), {
                compra: parseFloat(tasaCambio.compra) || 36.50,
                venta: parseFloat(tasaCambio.venta) || 36.80,
                fecha: tasaCambio.fecha,
                updatedAt: new Date()
            });
            showMessage('Tasa de cambio actualizada', 'success');
        } catch (err) {
            showMessage('Error al guardar: ' + err.message, 'error');
        }
        setSavingTasa(false);
    };

    const handleSucursalSubmit = async (e) => {
        e.preventDefault();
        setSavingSucursal(true);
        const isActive = getBranchIsActive(sucursalForm);
        const sucursalPayload = {
            ...sucursalForm,
            name: String(sucursalForm.name || '').trim(),
            code: String(sucursalForm.code || '').trim(),
            active: isActive,
            isActive
        };
        try {
            if (editingSucursal) {
                await updateDoc(doc(db, 'branches', editingSucursal), {
                    ...sucursalPayload,
                    updatedAt: new Date()
                });
                showMessage('Sucursal actualizada', 'success');
            } else {
                await addDoc(collection(db, 'branches'), {
                    ...sucursalPayload,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                showMessage('Sucursal creada', 'success');
            }
            setSucursalForm({ name: '', code: '', address: '', phone: '', active: true, isActive: true });
            setEditingSucursal(null);
        } catch (err) {
            showMessage('Error: ' + err.message, 'error');
        }
        setSavingSucursal(false);
    };

    const deleteSucursal = async (id) => {
        if (confirm('¿Eliminar esta sucursal?')) {
            try {
                await deleteDoc(doc(db, 'branches', id));
                showMessage('Sucursal eliminada', 'success');
            } catch (err) {
                showMessage('Error al eliminar: ' + err.message, 'error');
            }
        }
    };

    const handleInitPlanCuentas = async () => {
        setInitLoading(true);
        setInitResult(null);
        const result = await initPlanCuentasDGI();
        setInitResult(result);
        setInitLoading(false);
        
        if (result.success) {
            setTimeout(() => setInitResult(null), 5000);
        }
    };

    const showMessage = (text, type) => {
        setMessage({ text, type });
        setTimeout(() => setMessage(null), 3000);
    };

    const regenerateResetPhrase = () => {
        setResetPhrase(generateResetPhrase());
        setResetConfirmationInput('');
    };

    const clearLocalERPData = () => {
        if (typeof window === 'undefined') return;

        Object.keys(window.localStorage)
            .filter((key) => key.startsWith('erp_cache_'))
            .forEach((key) => window.localStorage.removeItem(key));
    };

    const formatDateTime = (value) => {
        if (!value) return '-';

        if (typeof value?.toDate === 'function') {
            return value.toDate().toLocaleString('es-NI');
        }

        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('es-NI');
    };

    const handleResetSystem = async () => {
        if (userRole !== ROLES.ADMIN) {
            showMessage('Solo un administrador puede reiniciar la base de datos.', 'error');
            return;
        }

        if (resetConfirmationInput.trim() !== resetPhrase) {
            showMessage('La frase de confirmación no coincide.', 'error');
            return;
        }

        const userConfirmed = window.confirm(
            'Esta acción eliminará los datos operativos del ERP y dejará los saldos contables en cero. ¿Desea continuar?'
        );

        if (!userConfirmed) {
            return;
        }

        setResettingData(true);
        setResetSummary(null);

        try {
            const result = await resetERPDatabase({
                userId: user?.uid,
                userEmail: user?.email || null,
                reason: 'manual-reset-from-configuracion'
            });

            clearLocalERPData();
            setResetSummary(result);
            setLastResetInfo(result);
            regenerateResetPhrase();
            showMessage('La base operativa fue reiniciada correctamente.', 'success');
        } catch (err) {
            console.error('Error reiniciando base de datos:', err);
            showMessage(`Error al reiniciar la base: ${err.message}`, 'error');
        } finally {
            setResettingData(false);
        }
    };

    // Filtrar cuentas por tipo
    const cuentasBancos = accounts.filter(a => a.code?.startsWith('110103') || a.subType === 'banco');
    const cuentasCaja = accounts.filter(a => (a.code?.startsWith('1101') && !a.code?.startsWith('110103')) || a.subType === 'caja');
    const cuentasCajaUSD = accounts.filter(a => a.currency === 'USD' && (a.code?.startsWith('1101') || a.subType === 'caja'));
    const cuentasTransito = accounts.filter(a => a.code?.startsWith('110104') || a.subType === 'transito');
    const cuentasProveedores = accounts.filter(a => a.code?.startsWith('2101') || (a.type === 'PASIVO' && a.name?.toLowerCase().includes('proveedor')));

    const renderCuentasConfig = () => (
        <div className="space-y-6">
            {/* Inicializar Plan de Cuentas DGI */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-blue-800 flex items-center gap-2">
                            <BookOpen className="w-5 h-5" />
                            Plan de Cuentas DGI Nicaragua
                        </h3>
                        <p className="text-sm text-blue-600 mt-1">
                            Cargue el catálogo oficial de cuentas para DGI con todas las clases (1-7)
                        </p>
                        {planStatus.exists && (
                            <p className="text-sm text-green-600 mt-2 flex items-center gap-1">
                                <CheckCircle className="w-4 h-4" />
                                Plan cargado: {planStatus.count} cuentas
                            </p>
                        )}
                    </div>
                    <button
                        onClick={handleInitPlanCuentas}
                        disabled={initLoading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
                    >
                        {initLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                        {initLoading ? 'Cargando...' : planStatus.exists ? 'Recargar Plan' : 'Cargar Plan DGI'}
                    </button>
                </div>
                
                {initResult && (
                    <div className={`mt-4 p-3 rounded-lg ${initResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        <p className="font-medium">{initResult.message}</p>
                        {initResult.errors && initResult.errors.length > 0 && (
                            <details className="mt-2">
                                <summary className="cursor-pointer text-sm">Ver errores ({initResult.errors.length})</summary>
                                <ul className="mt-2 text-xs space-y-1 max-h-32 overflow-auto">
                                    {initResult.errors.map((err, i) => (
                                        <li key={i}>{err.code || err}: {err.error || err}</li>
                                    ))}
                                </ul>
                            </details>
                        )}
                    </div>
                )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                            <Link2 className="w-5 h-5 text-blue-600" />
                            Vinculación de Cuentas Contables
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">
                            Configure las cuentas del plan que se verán afectadas en cada operación
                        </p>
                    </div>
                    <button
                        onClick={saveCuentasConfig}
                        disabled={saving}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
                    >
                        <Save className="w-4 h-4" />
                        {saving ? 'Guardando...' : 'Guardar Configuración'}
                    </button>
                </div>

                {!planStatus.exists && (
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-amber-800 font-medium">Plan de cuentas no cargado</p>
                            <p className="text-amber-700 text-sm">Primero debe cargar el Plan DGI Nicaragua para poder vincular las cuentas.</p>
                        </div>
                    </div>
                )}

                {/* Cajas */}
                <div className="mb-8">
                    <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Wallet className="w-4 h-4" />
                        Efectivo en Caja
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Caja Córdobas (NIO)</label>
                            <select
                                value={configCuentas.cajaEfectivoNIO}
                                onChange={(e) => setConfigCuentas({...configCuentas, cajaEfectivoNIO: e.target.value})}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                disabled={!planStatus.exists}
                            >
                                <option value="">Seleccione cuenta...</option>
                                {cuentasCaja.map(c => (
                                    <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Caja Dólares (USD)</label>
                            <select
                                value={configCuentas.cajaEfectivoUSD}
                                onChange={(e) => setConfigCuentas({...configCuentas, cajaEfectivoUSD: e.target.value})}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                disabled={!planStatus.exists}
                            >
                                <option value="">Seleccione cuenta...</option>
                                {cuentasCajaUSD.map(c => (
                                    <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Bancos */}
                <div className="mb-8">
                    <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Landmark className="w-4 h-4" />
                        Cuentas Bancarias
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {['BAC', 'BANPRO', 'LAFISE'].map(banco => (
                            <div key={banco}>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Banco {banco}</label>
                                <select
                                    value={configCuentas[`banco${banco}`]}
                                    onChange={(e) => setConfigCuentas({...configCuentas, [`banco${banco}`]: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    disabled={!planStatus.exists}
                                >
                                    <option value="">Seleccione cuenta...</option>
                                    {cuentasBancos.map(c => (
                                        <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Transferencias */}
                <div className="mb-8">
                    <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <CreditCard className="w-4 h-4" />
                        Transferencias (Cierre de Caja)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {['BAC', 'BANPRO', 'LAFISE'].map(banco => (
                            <div key={banco}>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Transferencia {banco} NIO</label>
                                <select
                                    value={configCuentas[`transferencia${banco}`]}
                                    onChange={(e) => setConfigCuentas({...configCuentas, [`transferencia${banco}`]: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    disabled={!planStatus.exists}
                                >
                                    <option value="">Seleccione cuenta...</option>
                                    {cuentasBancos.filter(c => (c.currency || 'NIO') === 'NIO').map(c => (
                                        <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Transferencia BAC USD</label>
                            <select
                                value={configCuentas.transferenciaBAC_USD}
                                onChange={(e) => setConfigCuentas({...configCuentas, transferenciaBAC_USD: e.target.value})}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                disabled={!planStatus.exists}
                            >
                                <option value="">Seleccione cuenta...</option>
                                {cuentasBancos.filter(c => c.currency === 'USD').map(c => (
                                    <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Transferencia LAFISE USD</label>
                            <select
                                value={configCuentas.transferenciaLAFISE_USD}
                                onChange={(e) => setConfigCuentas({...configCuentas, transferenciaLAFISE_USD: e.target.value})}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                disabled={!planStatus.exists}
                            >
                                <option value="">Seleccione cuenta...</option>
                                {cuentasBancos.filter(c => c.currency === 'USD').map(c => (
                                    <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* POS */}
                <div className="mb-8">
                    <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <CreditCard className="w-4 h-4" />
                        POS (Puntos de Venta)
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {['BAC', 'BANPRO', 'LAFISE'].map(banco => (
                            <div key={banco}>
                                <label className="block text-sm font-medium text-slate-700 mb-1">POS {banco}</label>
                                <select
                                    value={configCuentas[`pos${banco}`]}
                                    onChange={(e) => setConfigCuentas({...configCuentas, [`pos${banco}`]: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    disabled={!planStatus.exists}
                                >
                                    <option value="">Seleccione cuenta...</option>
                                    {cuentasBancos.map(c => (
                                        <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Otras cuentas */}
                <div>
                    <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <Store className="w-4 h-4" />
                        Otras Cuentas
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Proveedores (Cuenta por Pagar)</label>
                            <select
                                value={configCuentas.proveedores}
                                onChange={(e) => setConfigCuentas({...configCuentas, proveedores: e.target.value})}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                disabled={!planStatus.exists}
                            >
                                <option value="">Seleccione cuenta...</option>
                                {cuentasProveedores.map(c => (
                                    <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Dinero en Tránsito NIO</label>
                            <select
                                value={configCuentas.dineroTransitoNIO}
                                onChange={(e) => setConfigCuentas({...configCuentas, dineroTransitoNIO: e.target.value})}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                disabled={!planStatus.exists}
                            >
                                <option value="">Seleccione cuenta...</option>
                                {cuentasTransito.map(c => (
                                    <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Dinero en Tránsito USD</label>
                            <select
                                value={configCuentas.dineroTransitoUSD}
                                onChange={(e) => setConfigCuentas({...configCuentas, dineroTransitoUSD: e.target.value})}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                disabled={!planStatus.exists}
                            >
                                <option value="">Seleccione cuenta...</option>
                                {cuentasTransito.map(c => (
                                    <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderTasaCambio = () => (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-green-600" />
                        Tasa de Cambio
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                        Configure la tasa de cambio para conversiones USD/NIO
                    </p>
                </div>
                <button
                    onClick={saveTasaCambio}
                    disabled={savingTasa}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50"
                >
                    <Save className="w-4 h-4" />
                    {savingTasa ? 'Guardando...' : 'Actualizar Tasa'}
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Tasa Compra</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">C$</span>
                        <input
                            type="number"
                            step="0.01"
                            value={tasaCambio.compra}
                            onChange={(e) => setTasaCambio({...tasaCambio, compra: e.target.value})}
                            className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Por cada $1 USD</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Tasa Venta</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">C$</span>
                        <input
                            type="number"
                            step="0.01"
                            value={tasaCambio.venta}
                            onChange={(e) => setTasaCambio({...tasaCambio, venta: e.target.value})}
                            className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Fecha Vigencia</label>
                    <input
                        type="date"
                        value={tasaCambio.fecha}
                        onChange={(e) => setTasaCambio({...tasaCambio, fecha: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    />
                </div>
            </div>
        </div>
    );

    const renderSucursales = () => (
        <div className="space-y-6">
            {/* Formulario */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-purple-600" />
                    {editingSucursal ? 'Editar Sucursal' : 'Nueva Sucursal'}
                </h3>
                <form onSubmit={handleSucursalSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Nombre *</label>
                        <input
                            type="text"
                            value={sucursalForm.name}
                            onChange={(e) => setSucursalForm({...sucursalForm, name: e.target.value})}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Código *</label>
                        <input
                            type="text"
                            value={sucursalForm.code}
                            onChange={(e) => setSucursalForm({...sucursalForm, code: e.target.value})}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono</label>
                        <input
                            type="text"
                            value={sucursalForm.phone}
                            onChange={(e) => setSucursalForm({...sucursalForm, phone: e.target.value})}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        />
                    </div>
                    <div className="flex items-end gap-2">
                        <button
                            type="submit"
                            disabled={savingSucursal}
                            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50"
                        >
                            {savingSucursal ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {editingSucursal ? 'Actualizar' : 'Guardar'}
                        </button>
                        {editingSucursal && (
                            <button
                                type="button"
                                onClick={() => { setEditingSucursal(null); setSucursalForm({ name: '', code: '', address: '', phone: '', active: true, isActive: true }); }}
                                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                            >
                                Cancelar
                            </button>
                        )}
                    </div>
                </form>
                <div className="mt-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Dirección</label>
                    <input
                        type="text"
                        value={sucursalForm.address}
                        onChange={(e) => setSucursalForm({...sucursalForm, address: e.target.value})}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                </div>
            </div>

            {/* Lista */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Código</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Nombre</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Dirección</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Teléfono</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-slate-700">Estado</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-slate-700">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {sucursales.map((s) => (
                            <tr key={s.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-mono text-sm">{s.code}</td>
                                <td className="px-4 py-3 font-medium">{s.name}</td>
                                <td className="px-4 py-3 text-slate-600">{s.address || '-'}</td>
                                <td className="px-4 py-3">{s.phone || '-'}</td>
                                <td className="px-4 py-3 text-center">
                                    <span className={`px-2 py-1 rounded-full text-xs ${getBranchIsActive(s) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                        {getBranchIsActive(s) ? 'Activa' : 'Inactiva'}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <button
                                            onClick={() => {
                                                setEditingSucursal(s.id);
                                                setSucursalForm({
                                                    name: s.name || '',
                                                    code: s.code || '',
                                                    address: s.address || '',
                                                    phone: s.phone || '',
                                                    active: getBranchIsActive(s),
                                                    isActive: getBranchIsActive(s)
                                                });
                                            }}
                                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => deleteSucursal(s.id)}
                                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {sucursales.length === 0 && (
                    <p className="text-center text-slate-500 py-8">No hay sucursales registradas</p>
                )}
            </div>
        </div>
    );

    const renderSistema = () => {
        const summaryToShow = resetSummary || lastResetInfo;
        const collectionsSummary = Object.entries(summaryToShow?.collectionsReset || {});
        const totalDeleted = collectionsSummary.reduce((sum, [, count]) => sum + (Number(count) || 0), 0);

        return (
            <div className="space-y-6">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-red-800 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5" />
                        Reinicio Seguro del ERP
                    </h3>
                    <p className="text-sm text-red-700 mt-2">
                        Esta opción elimina los datos operativos para empezar de nuevo, pero conserva la estructura del sistema.
                    </p>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="bg-white/70 rounded-lg p-4 border border-red-100">
                            <p className="font-semibold text-slate-800 mb-2">Se conserva</p>
                            <ul className="space-y-1 text-slate-700">
                                <li>Usuarios y roles</li>
                                <li>Sucursales</li>
                                <li>Configuración del sistema</li>
                                <li>Plan de cuentas, con balances en cero</li>
                            </ul>
                        </div>
                        <div className="bg-white/70 rounded-lg p-4 border border-red-100">
                            <p className="font-semibold text-slate-800 mb-2">Se elimina</p>
                            <ul className="space-y-1 text-slate-700">
                                <li>Ventas, gastos y compras</li>
                                <li>Cierres de caja y depósitos</li>
                                <li>Movimientos y asientos contables</li>
                                <li>Cuentas por pagar, proveedores y ajustes</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                                <Database className="w-5 h-5 text-red-600" />
                                Borrón y Cuenta Nueva
                            </h3>
                            <p className="text-sm text-slate-500 mt-1">
                                Para ejecutar el reinicio, escriba exactamente la frase aleatoria mostrada abajo.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={regenerateResetPhrase}
                            className="px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
                        >
                            Nueva frase
                        </button>
                    </div>

                    <div className="bg-slate-900 text-slate-100 rounded-lg p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400 mb-2">Frase de confirmación</p>
                        <p className="font-mono text-xl break-all">{resetPhrase}</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Escriba la frase para confirmar
                        </label>
                        <input
                            type="text"
                            value={resetConfirmationInput}
                            onChange={(e) => setResetConfirmationInput(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500"
                            placeholder="Pegue o escriba la frase exacta"
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>

                    {userRole !== ROLES.ADMIN && (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                            Solo un usuario con rol administrador puede ejecutar este reinicio.
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={handleResetSystem}
                        disabled={
                            resettingData ||
                            userRole !== ROLES.ADMIN ||
                            resetConfirmationInput.trim() !== resetPhrase
                        }
                        className="w-full md:w-auto px-5 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {resettingData ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        {resettingData ? 'Reiniciando base...' : 'Reiniciar Datos Operativos'}
                    </button>
                </div>

                {summaryToShow && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                        <h3 className="text-lg font-semibold text-slate-800 mb-4">Último reinicio registrado</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-5">
                            <div className="p-4 bg-slate-50 rounded-lg">
                                <p className="text-slate-500">Fecha</p>
                                <p className="font-medium text-slate-900">{formatDateTime(summaryToShow.executedAt)}</p>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg">
                                <p className="text-slate-500">Ejecutado por</p>
                                <p className="font-medium text-slate-900">{summaryToShow.executedByEmail || '-'}</p>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg">
                                <p className="text-slate-500">Registros eliminados</p>
                                <p className="font-medium text-slate-900">{totalDeleted}</p>
                            </div>
                        </div>

                        <div className="mb-5 p-4 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-800">
                            Se reiniciaron {summaryToShow.planCuentasReset || 0} cuentas contables a saldo cero.
                        </div>

                        {collectionsSummary.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-slate-500 border-b">
                                            <th className="py-2 pr-4">Colección</th>
                                            <th className="py-2 text-right">Registros eliminados</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {collectionsSummary.map(([collectionName, count]) => (
                                            <tr key={collectionName} className="border-b last:border-b-0">
                                                <td className="py-2 pr-4 font-medium text-slate-700">{collectionName}</td>
                                                <td className="py-2 text-right text-slate-900">{count}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Settings className="w-8 h-8 text-slate-600" />
                    Configuración del Sistema
                </h1>
                <p className="text-slate-500 mt-1">
                    Configure cuentas, tasas de cambio y sucursales
                </p>
            </div>

            {/* Message */}
            {message && (
                <div className={`mb-4 p-4 rounded-lg flex items-center gap-2 ${
                    message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                    {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    {message.text}
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b">
                <button
                    onClick={() => setActiveTab('cuentas')}
                    className={`px-4 py-3 font-medium flex items-center gap-2 border-b-2 transition-colors ${
                        activeTab === 'cuentas' 
                            ? 'text-blue-600 border-blue-600' 
                            : 'text-slate-600 border-transparent hover:text-slate-800'
                    }`}
                >
                    <Link2 className="w-4 h-4" />
                    Cuentas Vinculadas
                </button>
                <button
                    onClick={() => setActiveTab('tasa')}
                    className={`px-4 py-3 font-medium flex items-center gap-2 border-b-2 transition-colors ${
                        activeTab === 'tasa' 
                            ? 'text-green-600 border-green-600' 
                            : 'text-slate-600 border-transparent hover:text-slate-800'
                    }`}
                >
                    <DollarSign className="w-4 h-4" />
                    Tasa de Cambio
                </button>
                <button
                    onClick={() => setActiveTab('sucursales')}
                    className={`px-4 py-3 font-medium flex items-center gap-2 border-b-2 transition-colors ${
                        activeTab === 'sucursales' 
                            ? 'text-purple-600 border-purple-600' 
                            : 'text-slate-600 border-transparent hover:text-slate-800'
                    }`}
                >
                    <Building2 className="w-4 h-4" />
                    Sucursales
                </button>
                <button
                    onClick={() => {
                        setActiveTab('sistema');
                        regenerateResetPhrase();
                    }}
                    className={`px-4 py-3 font-medium flex items-center gap-2 border-b-2 transition-colors ${
                        activeTab === 'sistema' 
                            ? 'text-red-600 border-red-600' 
                            : 'text-slate-600 border-transparent hover:text-slate-800'
                    }`}
                >
                    <Database className="w-4 h-4" />
                    Sistema
                </button>
            </div>

            {/* Content */}
            {activeTab === 'cuentas' && renderCuentasConfig()}
            {activeTab === 'tasa' && renderTasaCambio()}
            {activeTab === 'sucursales' && renderSucursales()}
            {activeTab === 'sistema' && renderSistema()}
        </div>
    );
};

export default Configuracion;
