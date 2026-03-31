// src/components/ERP/AjustesManuales.jsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { usePlanCuentas } from '../../hooks/useUnifiedAccounting';
import { createAjusteManual, aprobarAjusteManual, rechazarAjusteManual } from '../../services/unifiedAccountingService';
import { format } from 'date-fns';
import { Plus, CheckCircle, XCircle, RefreshCw, AlertCircle, DollarSign } from 'lucide-react';

const AjustesManuales = () => {
    const { user } = useAuth();
    const { accounts } = usePlanCuentas();
    const [ajustes, setAjustes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({
        fecha: format(new Date(), 'yyyy-MM-dd'),
        cuentaId: '',
        tipoMovimiento: 'DEBITO',
        monto: '',
        descripcion: '',
        justificacion: ''
    });

    useEffect(() => {
        const ajustesRef = collection(db, 'ajustesManuales');
        const q = query(ajustesRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setAjustes(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const cuenta = accounts.find(a => a.id === formData.cuentaId);
            if (!cuenta) return;

            await createAjusteManual({
                fecha: formData.fecha,
                tipo: 'correccion',
                cuentaId: formData.cuentaId,
                cuentaCode: cuenta.code,
                cuentaName: cuenta.name,
                tipoMovimiento: formData.tipoMovimiento,
                monto: Number(formData.monto),
                descripcion: formData.descripcion,
                justificacion: formData.justificacion,
                userId: user.uid,
                userEmail: user.email
            });

            setShowModal(false);
            setFormData({
                fecha: format(new Date(), 'yyyy-MM-dd'),
                cuentaId: '',
                tipoMovimiento: 'DEBITO',
                monto: '',
                descripcion: '',
                justificacion: ''
            });
        } catch (err) {
            console.error('Error creando ajuste:', err);
            alert('Error al crear el ajuste');
        }
    };

    const handleAprobar = async (id) => {
        try {
            await aprobarAjusteManual(id, user.uid, user.email);
        } catch (err) {
            console.error('Error aprobando ajuste:', err);
            alert(err.message || 'Error al aprobar el ajuste');
        }
    };

    const handleRechazar = async (id) => {
        const motivo = prompt('Motivo del rechazo:');
        if (motivo) {
            try {
                await rechazarAjusteManual(id, motivo, user.uid, user.email);
            } catch (err) {
                console.error('Error rechazando ajuste:', err);
                alert(err.message || 'Error al rechazar el ajuste');
            }
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <DollarSign className="w-8 h-8 text-purple-600" />
                    Ajustes Manuales
                </h1>
                <button
                    onClick={() => setShowModal(true)}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
                >
                    <Plus className="w-5 h-5" />
                    Nuevo Ajuste
                </button>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Fecha</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Cuenta</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Tipo</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Monto</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Estado</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {ajustes.map((ajuste) => (
                            <tr key={ajuste.id}>
                                <td className="px-4 py-3">{ajuste.fecha}</td>
                                <td className="px-4 py-3">
                                    <span className="font-mono text-xs">{ajuste.cuentaCode}</span>
                                    <br />
                                    {ajuste.cuentaName}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-1 rounded-full text-xs ${
                                        ajuste.tipoMovimiento === 'DEBITO' 
                                            ? 'bg-red-100 text-red-800' 
                                            : 'bg-green-100 text-green-800'
                                    }`}>
                                        {ajuste.tipoMovimiento}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    C$ {(ajuste.monto || 0).toLocaleString('es-NI', { minimumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-1 rounded-full text-xs ${
                                        ajuste.estado === 'aprobado' 
                                            ? 'bg-green-100 text-green-800' 
                                            : ajuste.estado === 'rechazado'
                                                ? 'bg-red-100 text-red-800'
                                                : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                        {ajuste.estado}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    {ajuste.estado === 'pendiente' && (
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => handleAprobar(ajuste.id)}
                                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                                            >
                                                <CheckCircle className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => handleRechazar(ajuste.id)}
                                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                                            >
                                                <XCircle className="w-5 h-5" />
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {ajustes.length === 0 && (
                    <p className="text-center text-gray-500 py-8">No hay ajustes registrados</p>
                )}
            </div>

            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
                        <h2 className="text-xl font-bold mb-4">Nuevo Ajuste Manual</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                                <input
                                    type="date"
                                    value={formData.fecha}
                                    onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Cuenta</label>
                                <select
                                    value={formData.cuentaId}
                                    onChange={(e) => setFormData({ ...formData, cuentaId: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg"
                                    required
                                >
                                    <option value="">Seleccione una cuenta...</option>
                                    {accounts.map(a => (
                                        <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Movimiento</label>
                                <select
                                    value={formData.tipoMovimiento}
                                    onChange={(e) => setFormData({ ...formData, tipoMovimiento: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg"
                                >
                                    <option value="DEBITO">Débito</option>
                                    <option value="CREDITO">Crédito</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={formData.monto}
                                    onChange={(e) => setFormData({ ...formData, monto: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                                <input
                                    type="text"
                                    value={formData.descripcion}
                                    onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Justificación</label>
                                <textarea
                                    value={formData.justificacion}
                                    onChange={(e) => setFormData({ ...formData, justificacion: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg"
                                    rows="3"
                                    required
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                                >
                                    Crear Ajuste
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AjustesManuales;
