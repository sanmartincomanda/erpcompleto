// src/components/Proveedores.jsx - Administración de Proveedores
import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { 
    collection, query, orderBy, onSnapshot, 
    addDoc, updateDoc, deleteDoc, doc, Timestamp,
    where, getDocs
} from 'firebase/firestore';
import { 
    Building2, Plus, Edit2, Trash2, Save, X, 
    Search, Phone, MapPin, CreditCard, Calendar,
    DollarSign, User, Mail, RefreshCw, AlertCircle,
    CheckCircle
} from 'lucide-react';

const Proveedores = () => {
    const [proveedores, setProveedores] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    
    const [formData, setFormData] = useState({
        codigo: '',
        nombre: '',
        ruc: '',
        direccion: '',
        telefono: '',
        email: '',
        contacto: '',
        limiteCredito: '',
        plazoDias: '30',
        cuentaContableId: '',
        cuentaContableCode: '',
        cuentaContableName: '',
        activo: true,
        notas: ''
    });
    
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [cuentasPagar, setCuentasPagar] = useState([]);

    // Cargar proveedores
    useEffect(() => {
        setLoading(true);
        const q = query(collection(db, 'proveedores'), orderBy('nombre'));
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setProveedores(data);
            setLoading(false);
        }, (err) => {
            console.error('Error cargando proveedores:', err);
            setLoading(false);
        });
        
        return () => unsubscribe();
    }, []);

    // Cargar cuentas por pagar (2101 - Cuentas y Documentos por Pagar)
    useEffect(() => {
        const loadCuentas = async () => {
            // Cargar todas las cuentas de tipo PASIVO
            const q = query(
                collection(db, 'planCuentas'),
                where('type', '==', 'PASIVO'),
                where('isGroup', '==', false)
            );
            const snapshot = await getDocs(q);
            const cuentas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // Filtrar cuentas del grupo 2101 (Cuentas y Documentos por Pagar)
            const cuentas2101 = cuentas.filter(c => {
                const code = (c.code || '').replace(/\./g, '');
                return code.startsWith('2101');
            });
            
            setCuentasPagar(cuentas2101);
        };
        loadCuentas();
    }, []);

    const proveedoresFiltrados = proveedores.filter(p => 
        p.nombre?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.codigo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.ruc?.includes(searchTerm)
    );

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        
        try {
            const data = {
                ...formData,
                limiteCredito: Number(formData.limiteCredito) || 0,
                plazoDias: Number(formData.plazoDias) || 30,
                updatedAt: Timestamp.now()
            };
            
            if (editingId) {
                await updateDoc(doc(db, 'proveedores', editingId), data);
                setSuccess('Proveedor actualizado exitosamente');
            } else {
                await addDoc(collection(db, 'proveedores'), {
                    ...data,
                    activo: true, // Asegurar que se cree como activo
                    saldoPendiente: 0,
                    totalCompras: 0,
                    totalPagos: 0,
                    createdAt: Timestamp.now()
                });
                setSuccess('Proveedor creado exitosamente');
            }
            
            setShowModal(false);
            resetForm();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            console.error('Error guardando proveedor:', err);
            setError(err.message || 'Error al guardar el proveedor');
        }
        
        setSubmitting(false);
    };

    const handleDelete = async (id) => {
        if (confirm('¿Eliminar este proveedor?')) {
            try {
                await deleteDoc(doc(db, 'proveedores', id));
                setSuccess('Proveedor eliminado');
                setTimeout(() => setSuccess(null), 3000);
            } catch (err) {
                setError('Error al eliminar: ' + err.message);
            }
        }
    };

    const openEditModal = (proveedor) => {
        setEditingId(proveedor.id);
        setFormData({
            codigo: proveedor.codigo || '',
            nombre: proveedor.nombre || '',
            ruc: proveedor.ruc || '',
            direccion: proveedor.direccion || '',
            telefono: proveedor.telefono || '',
            email: proveedor.email || '',
            contacto: proveedor.contacto || '',
            limiteCredito: proveedor.limiteCredito || '',
            plazoDias: proveedor.plazoDias || '30',
            cuentaContableId: proveedor.cuentaContableId || '',
            cuentaContableCode: proveedor.cuentaContableCode || '',
            cuentaContableName: proveedor.cuentaContableName || '',
            activo: proveedor.activo !== false,
            notas: proveedor.notas || ''
        });
        setShowModal(true);
        setError(null);
    };

    const openNewModal = () => {
        setEditingId(null);
        resetForm();
        setShowModal(true);
        setError(null);
    };

    const resetForm = () => {
        setFormData({
            codigo: '',
            nombre: '',
            ruc: '',
            direccion: '',
            telefono: '',
            email: '',
            contacto: '',
            limiteCredito: '',
            plazoDias: '30',
            cuentaContableId: '',
            cuentaContableCode: '',
            cuentaContableName: '',
            activo: true,
            notas: ''
        });
    };

    const formatCurrency = (amount) => {
        return `C$ ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Building2 className="w-6 h-6 text-blue-600" />
                        </div>
                        Proveedores
                    </h1>
                    <p className="text-slate-600 mt-2">
                        Administre proveedores, límites de crédito y plazos de pago
                    </p>
                </div>
                <button
                    onClick={openNewModal}
                    className="mt-4 md:mt-0 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                    <Plus className="w-5 h-5" />
                    Nuevo Proveedor
                </button>
            </div>

            {/* Mensajes */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                </div>
            )}
            {success && (
                <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
                    <CheckCircle className="w-5 h-5" />
                    {success}
                </div>
            )}

            {/* Filtros */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, código o RUC..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            </div>

            {/* Tabla */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Código</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Nombre</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-slate-700">Contacto</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-slate-700">Límite Crédito</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-slate-700">Plazo</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-slate-700">Saldo</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-slate-700">Estado</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-slate-700">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr>
                                <td colSpan="8" className="px-4 py-8 text-center">
                                    <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
                                </td>
                            </tr>
                        ) : proveedoresFiltrados.length === 0 ? (
                            <tr>
                                <td colSpan="8" className="px-4 py-8 text-center text-slate-500">
                                    <Building2 className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                                    <p>No hay proveedores registrados</p>
                                </td>
                            </tr>
                        ) : (
                            proveedoresFiltrados.map((p) => (
                                <tr key={p.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 font-mono text-sm">{p.codigo}</td>
                                    <td className="px-4 py-3">
                                        <p className="font-medium">{p.nombre}</p>
                                        {p.ruc && <p className="text-xs text-slate-500">RUC: {p.ruc}</p>}
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        {p.contacto && <p>{p.contacto}</p>}
                                        {p.telefono && <p className="text-xs text-slate-500">{p.telefono}</p>}
                                    </td>
                                    <td className="px-4 py-3 text-right text-sm">{formatCurrency(p.limiteCredito)}</td>
                                    <td className="px-4 py-3 text-center text-sm">{p.plazoDias} días</td>
                                    <td className="px-4 py-3 text-right text-sm">
                                        <span className={p.saldoPendiente > 0 ? 'text-red-600 font-medium' : ''}>
                                            {formatCurrency(p.saldoPendiente)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`px-2 py-1 rounded-full text-xs ${
                                            p.activo !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                                        }`}>
                                            {p.activo !== false ? 'Activo' : 'Inactivo'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => openEditModal(p)}
                                                className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(p.id)}
                                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900">
                                {editingId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                            </h2>
                            <button
                                onClick={() => setShowModal(false)}
                                className="p-2 hover:bg-slate-100 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Código *</label>
                                    <input
                                        type="text"
                                        value={formData.codigo}
                                        onChange={(e) => setFormData({...formData, codigo: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">RUC</label>
                                    <input
                                        type="text"
                                        value={formData.ruc}
                                        onChange={(e) => setFormData({...formData, ruc: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre *</label>
                                <input
                                    type="text"
                                    value={formData.nombre}
                                    onChange={(e) => setFormData({...formData, nombre: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Dirección</label>
                                <input
                                    type="text"
                                    value={formData.direccion}
                                    onChange={(e) => setFormData({...formData, direccion: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono</label>
                                    <input
                                        type="text"
                                        value={formData.telefono}
                                        onChange={(e) => setFormData({...formData, telefono: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({...formData, email: e.target.value})}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Persona de Contacto</label>
                                <input
                                    type="text"
                                    value={formData.contacto}
                                    onChange={(e) => setFormData({...formData, contacto: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                />
                            </div>

                            <div className="bg-slate-50 rounded-lg p-4 space-y-4">
                                <h3 className="font-medium text-slate-800">Crédito</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            <DollarSign className="w-4 h-4 inline mr-1" />
                                            Límite de Crédito
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.limiteCredito}
                                            onChange={(e) => setFormData({...formData, limiteCredito: e.target.value})}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            <Calendar className="w-4 h-4 inline mr-1" />
                                            Plazo (días)
                                        </label>
                                        <input
                                            type="number"
                                            value={formData.plazoDias}
                                            onChange={(e) => setFormData({...formData, plazoDias: e.target.value})}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    <CreditCard className="w-4 h-4 inline mr-1" />
                                    Cuenta Contable por Defecto
                                </label>
                                <select
                                    value={formData.cuentaContableId}
                                    onChange={(e) => {
                                        const cuenta = cuentasPagar.find(c => c.id === e.target.value);
                                        setFormData({
                                            ...formData,
                                            cuentaContableId: e.target.value,
                                            cuentaContableCode: cuenta?.code || '',
                                            cuentaContableName: cuenta?.name || ''
                                        });
                                    }}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                >
                                    <option value="">Seleccione cuenta contable...</option>
                                    {cuentasPagar.map(c => (
                                        <option key={c.id} value={c.id}>
                                            {c.code} - {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Notas</label>
                                <textarea
                                    value={formData.notas}
                                    onChange={(e) => setFormData({...formData, notas: e.target.value})}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                                    rows={3}
                                />
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={formData.activo}
                                    onChange={(e) => setFormData({...formData, activo: e.target.checked})}
                                    className="w-4 h-4"
                                />
                                <label className="text-sm text-slate-700">Proveedor activo</label>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {submitting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                    {submitting ? 'Guardando...' : 'Guardar'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Proveedores;
