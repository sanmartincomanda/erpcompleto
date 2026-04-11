// src/components/ERP/MovimientosContables.jsx - Movimientos Contables con Edición
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, where, getDocs, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useBranches } from '../../hooks/useBranches';
import { deleteMovimientoContable } from '../../services/unifiedAccountingService';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
    FileText, Search, RefreshCw, ArrowDownLeft, ArrowUpRight,
    Calendar, Filter, X, ChevronLeft, ChevronRight,
    BarChart3, TrendingUp, TrendingDown, Building2, User,
    Edit2, Trash2, Save, AlertCircle, CheckCircle, Eye,
    Link2, Hash, DollarSign
} from 'lucide-react';

const normalizeTipoMovimiento = (movimiento) =>
    movimiento?.tipo || movimiento?.type || '';

const moduloAliases = {
    depositoTransito: ['depositoTransito', 'deposito'],
    'cuentas-pagar': ['cuentas-pagar', 'cuentasPagar']
};

const matchesModulo = (selectedModulo, actualModulo) => {
    if (selectedModulo === 'todos') return true;
    return (moduloAliases[selectedModulo] || [selectedModulo]).includes(actualModulo);
};

const getMovimientoSucursalId = (movimiento) =>
    movimiento?.sucursalId || movimiento?.branchId || '';

const getMovimientoSucursalName = (movimiento) =>
    movimiento?.sucursalName || movimiento?.branchName || movimiento?.tienda || 'General';

