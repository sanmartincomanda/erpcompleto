// src/components/Compras.jsx - Módulo de Compras (crédito y contado)
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import {
    collection,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    Timestamp,
    updateDoc,
    where
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useBranches } from '../hooks/useBranches';
import { usePlanCuentas } from '../hooks/useUnifiedAccounting';
import { registerAccountingEntry, DOCUMENT_TYPES } from '../services/unifiedAccountingService';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
    ShoppingCart, Plus, Search, Filter, Calendar, 
    DollarSign, Store, User, FileText, CreditCard,
    CheckCircle, AlertCircle, RefreshCw, Trash2, Edit2,
    Eye, X, TrendingDown, Building2, Tag
} from 'lucide-react';

const Compras = () => {
    const { user } = useAuth();
    const { branches } = useBranches();
    const { accounts, getBancoAccounts, getCajaAccounts, getProveedoresAccount } = usePlanCuentas();
    
    const [compras, setCompras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filtroTipo, setFiltroTipo] = useState('todas');
    const [filtroSucursal, setFiltroSucursal] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingCompra, setEditingCompra] = useState(null);
    
    const [formData, setFormData] = useState({
        fecha: format(new Date(), 'yyyy-MM-dd'),
        sucursalId: '',
        sucursalName: '',
        proveedor: '',
        descripcion: '',
        monto: '',
        moneda: 'NIO',
        tipoCambio: '36.50',
        esCredito: false,
        factura: '',
        cuentaGastoId: '',
        cuentaGastoCode: '',
        cuentaGastoName: '',
        metodoPago: 'efectivo',
        bancoId: ''
    });
    
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // Cuentas de gastos disponibles
    const cuentasGastos = useMemo(() => {
        return accounts.filter(a => 
            (a.type === 'GASTO' || a.type === 'COSTO') && !a.isGroup
        );
    }, [accounts]);
    
    const cuentasCaja = useMemo(() => {
        return getCajaAccounts(formData.moneda);
    }, [getCajaAccounts, formData.moneda]);

    const cuentasBanco = useMemo(() => {
        return getBancoAccounts(formData.moneda);
    }, [getBancoAccounts, formData.moneda]);

    // Cargar compras
    useEffect(() => {
        setLoading(true);
        
        // Cargar desde colección compras
        const q = query(
            collection(db, 'compras'),
            orderBy('fecha', 'desc')
        );
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setCompras(data);
            setLoading(false);
        }, (err) => {
            console.error('Error cargando compras:', err);
            setLoading(false);
        });
        
        return () => unsubscribe();
    }, []);

    const comprasFiltradas = useMemo(() => {
        return compras.filter(c => {
            const matchesSearch = 
                c.proveedor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.descripcion?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.factura?.includes(searchTerm);
            
            const matchesTipo = filtroTipo === 'todas' || 
                (filtroTipo === 'credito' && c.esCredito) ||
                (filtroTipo === 'contado' && !c.esCredito);
            
            const matchesSucursal = !filtroSucursal || c.sucursalId === filtroSucursal;
            
            return matchesSearch && matchesTipo && matchesSucursal;
        });
    }, [compras, searchTerm, filtroTipo, filtroSucursal]);

    const totales = useMemo(() => {
        const total = comprasFiltradas.reduce((sum, c) => sum + (c.monto || 0), 0);
        const credito = comprasFiltradas.filter(c => c.esCredito).reduce((sum, c) => sum + (c.monto || 0), 0);
        const contado = comprasFiltradas.filter(c => !c.esCredito).reduce((sum, c) => sum + (c.monto || 0), 0);
        return { total, credito, contado };
    }, [comprasFiltradas]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        
        try {
            const monto = Number(formData.monto);
            const montoUSD = formData.moneda === 'USD' ? monto : 0;
            const montoNIO = formData.moneda === 'NIO' ? monto : monto * Number(formData.tipoCambio);
            
            if (!formData.cuentaGastoId) {
                throw new Error('Debe seleccionar una cuenta de gasto');
            }
            
            // Crear movimientos contables
            const movimientos = [];
            
            if (formData.esCredito) {
                // Compra a crédito: Débito Gasto, Crédito Proveedores
                const proveedoresAccount = getProveedoresAccount();
                if (!proveedoresAccount) {
                    throw new Error('Cuenta de proveedores (210101) no encontrada');
                }
                
                movimientos.push(
                    {
                        cuentaId: formData.cuentaGastoId,
                        cuentaCode: formData.cuentaGastoCode,
                        cuentaName: formData.cuentaGastoName,
                        tipo: 'DEBITO',
                        monto: montoNIO,
                        montoUSD: montoUSD,
                        descripcion: `Compra a crédito: ${formData.descripcion}`
                    },
                    {
                        cuentaId: proveedoresAccount.id,
                        cuentaCode: proveedoresAccount.code,
                        cuentaName: proveedoresAccount.name,
                        tipo: 'CREDITO',
                        monto: montoNIO,
                        montoUSD: montoUSD,
                        descripcion: `Por pagar a ${formData.proveedor}`
                    }
                );
            } else {
                // Compra al contado: Débito Gasto, Crédito Caja/Banco
                const cuentaPago = formData.metodoPago === 'efectivo' 
                    ? cuentasCaja[0]
                    : cuentasBanco.find(b => b.id === formData.bancoId);
                    
                if (!cuentaPago) {
                    throw new Error('Cuenta de pago no encontrada');
                }
                
                movimientos.push(
                    {
                        cuentaId: formData.cuentaGastoId,
                        cuentaCode: formData.cuentaGastoCode,
                        cuentaName: formData.cuentaGastoName,
                        tipo: 'DEBITO',
                        monto: montoNIO,
                        montoUSD: montoUSD,
                        descripcion: `Compra al contado: ${formData.descripcion}`
                    },
                    {
                        cuentaId: cuentaPago.id,
                        cuentaCode: cuentaPago.code,
                        cuentaName: cuentaPago.name,
                        tipo: 'CREDITO',
                        monto: montoNIO,
                        montoUSD: montoUSD,
                        descripcion: `Pago a ${formData.proveedor}`
                    }
                );
            }
            
            // Registrar asiento contable
            const compraRef = doc(collection(db, 'compras'));
            const referenciaCompra = formData.factura || `COM-${compraRef.id.slice(0, 8).toUpperCase()}`;

            const entry = await registerAccountingEntry({
                fecha: formData.fecha,
                descripcion: `Compra: ${formData.descripcion}`,
                referencia: referenciaCompra,
                documentoId: compraRef.id,
                documentoTipo: DOCUMENT_TYPES.GASTO,
                moduloOrigen: 'compras',
                userId: user.uid,
                userEmail: user.email,
                movimientos,
                metadata: {
                    proveedor: formData.proveedor,
                    factura: formData.factura,
                    esCredito: formData.esCredito,
                    moneda: formData.moneda,
                    sucursalId: formData.sucursalId,
                    sucursalName: formData.sucursalName
                }
            });
            
            // Guardar en colección compras
            await setDoc(compraRef, {
                documentoId: compraRef.id,
                fecha: formData.fecha,
                sucursalId: formData.sucursalId,
                sucursalName: formData.sucursalName,
                proveedor: formData.proveedor,
                descripcion: formData.descripcion,
                monto: montoNIO,
                montoUSD: montoUSD,
                moneda: formData.moneda,
                esCredito: formData.esCredito,
                factura: formData.factura,
                cuentaGastoId: formData.cuentaGastoId,
                cuentaGastoCode: formData.cuentaGastoCode,
                cuentaGastoName: formData.cuentaGastoName,
                metodoPago: formData.esCredito ? null : formData.metodoPago,
                bancoId: formData.esCredito ? null : formData.bancoId,
                pagada: !formData.esCredito,
                montoPagado: formData.esCredito ? 0 : montoNIO,
                asientoId: entry.asientoId,
                movimientosContablesIds: entry.movimientos.map(m => m.id),
                createdAt: Timestamp.now(),
                createdBy: user.uid,
                createdByEmail: user.email
            });
            
            setSuccess('Compra registrada exitosamente');
            resetForm();
            setShowModal(false);
            setTimeout(() => setSuccess(null), 3000);
            
        } catch (err) {
            console.error('Error registrando compra:', err);
            setError(err.message || 'Error al registrar la compra');
        } finally {
            setSubmitting(false);
        }
    };
    
    const resetForm = () => {
        setFormData({
            fecha: format(new Date(), 'yyyy-MM-dd'),
            sucursalId: '',
            sucursalName: '',
            proveedor: '',
            descripcion: '',
            monto: '',
            moneda: 'NIO',
            tipoCambio: '36.50',
            esCredito: false,
            factura: '',
            cuentaGastoId: '',
            cuentaGastoCode: '',
            cuentaGastoName: '',
            metodoPago: 'efectivo',
            bancoId: ''
        });
    };

    const formatCurrency = (amount, currency = 'NIO') => {
        const symbol = currency === 'USD' ? '$' : 'C$';
        return `${symbol} ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    const FormField = ({ label, icon: Icon, children, required }) => (
        <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">
                {Icon && <Icon className="w-4 h-4 inline mr-1.5 text-gray-500" />}
                {label}
                {required && <span className="text-red-500 ml-1">*</span>}
            </label>
            {children}
        </div>
    );

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                            <ShoppingCart className="w-6 h-6 text-purple-600" />
                        </div>
                        Compras
                    </h1>
                    <p className="text-gray-600 mt-2">
                        Registre todas las compras al contado y a crédito
                    </p>
                </div>
                <button
                    onClick={() => { resetForm(); setShowModal(true); }}
                    className="mt-4 md:mt-0 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
                >
                    <Plus className="w-5 h-5" />
                    Nueva Compra
                </button>
            </div>

            {/* Resumen */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Total Compras</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(totales.total)}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Compras al Contado</p>
                    <p className="text-2xl font-bold text-green-600">{formatCurrency(totales.contado)}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <p className="text-sm text-gray-500">Compras a Crédito</p>
                    <p className="text-2xl font-bold text-amber-600">{formatCurrency(totales.credito)}</p>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
                <div className="flex flex-wrap gap-4">
                    <div className="flex-1 min-w-[250px]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Buscar por proveedor, descripción, factura..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                            />
                        </div>
                    </div>
                    <select
                        value={filtroTipo}
                        onChange={(e) => setFiltroTipo(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    >
                        <option value="todas">Todas las compras</option>
                        <option value="contado">Al contado</option>
                        <option value="credito">A crédito</option>
                    </select>
                    <select
                        value={filtroSucursal}
                        onChange={(e) => setFiltroSucursal(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    >
                        <option value="">Todas las sucursales</option>
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Tabla */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Fecha</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Factura</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Proveedor</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Descripción</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Sucursal</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Tipo</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Monto</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Estado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading ? (
                            <tr>
                                <td colSpan="8" className="px-4 py-8 text-center">
                                    <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-600" />
                                </td>
                            </tr>
                        ) : comprasFiltradas.length === 0 ? (
                            <tr>
                                <td colSpan="8" className="px-4 py-8 text-center text-gray-500">
                                    <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                                    <p>No hay compras registradas</p>
                                </td>
                            </tr>
                        ) : (
                            comprasFiltradas.map((compra) => (
                                <tr key={compra.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm">{compra.fecha}</td>
                                    <td className="px-4 py-3 text-sm font-mono">{compra.factura || '-'}</td>
                                    <td className="px-4 py-3 text-sm font-medium">{compra.proveedor}</td>
                                    <td className="px-4 py-3 text-sm">{compra.descripcion}</td>
                                    <td className="px-4 py-3 text-sm">{compra.sucursalName || '-'}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`px-2 py-1 rounded-full text-xs ${
                                            compra.esCredito 
                                                ? 'bg-amber-100 text-amber-700' 
                                                : 'bg-green-100 text-green-700'
                                        }`}>
                                            {compra.esCredito ? 'Crédito' : 'Contado'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-medium">
                                        {formatCurrency(compra.monto, compra.moneda)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {compra.esCredito ? (
                                            <span className={`px-2 py-1 rounded-full text-xs ${
                                                compra.pagada 
                                                    ? 'bg-green-100 text-green-700' 
                                                    : 'bg-red-100 text-red-700'
                                            }`}>
                                                {compra.pagada ? 'Pagada' : 'Pendiente'}
                                            </span>
                                        ) : (
                                            <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">
                                                Pagada
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal Nueva Compra */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <ShoppingCart className="w-6 h-6 text-purple-600" />
                                Nueva Compra
                            </h2>
                            <button
                                onClick={() => setShowModal(false)}
                                className="p-2 hover:bg-gray-100 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            {/* Información General */}
                            <div className="bg-gray-50 rounded-xl p-5">
                                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                                    <FileText className="w-4 h-4" />
                                    Información General
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <FormField label="Fecha" icon={Calendar} required>
                                        <input
                                            type="date"
                                            value={formData.fecha}
                                            onChange={(e) => setFormData({...formData, fecha: e.target.value})}
                                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                            required
                                        />
                                    </FormField>
                                    <FormField label="Sucursal" icon={Store} required>
                                        <select
                                            value={formData.sucursalId}
                                            onChange={(e) => {
                                                const sucursal = branches.find(s => s.id === e.target.value);
                                                setFormData({...formData, sucursalId: e.target.value, sucursalName: sucursal?.name || ''});
                                            }}
                                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                            required
                                        >
                                            <option value="">Seleccione...</option>
                                            {branches.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                    </FormField>
                                    <FormField label="Moneda" icon={DollarSign}>
                                        <select
                                            value={formData.moneda}
                                            onChange={(e) => setFormData({...formData, moneda: e.target.value})}
                                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                        >
                                            <option value="NIO">Córdobas (NIO)</option>
                                            <option value="USD">Dólares (USD)</option>
                                        </select>
                                    </FormField>
                                </div>
                            </div>

                            {/* Detalle de la Compra */}
                            <div className="bg-gray-50 rounded-xl p-5">
                                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                                    <TrendingDown className="w-4 h-4" />
                                    Detalle de la Compra
                                </h3>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField label="Proveedor" icon={User} required>
                                            <input
                                                type="text"
                                                value={formData.proveedor}
                                                onChange={(e) => setFormData({...formData, proveedor: e.target.value})}
                                                placeholder="Nombre del proveedor"
                                                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                                required
                                            />
                                        </FormField>
                                        <FormField label="N° Factura" icon={Tag}>
                                            <input
                                                type="text"
                                                value={formData.factura}
                                                onChange={(e) => setFormData({...formData, factura: e.target.value})}
                                                placeholder="Número de factura"
                                                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                            />
                                        </FormField>
                                    </div>
                                    
                                    <FormField label="Descripción" icon={FileText} required>
                                        <input
                                            type="text"
                                            value={formData.descripcion}
                                            onChange={(e) => setFormData({...formData, descripcion: e.target.value})}
                                            placeholder="Descripción de la compra"
                                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                            required
                                        />
                                    </FormField>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField label="Monto" icon={DollarSign} required>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={formData.monto}
                                                onChange={(e) => setFormData({...formData, monto: e.target.value})}
                                                placeholder="0.00"
                                                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                                required
                                            />
                                        </FormField>
                                        {formData.moneda === 'USD' && (
                                            <FormField label="Tipo de Cambio">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={formData.tipoCambio}
                                                    onChange={(e) => setFormData({...formData, tipoCambio: e.target.value})}
                                                    placeholder="36.50"
                                                    className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                                />
                                            </FormField>
                                        )}
                                    </div>

                                    <FormField label="Cuenta de Gasto" icon={TrendingDown} required>
                                        <select
                                            value={formData.cuentaGastoId}
                                            onChange={(e) => {
                                                const cuenta = cuentasGastos.find(c => c.id === e.target.value);
                                                setFormData({
                                                    ...formData,
                                                    cuentaGastoId: e.target.value,
                                                    cuentaGastoCode: cuenta?.code || '',
                                                    cuentaGastoName: cuenta?.name || ''
                                                });
                                            }}
                                            className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                            required
                                        >
                                            <option value="">Seleccione una cuenta...</option>
                                            {cuentasGastos.map(c => (
                                                <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                                            ))}
                                        </select>
                                    </FormField>
                                </div>
                            </div>

                            {/* Tipo de Compra */}
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.esCredito}
                                        onChange={(e) => setFormData({...formData, esCredito: e.target.checked})}
                                        className="w-5 h-5 text-purple-600 mt-0.5"
                                    />
                                    <div>
                                        <span className="font-medium text-gray-800">Es una compra a crédito</span>
                                        <p className="text-sm text-gray-600 mt-1">
                                            Se registrará en Proveedores (210101) para pagar después
                                        </p>
                                    </div>
                                </label>
                            </div>

                            {/* Método de Pago (solo si es contado) */}
                            {!formData.esCredito && (
                                <div className="bg-gray-50 rounded-xl p-5">
                                    <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                                        <CreditCard className="w-4 h-4" />
                                        Método de Pago
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField label="Método de Pago">
                                            <select
                                                value={formData.metodoPago}
                                                onChange={(e) => setFormData({...formData, metodoPago: e.target.value, bancoId: ''})}
                                                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                            >
                                                <option value="efectivo">Efectivo</option>
                                                <option value="transferencia">Transferencia Bancaria</option>
                                                <option value="cheque">Cheque</option>
                                            </select>
                                        </FormField>
                                        {formData.metodoPago !== 'efectivo' && (
                                            <FormField label="Banco" icon={Building2} required={formData.metodoPago !== 'efectivo'}>
                                                <select
                                                    value={formData.bancoId}
                                                    onChange={(e) => setFormData({...formData, bancoId: e.target.value})}
                                                    className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                                    required={formData.metodoPago !== 'efectivo'}
                                                >
                                                    <option value="">Seleccione un banco...</option>
                                                    {cuentasBanco.map(b => (
                                                        <option key={b.id} value={b.id}>{b.code} - {b.name}</option>
                                                    ))}
                                                </select>
                                            </FormField>
                                        )}
                                    </div>
                                </div>
                            )}

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

                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {submitting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                                    {submitting ? 'Registrando...' : 'Registrar Compra'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Compras;
