// src/components/DepositosTransito.jsx
// CORREGIDO: Conexión automática al plan de cuentas con asientos contables + Selección de sucursal

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlanCuentas } from '../hooks/useUnifiedAccounting';
import { useBranches } from '../hooks/useBranches';
import { createDepositoTransitoERP } from '../services/unifiedAccountingService';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
    Plus, 
    Save, 
    Banknote, 
    Calendar, 
    User, 
    DollarSign,
    Store,
    ArrowRightLeft,
    CheckCircle,
    AlertCircle,
    RefreshCw,
    Trash2,
    Building2,
    FileText,
    ArrowLeft,
    Eye,
    Clock,
    CheckSquare
} from 'lucide-react';

const DepositosTransito = () => {
    const { user } = useAuth();
    const { branches, loading: loadingBranches } = useBranches();
    
    // Estados
    const [activeTab, setActiveTab] = useState('nuevo'); // 'nuevo', 'pendientes', 'historial'
    const [depositos, setDepositos] = useState([]);
    const [loading, setLoading] = useState(true);
    
    // Formulario
    const [formData, setFormData] = useState({
        fecha: format(new Date(), 'yyyy-MM-dd'),
        sucursalId: '',
        sucursalName: '',
        responsable: '',
        moneda: 'NIO',
        observaciones: '',
        cuentasOrigen: []
    });
    
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // CORREGIDO: Usar el hook usePlanCuentas con funciones mejoradas
    const { 
        getCajaAccounts,
        getTransitoAccounts,
        accounts 
    } = usePlanCuentas();

    const cuentasCajaNIO = useMemo(() => getCajaAccounts('NIO'), [getCajaAccounts]);
    const cuentasCajaUSD = useMemo(() => getCajaAccounts('USD'), [getCajaAccounts]);
    const cuentasTransito = useMemo(() => getTransitoAccounts(), [getTransitoAccounts]);

    // Cargar depósitos
    useEffect(() => {
        const depositosRef = collection(db, 'depositosTransito');
        const q = query(depositosRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setDepositos(data);
            setLoading(false);
        }, (err) => {
            console.error('Error cargando depósitos:', err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Obtener cuentas de caja según moneda seleccionada
    const cuentasCajaDisponibles = useMemo(() => {
        return formData.moneda === 'USD' ? cuentasCajaUSD : cuentasCajaNIO;
    }, [formData.moneda, cuentasCajaNIO, cuentasCajaUSD]);

    // Agregar cuenta al depósito
    const addCuentaOrigen = () => {
        setFormData(prev => ({
            ...prev,
            cuentasOrigen: [...prev.cuentasOrigen, { 
                accountId: '', 
                accountCode: '', 
                accountName: '', 
                monto: '' 
            }]
        }));
    };

    // Eliminar cuenta del depósito
    const removeCuentaOrigen = (index) => {
        setFormData(prev => ({
            ...prev,
            cuentasOrigen: prev.cuentasOrigen.filter((_, i) => i !== index)
        }));
    };

    // Actualizar cuenta
    const updateCuentaOrigen = (index, field, value) => {
        setFormData(prev => {
            const newCuentas = [...prev.cuentasOrigen];
            newCuentas[index] = { ...newCuentas[index], [field]: value };
            
            // Si cambia el accountId, actualizar también código y nombre
            if (field === 'accountId') {
                const cuenta = cuentasCajaDisponibles.find(c => c.id === value);
                if (cuenta) {
                    newCuentas[index].accountCode = cuenta.code;
                    newCuentas[index].accountName = cuenta.name;
                }
            }
            
            return { ...prev, cuentasOrigen: newCuentas };
        });
    };

    // Calcular total
    const totalDeposito = useMemo(() => {
        return formData.cuentasOrigen.reduce((sum, c) => sum + (Number(c.monto) || 0), 0);
    }, [formData.cuentasOrigen]);

    // Crear depósito
    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (formData.cuentasOrigen.length === 0) {
            setError('Debe agregar al menos una cuenta de origen');
            return;
        }

        if (formData.cuentasOrigen.some(c => !c.accountId || !c.monto)) {
            setError('Todas las cuentas deben tener una cuenta seleccionada y un monto');
            return;
        }

        if (totalDeposito <= 0) {
            setError('El total del depósito debe ser mayor a cero');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            // CORREGIDO: El servicio createDepositoTransitoERP ya genera los asientos contables automáticamente
            const result = await createDepositoTransitoERP({
                fecha: formData.fecha,
                sucursalId: formData.sucursalId,
                sucursalName: formData.sucursalName,
                responsable: formData.responsable,
                moneda: formData.moneda,
                cuentasOrigen: formData.cuentasOrigen.map(c => ({
                    accountId: c.accountId,
                    accountCode: c.accountCode,
                    accountName: c.accountName,
                    monto: Number(c.monto)
                })),
                total: totalDeposito,
                observaciones: formData.observaciones,
                userId: user.uid,
                userEmail: user.email
            });

            setSuccess(`Depósito #${result.numero} creado exitosamente con asientos contables vinculados`);
            
            // Resetear formulario
            setFormData({
                fecha: format(new Date(), 'yyyy-MM-dd'),
                sucursalId: '',
                sucursalName: '',
                responsable: '',
                moneda: 'NIO',
                observaciones: '',
                cuentasOrigen: []
            });

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            console.error('Error creando depósito:', err);
            setError(err.message || 'Error al crear el depósito');
        } finally {
            setSubmitting(false);
        }
    };

    // Formatear moneda
    const formatCurrency = (amount, currency = 'NIO') => {
        const symbol = currency === 'USD' ? '$' : 'C$';
        return `${symbol} ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    // Renderizar formulario
    const renderFormulario = () => (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        <Calendar className="w-4 h-4 inline mr-1" />
                        Fecha *
                    </label>
                    <input
                        type="date"
                        value={formData.fecha}
                        onChange={(e) => setFormData(prev => ({ ...prev, fecha: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        <Store className="w-4 h-4 inline mr-1" />
                        Sucursal *
                    </label>
                    <select
                        value={formData.sucursalId}
                        onChange={(e) => {
                            const sucursal = branches.find(s => s.id === e.target.value);
                            setFormData(prev => ({ 
                                ...prev, 
                                sucursalId: e.target.value,
                                sucursalName: sucursal?.name || ''
                            }));
                        }}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        required
                    >
                        <option value="">Seleccione una sucursal...</option>
                        {branches.map(sucursal => (
                            <option key={sucursal.id} value={sucursal.id}>
                                {sucursal.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        <User className="w-4 h-4 inline mr-1" />
                        Responsable *
                    </label>
                    <input
                        type="text"
                        value={formData.responsable}
                        onChange={(e) => setFormData(prev => ({ ...prev, responsable: e.target.value }))}
                        placeholder="Nombre del responsable"
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        <DollarSign className="w-4 h-4 inline mr-1" />
                        Moneda
                    </label>
                    <select
                        value={formData.moneda}
                        onChange={(e) => setFormData(prev => ({ 
                            ...prev, 
                            moneda: e.target.value,
                            cuentasOrigen: [] // Limpiar cuentas al cambiar moneda
                        }))}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="NIO">Córdobas (NIO)</option>
                        <option value="USD">Dólares (USD)</option>
                    </select>
                </div>
            </div>

            {/* Cuentas de Origen */}
            <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-blue-600" />
                        Cuentas de Origen
                    </h3>
                    <button
                        type="button"
                        onClick={addCuentaOrigen}
                        className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" />
                        Agregar Cuenta
                    </button>
                </div>

                {formData.cuentasOrigen.length === 0 && (
                    <p className="text-gray-500 text-center py-4">
                        No hay cuentas agregadas. Haga clic en "Agregar Cuenta" para comenzar.
                    </p>
                )}

                {formData.cuentasOrigen.map((cuenta, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 p-4 bg-white rounded-lg border">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Cuenta de Caja
                            </label>
                            <select
                                value={cuenta.accountId}
                                onChange={(e) => updateCuentaOrigen(index, 'accountId', e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                required
                            >
                                <option value="">Seleccione una cuenta...</option>
                                {cuentasCajaDisponibles.length === 0 ? (
                                    <option disabled>
                                        No hay cuentas de caja {formData.moneda} disponibles
                                    </option>
                                ) : (
                                    cuentasCajaDisponibles.map(c => (
                                        <option key={c.id} value={c.id}>
                                            {c.code} - {c.name}
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>
                        <div className="flex items-end gap-2">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Monto
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={cuenta.monto}
                                    onChange={(e) => updateCuentaOrigen(index, 'monto', e.target.value)}
                                    placeholder="0.00"
                                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => removeCuentaOrigen(index)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                ))}

                {/* Total */}
                {formData.cuentasOrigen.length > 0 && (
                    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                        <div className="flex justify-between items-center">
                            <span className="font-medium">Total del Depósito:</span>
                            <span className="text-xl font-bold text-blue-600">
                                {formatCurrency(totalDeposito, formData.moneda)}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Información de Asiento Contable */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-medium text-green-800 flex items-center gap-2 mb-2">
                    <CheckCircle className="w-5 h-5" />
                    Asiento Contable Automático
                </h4>
                <p className="text-sm text-green-700">
                    Al crear este depósito, se generará automáticamente un asiento contable que:
                </p>
                <ul className="text-sm text-green-700 mt-2 list-disc list-inside">
                    <li>Debitará la cuenta de DINERO EN TRÁNSITO ({formData.moneda === 'NIO' ? '1.01.01.20' : '1.01.01.21'})</li>
                    <li>Acreditará las cuentas de caja seleccionadas</li>
                </ul>
            </div>

            {/* Observaciones */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    <FileText className="w-4 h-4 inline mr-1" />
                    Observaciones
                </label>
                <textarea
                    value={formData.observaciones}
                    onChange={(e) => setFormData(prev => ({ ...prev, observaciones: e.target.value }))}
                    placeholder="Observaciones adicionales..."
                    rows="3"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
            </div>

            {/* Mensajes */}
            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                </div>
            )}

            {success && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
                    <CheckCircle className="w-5 h-5" />
                    {success}
                </div>
            )}

            <button
                type="submit"
                disabled={submitting || formData.cuentasOrigen.length === 0}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
                {submitting ? (
                    <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        Creando Depósito...
                    </>
                ) : (
                    <>
                        <ArrowRightLeft className="w-5 h-5" />
                        Crear Depósito en Tránsito
                    </>
                )}
            </button>
        </form>
    );

    // Renderizar lista de depósitos
    const renderDepositosList = (estado) => {
        const depositosFiltrados = depositos.filter(d => d.estado === estado);
        
        return (
            <div className="space-y-4">
                {depositosFiltrados.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <ArrowRightLeft className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <p>No hay depósitos {estado === 'pendiente' ? 'pendientes' : 'confirmados'}</p>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {depositosFiltrados.map((deposito) => (
                            <div 
                                key={deposito.id} 
                                className={`bg-white rounded-lg shadow p-4 ${
                                    deposito.estado === 'confirmado' ? 'border-l-4 border-green-500' : ''
                                }`}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm font-medium">
                                                #{deposito.numero}
                                            </span>
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                deposito.moneda === 'USD' 
                                                    ? 'bg-green-100 text-green-800' 
                                                    : 'bg-purple-100 text-purple-800'
                                            }`}>
                                                {deposito.moneda}
                                            </span>
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${
                                                deposito.estado === 'pendiente'
                                                    ? 'bg-yellow-100 text-yellow-800'
                                                    : 'bg-green-100 text-green-800'
                                            }`}>
                                                {deposito.estado === 'pendiente' ? (
                                                    <><Clock className="w-3 h-3" /> Pendiente</>
                                                ) : (
                                                    <><CheckSquare className="w-3 h-3" /> Confirmado</>
                                                )}
                                            </span>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            <div>
                                                <p className="text-sm text-gray-500">Responsable</p>
                                                <p className="font-medium">{deposito.responsable}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-500">Monto Total</p>
                                                <p className="font-medium text-lg">
                                                    {formatCurrency(deposito.total, deposito.moneda)}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-500">Fecha</p>
                                                <p className="font-medium">{deposito.fecha}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-500">Cuentas Origen</p>
                                                <p className="font-medium">
                                                    {deposito.cuentasOrigen?.length || 0} cuenta(s)
                                                </p>
                                            </div>
                                        </div>
                                        
                                        {deposito.movimientosContablesIds?.length > 0 && (
                                            <div className="mt-3 p-2 bg-green-50 rounded text-sm text-green-700">
                                                <CheckCircle className="w-4 h-4 inline mr-1" />
                                                {deposito.movimientosContablesIds.length} movimientos contables generados
                                            </div>
                                        )}
                                        
                                        {deposito.observaciones && (
                                            <div className="mt-2 text-sm text-gray-600">
                                                <span className="font-medium">Obs:</span> {deposito.observaciones}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <ArrowRightLeft className="w-8 h-8 text-blue-600" />
                    Depósitos en Tránsito
                </h1>
                <p className="text-gray-600 mt-1">
                    Gestione depósitos en tránsito con vinculación automática al plan de cuentas
                </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b">
                <button
                    onClick={() => setActiveTab('nuevo')}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'nuevo' 
                            ? 'text-blue-600 border-b-2 border-blue-600' 
                            : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                    <Plus className="w-4 h-4 inline mr-1" />
                    Nuevo Depósito
                </button>
                <button
                    onClick={() => setActiveTab('pendientes')}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'pendientes' 
                            ? 'text-blue-600 border-b-2 border-blue-600' 
                            : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                    <Clock className="w-4 h-4 inline mr-1" />
                    Pendientes
                </button>
                <button
                    onClick={() => setActiveTab('historial')}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'historial' 
                            ? 'text-blue-600 border-b-2 border-blue-600' 
                            : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                    <CheckSquare className="w-4 h-4 inline mr-1" />
                    Confirmados
                </button>
            </div>

            {/* Contenido */}
            <div className="bg-white rounded-lg shadow p-6">
                {activeTab === 'nuevo' && renderFormulario()}
                {activeTab === 'pendientes' && renderDepositosList('pendiente')}
                {activeTab === 'historial' && renderDepositosList('confirmado')}
            </div>
        </div>
    );
};

export default DepositosTransito;