const MovimientosContables = () => {
    const { branches } = useBranches();
    const sucursalesActivas = useMemo(
        () => branches.filter((branch) => branch.isActive !== false),
        [branches]
    );
    const [movimientos, setMovimientos] = useState([]);
    const [cuentas, setCuentas] = useState([]);
    const [loading, setLoading] = useState(true);
    
    // Filtros
    const [searchTerm, setSearchTerm] = useState('');
    const [filtroTipo, setFiltroTipo] = useState('todos');
    const [filtroFechaDesde, setFiltroFechaDesde] = useState('');
    const [filtroFechaHasta, setFiltroFechaHasta] = useState('');
    const [filtroModulo, setFiltroModulo] = useState('todos');
    const [filtroCuenta, setFiltroCuenta] = useState('');
    const [filtroSucursal, setFiltroSucursal] = useState('');
    
    // Paginación
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 50;
    
    // Modales
    const [editingMovimiento, setEditingMovimiento] = useState(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showAsientoModal, setShowAsientoModal] = useState(false);
    const [asientoSeleccionado, setAsientoSeleccionado] = useState(null);
    
    // Mensajes
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // Módulos disponibles
    const modulos = [
        { id: 'todos', name: 'Todos' },
        { id: 'dataEntry', name: 'Data Entry' },
        { id: 'cierreCaja', name: 'Cierre de Caja' },
        { id: 'depositoTransito', name: 'Depósitos' },
        { id: 'confirmacionDeposito', name: 'Confirmación Depósito' },
        { id: 'compras', name: 'Compras' },
        { id: 'cuentas-pagar', name: 'Cuentas por Pagar' },
        { id: 'facturaProveedor', name: 'Facturas Proveedor' },
        { id: 'abonoProveedor', name: 'Abonos Proveedor' },
        { id: 'ajusteManual', name: 'Ajustes Manuales' },
        { id: 'sistema', name: 'Sistema' }
    ];

    // Cargar movimientos
    useEffect(() => {
        setLoading(true);
        const movimientosRef = collection(db, 'movimientosContables');
        const q = query(movimientosRef, orderBy('timestamp', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map((docSnapshot) => {
                const raw = docSnapshot.data();
                const tipo = normalizeTipoMovimiento(raw);

                return {
                    id: docSnapshot.id,
                    ...raw,
                    tipo,
                    type: raw.type || tipo,
                    sucursalId: getMovimientoSucursalId(raw),
                    sucursalName: getMovimientoSucursalName(raw)
                };
            });
            setMovimientos(data);
            setLoading(false);
        }, (err) => {
            console.error('Error cargando movimientos:', err);
            setError('Error al cargar movimientos');
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Cargar cuentas para el selector
    useEffect(() => {
        const loadCuentas = async () => {
            const q = query(collection(db, 'planCuentas'), orderBy('code'));
            const snapshot = await getDocs(q);
            setCuentas(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        };
        loadCuentas();
    }, []);

    // Agrupar movimientos por referencia (asientos)
    const asientos = useMemo(() => {
        const grupos = {};
        movimientos.forEach(mov => {
            const key = mov.referencia || mov.documentoId || 'sin-referencia';
            if (!grupos[key]) {
                grupos[key] = {
                    referencia: key,
                    fecha: mov.fecha,
                    descripcion: mov.descripcion,
                    moduloOrigen: mov.moduloOrigen,
                    sucursalName: mov.sucursalName || 'General',
                    movimientos: [],
                    totalDebito: 0,
                    totalCredito: 0,
                    cuadrado: false
                };
            }
            grupos[key].movimientos.push(mov);
            if (mov.tipo === 'DEBITO') {
                grupos[key].totalDebito += Number(mov.monto || 0);
            } else {
                grupos[key].totalCredito += Number(mov.monto || 0);
            }
        });
        
        // Verificar si está cuadrado
        Object.values(grupos).forEach(asiento => {
            asiento.cuadrado = Math.abs(asiento.totalDebito - asiento.totalCredito) < 0.01;
        });
        
        return Object.values(grupos).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    }, [movimientos]);

    // Filtrar movimientos
    const movimientosFiltrados = useMemo(() => {
        return movimientos.filter(mov => {
            const tipoMovimiento = normalizeTipoMovimiento(mov);
            const matchesSearch = 
                mov.descripcion?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                mov.accountCode?.includes(searchTerm) ||
                mov.accountName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                mov.referencia?.includes(searchTerm) ||
                mov.documentoNumero?.includes(searchTerm) ||
                mov.sucursalName?.toLowerCase().includes(searchTerm.toLowerCase());
            
            const matchesTipo = filtroTipo === 'todos' || tipoMovimiento === filtroTipo;
            const matchesModuloFiltro = matchesModulo(filtroModulo, mov.moduloOrigen);
            const matchesCuenta = !filtroCuenta || mov.accountId === filtroCuenta;
            const matchesSucursal = !filtroSucursal || mov.sucursalId === filtroSucursal;
            const matchesFechaDesde = !filtroFechaDesde || (mov.fecha >= filtroFechaDesde);
            const matchesFechaHasta = !filtroFechaHasta || (mov.fecha <= filtroFechaHasta);
            
            return matchesSearch && matchesTipo && matchesModuloFiltro && matchesCuenta && matchesSucursal && matchesFechaDesde && matchesFechaHasta;
        });
    }, [movimientos, searchTerm, filtroTipo, filtroModulo, filtroCuenta, filtroSucursal, filtroFechaDesde, filtroFechaHasta]);

    // Paginación
    const totalPages = Math.ceil(movimientosFiltrados.length / itemsPerPage);
    const movimientosPaginados = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return movimientosFiltrados.slice(start, start + itemsPerPage);
    }, [movimientosFiltrados, currentPage]);

    // Calcular totales
    const totales = useMemo(() => {
        const debitos = movimientosFiltrados
            .filter(m => m.tipo === 'DEBITO')
            .reduce((sum, m) => sum + Number(m.monto || 0), 0);
        const creditos = movimientosFiltrados
            .filter(m => m.tipo === 'CREDITO')
            .reduce((sum, m) => sum + Number(m.monto || 0), 0);
        return { 
            debitos, 
            creditos, 
            saldo: debitos - creditos,
            count: movimientosFiltrados.length 
        };
    }, [movimientosFiltrados]);

    const formatCurrency = (amount) => {
        return `C$ ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return '-';
        if (timestamp.seconds) {
            return format(new Date(timestamp.seconds * 1000), 'dd/MM/yyyy HH:mm', { locale: es });
        }
        return timestamp;
    };

    // Editar movimiento
    const handleEdit = (movimiento) => {
        setEditingMovimiento({
            ...movimiento,
            fecha: movimiento.fecha || new Date().toISOString().split('T')[0]
        });
        setShowEditModal(true);
    };

    const handleSaveEdit = async (e) => {
        e.preventDefault();
        setError(null);
        
        try {
            const cuenta = cuentas.find(c => c.id === editingMovimiento.accountId);
            
            await updateDoc(doc(db, 'movimientosContables', editingMovimiento.id), {
                fecha: editingMovimiento.fecha,
                accountId: editingMovimiento.accountId,
                accountCode: cuenta?.code || editingMovimiento.accountCode,
                accountName: cuenta?.name || editingMovimiento.accountName,
                tipo: editingMovimiento.tipo,
                type: editingMovimiento.tipo,
                monto: Number(editingMovimiento.monto),
                descripcion: editingMovimiento.descripcion,
                referencia: editingMovimiento.referencia,
                updatedAt: Timestamp.now()
            });
            
            setSuccess('Movimiento actualizado correctamente');
            setShowEditModal(false);
            setEditingMovimiento(null);
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError('Error al actualizar: ' + err.message);
        }
    };

    // Eliminar movimiento
    const handleDelete = async (movimiento) => {
        if (!confirm('¿Eliminar este movimiento contable?\n\nEsta acción no se puede deshacer.')) return;
        
        try {
            await deleteMovimientoContable(movimiento.id);
            setSuccess('Movimiento eliminado');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError('Error al eliminar: ' + err.message);
        }
    };

    // Ver asiento completo
    const handleVerAsiento = (referencia) => {
        const asiento = asientos.find(a => a.referencia === referencia);
        if (asiento) {
            setAsientoSeleccionado(asiento);
            setShowAsientoModal(true);
        }
    };

    const limpiarFiltros = () => {
        setSearchTerm('');
        setFiltroTipo('todos');
        setFiltroModulo('todos');
        setFiltroCuenta('');
        setFiltroSucursal('');
        setFiltroFechaDesde('');
        setFiltroFechaHasta('');
        setCurrentPage(1);
    };

    if (loading && movimientos.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-8 h-8 text-blue-600" />
                    Movimientos Contables
                </h1>
                <p className="text-slate-600 mt-1">
                    Consulte, edite y gestione todos los movimientos del sistema
                </p>
            </div>

            {/* Mensajes */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
                </div>
            )}
            {success && (
                <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
                    <CheckCircle className="w-5 h-5" />
                    {success}
                </div>
            )}

            {/* Tarjetas de resumen */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-100 rounded-lg">
                            <FileText className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500">Total Movimientos</p>
                            <p className="text-2xl font-bold text-slate-800">{totales.count}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-green-100 rounded-lg">
                            <TrendingUp className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500">Total Débitos</p>
                            <p className="text-2xl font-bold text-green-600">{formatCurrency(totales.debitos)}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-red-100 rounded-lg">
                            <TrendingDown className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500">Total Créditos</p>
                            <p className="text-2xl font-bold text-red-600">{formatCurrency(totales.creditos)}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-3 rounded-lg ${Math.abs(totales.saldo) < 0.01 ? 'bg-green-100' : 'bg-orange-100'}`}>
                            <BarChart3 className={`w-6 h-6 ${Math.abs(totales.saldo) < 0.01 ? 'text-green-600' : 'text-orange-600'}`} />
                        </div>
                        <div>
                            <p className="text-sm text-slate-500">Diferencia</p>
                            <p className={`text-2xl font-bold ${Math.abs(totales.saldo) < 0.01 ? 'text-green-600' : 'text-orange-600'}`}>
                                {formatCurrency(totales.saldo)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            <Search className="w-4 h-4 inline mr-1" />
                            Buscar
                        </label>
                        <input
                            type="text"
                            placeholder="Cuenta, descripción, referencia..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            <Hash className="w-4 h-4 inline mr-1" />
                            Cuenta Contable
                        </label>
                        <select
                            value={filtroCuenta}
                            onChange={(e) => setFiltroCuenta(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Todas las cuentas</option>
                            {cuentas.filter(c => !c.isGroup).map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.code} - {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                <Calendar className="w-4 h-4 inline mr-1" />
                                Desde
                            </label>
                            <input
                                type="date"
                                value={filtroFechaDesde}
                                onChange={(e) => setFiltroFechaDesde(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-slate-700 mb-1">Hasta</label>
                            <input
                                type="date"
                                value={filtroFechaHasta}
                                onChange={(e) => setFiltroFechaHasta(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                <Filter className="w-4 h-4 inline mr-1" />
                                Tipo
                            </label>
                            <select
                                value={filtroTipo}
                                onChange={(e) => setFiltroTipo(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                            >
                                <option value="todos">Todos</option>
                                <option value="DEBITO">Débitos</option>
                                <option value="CREDITO">Créditos</option>
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                <Building2 className="w-4 h-4 inline mr-1" />
                                Módulo
                            </label>
                            <select
                                value={filtroModulo}
                                onChange={(e) => setFiltroModulo(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                            >
                                {modulos.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            <Building2 className="w-4 h-4 inline mr-1" />
                            Sucursal
                        </label>
                        <select
                            value={filtroSucursal}
                            onChange={(e) => setFiltroSucursal(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        >
                            <option value="">Todas las sucursales</option>
                            {sucursalesActivas.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                    {branch.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="mt-4 flex justify-end">
                    <button
                        onClick={limpiarFiltros}
                        className="px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-sm"
                    >
                        Limpiar filtros
                    </button>
                </div>
            </div>

            {/* Tabla de Movimientos */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-3 py-3 text-left text-sm font-medium text-slate-700">Fecha</th>
                            <th className="px-3 py-3 text-left text-sm font-medium text-slate-700">Cuenta</th>
                            <th className="px-3 py-3 text-left text-sm font-medium text-slate-700">Descripción</th>
                            <th className="px-3 py-3 text-left text-sm font-medium text-slate-700">Referencia</th>
                            <th className="px-3 py-3 text-left text-sm font-medium text-slate-700">Origen</th>
                            <th className="px-3 py-3 text-left text-sm font-medium text-slate-700">Sucursal</th>
                            <th className="px-3 py-3 text-right text-sm font-medium text-slate-700">Monto</th>
                            <th className="px-3 py-3 text-center text-sm font-medium text-slate-700">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {movimientosPaginados.map((mov) => (
                            <tr key={mov.id} className="hover:bg-slate-50">
                                <td className="px-3 py-3 text-sm text-slate-600">{mov.fecha}</td>
                                <td className="px-3 py-3">
                                    <span className="font-mono text-xs text-slate-500 block">{mov.accountCode}</span>
                                    <span className="text-sm">{mov.accountName}</span>
                                </td>
                                <td className="px-3 py-3 text-sm max-w-xs truncate" title={mov.descripcion}>
                                    {mov.descripcion}
                                </td>
                                <td className="px-3 py-3 text-sm font-mono text-slate-600">
                                    {mov.referencia && (
                                        <button
                                            onClick={() => handleVerAsiento(mov.referencia)}
                                            className="text-blue-600 hover:underline flex items-center gap-1"
                                        >
                                            <Link2 className="w-3 h-3" />
                                            {mov.referencia}
                                        </button>
                                    )}
                                </td>
                                <td className="px-3 py-3 text-sm">
                                    <span className="px-2 py-1 bg-slate-100 rounded text-xs">
                                        {mov.moduloOrigen || 'Sistema'}
                                    </span>
                                </td>
                                <td className="px-3 py-3 text-sm">{mov.sucursalName || 'General'}</td>
                                <td className="px-3 py-3 text-right">
                                    <span className={`flex items-center justify-end gap-1 font-medium ${
                                        mov.tipo === 'DEBITO' ? 'text-red-600' : 'text-green-600'
                                    }`}>
                                        {mov.tipo === 'DEBITO' ? (
                                            <ArrowDownLeft className="w-4 h-4" />
                                        ) : (
                                            <ArrowUpRight className="w-4 h-4" />
                                        )}
                                        {formatCurrency(mov.monto)}
                                    </span>
                                </td>
                                <td className="px-3 py-3 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                        <button
                                            onClick={() => handleEdit(mov)}
                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                                            title="Editar"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(mov)}
                                            className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                
                {movimientosPaginados.length === 0 && (
                    <div className="p-8 text-center text-slate-500">
                        <FileText className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                        <p>No se encontraron movimientos</p>
                    </div>
                )}
            </div>

            {/* Paginación */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-slate-600">
                        Mostrando {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, movimientosFiltrados.length)} de {movimientosFiltrados.length}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-2 border border-slate-300 rounded-lg disabled:opacity-50 hover:bg-slate-50"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-4 py-2 text-sm text-slate-600">
                            Página {currentPage} de {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-2 border border-slate-300 rounded-lg disabled:opacity-50 hover:bg-slate-50"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* Modal: Editar Movimiento */}
            {showEditModal && editingMovimiento && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                <Edit2 className="w-6 h-6 text-blue-600" />
                                Editar Movimiento
                            </h2>
                            <button onClick={() => setShowEditModal(false)} className="p-2 hover:bg-slate-100 rounded">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Fecha</label>
                                <input
                                    type="date"
                                    value={editingMovimiento.fecha}
                                    onChange={(e) => setEditingMovimiento({...editingMovimiento, fecha: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    required
                                />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Cuenta Contable</label>
                                <select
                                    value={editingMovimiento.accountId}
                                    onChange={(e) => {
                                        const cuenta = cuentas.find(c => c.id === e.target.value);
                                        setEditingMovimiento({
                                            ...editingMovimiento,
                                            accountId: e.target.value,
                                            accountCode: cuenta?.code || '',
                                            accountName: cuenta?.name || ''
                                        });
                                    }}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    required
                                >
                                    <option value="">Seleccione cuenta...</option>
                                    {cuentas.filter(c => !c.isGroup).map(c => (
                                        <option key={c.id} value={c.id}>
                                            {c.code} - {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
                                    <select
                                        value={editingMovimiento.tipo}
                                        onChange={(e) => setEditingMovimiento({...editingMovimiento, tipo: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    >
                                        <option value="DEBITO">DÉBITO</option>
                                        <option value="CREDITO">CRÉDITO</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Monto</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={editingMovimiento.monto}
                                        onChange={(e) => setEditingMovimiento({...editingMovimiento, monto: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                        required
                                    />
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
                                <textarea
                                    value={editingMovimiento.descripcion}
                                    onChange={(e) => setEditingMovimiento({...editingMovimiento, descripcion: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    rows={2}
                                />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Referencia</label>
                                <input
                                    type="text"
                                    value={editingMovimiento.referencia || ''}
                                    onChange={(e) => setEditingMovimiento({...editingMovimiento, referencia: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                />
                            </div>
                            
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowEditModal(false)}
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    <Save className="w-5 h-5 inline mr-2" />
                                    Guardar Cambios
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Ver Asiento Completo */}
            {showAsientoModal && asientoSeleccionado && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                    <FileText className="w-6 h-6 text-blue-600" />
                                    Asiento Contable
                                </h2>
                                <p className="text-slate-600 mt-1">{asientoSeleccionado.referencia}</p>
                            </div>
                            <button
                                onClick={() => setShowAsientoModal(false)}
                                className="p-2 hover:bg-slate-200 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6">
                            {/* Info general */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-slate-50 rounded-lg">
                                <div>
                                    <label className="text-sm text-slate-500">Fecha</label>
                                    <p className="font-medium">{asientoSeleccionado.fecha}</p>
                                </div>
                                <div>
                                    <label className="text-sm text-slate-500">Módulo</label>
                                    <p className="font-medium">{asientoSeleccionado.moduloOrigen || 'Sistema'}</p>
                                </div>
                                <div>
                                    <label className="text-sm text-slate-500">Sucursal</label>
                                    <p className="font-medium">{asientoSeleccionado.sucursalName || 'General'}</p>
                                </div>
                                <div>
                                    <label className="text-sm text-slate-500">Estado</label>
                                    <p className={`font-medium ${asientoSeleccionado.cuadrado ? 'text-green-600' : 'text-red-600'}`}>
                                        {asientoSeleccionado.cuadrado ? '✓ Cuadrado' : '✗ Descuadrado'}
                                    </p>
                                </div>
                            </div>

                            {/* Tabla de movimientos */}
                            <table className="w-full border border-slate-200 rounded-lg">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Código</th>
                                        <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Cuenta</th>
                                        <th className="px-4 py-3 text-right text-sm font-medium text-slate-700">Débito</th>
                                        <th className="px-4 py-3 text-right text-sm font-medium text-slate-700">Crédito</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {asientoSeleccionado.movimientos?.map((mov, idx) => (
                                        <tr key={idx} className={mov.id === editingMovimiento?.id ? 'bg-yellow-50' : ''}>
                                            <td className="px-4 py-3 font-mono text-sm text-slate-600">{mov.accountCode}</td>
                                            <td className="px-4 py-3 text-sm">{mov.accountName}</td>
                                            <td className="px-4 py-3 text-right text-sm">
                                                {mov.tipo === 'DEBITO' ? (
                                                    <span className="text-red-600 font-medium">{formatCurrency(mov.monto)}</span>
                                                ) : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm">
                                                {mov.tipo === 'CREDITO' ? (
                                                    <span className="text-green-600 font-medium">{formatCurrency(mov.monto)}</span>
                                                ) : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-50 font-medium">
                                    <tr>
                                        <td colSpan={2} className="px-4 py-3 text-right">Totales:</td>
                                        <td className="px-4 py-3 text-right text-red-600">
                                            {formatCurrency(asientoSeleccionado.totalDebito)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-green-600">
                                            {formatCurrency(asientoSeleccionado.totalCredito)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                            
                            {!asientoSeleccionado.cuadrado && (
                                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-red-700 flex items-center gap-2">
                                        <AlertCircle className="w-5 h-5" />
                                        <strong>Asiento descuadrado:</strong> Diferencia de {formatCurrency(Math.abs(asientoSeleccionado.totalDebito - asientoSeleccionado.totalCredito))}
                                    </p>
                                    <p className="text-red-600 text-sm mt-1">
                                        Revise los movimientos y corrija los montos para cuadrar el asiento.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MovimientosContables;
