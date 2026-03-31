// src/components/GastosDiarios.jsx
import React, { useState, useEffect } from 'react';
import { collection, addDoc, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';
import { Plus, Trash2, DollarSign, Calendar, FileText, RefreshCw } from 'lucide-react';

const GastosDiarios = () => {
    const { user } = useAuth();
    const [gastos, setGastos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [formData, setFormData] = useState({
        fecha: format(new Date(), 'yyyy-MM-dd'),
        concepto: '',
        monto: '',
        categoria: 'otros'
    });

    const categorias = [
        { id: 'combustible', name: 'Combustible' },
        { id: 'alimentacion', name: 'Alimentación' },
        { id: 'transporte', name: 'Transporte' },
        { id: 'materiales', name: 'Materiales' },
        { id: 'servicios', name: 'Servicios' },
        { id: 'otros', name: 'Otros' }
    ];

    useEffect(() => {
        const gastosRef = collection(db, 'gastosDiarios');
        const q = query(gastosRef, orderBy('fecha', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setGastos(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await addDoc(collection(db, 'gastosDiarios'), {
                fecha: formData.fecha,
                concepto: formData.concepto,
                monto: Number(formData.monto),
                categoria: formData.categoria,
                createdBy: user?.email,
                createdAt: Timestamp.now()
            });
            setFormData({
                fecha: format(new Date(), 'yyyy-MM-dd'),
                concepto: '',
                monto: '',
                categoria: 'otros'
            });
        } catch (err) {
            console.error('Error guardando gasto:', err);
        }
    };

    const totalGastos = gastos.reduce((sum, g) => sum + (g.monto || 0), 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <DollarSign className="w-8 h-8 text-red-600" />
                Gastos Diarios
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Formulario */}
                <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-lg font-semibold mb-4">Registrar Gasto</h2>
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
                            <label className="block text-sm font-medium text-gray-700 mb-1">Concepto</label>
                            <input
                                type="text"
                                value={formData.concepto}
                                onChange={(e) => setFormData({ ...formData, concepto: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="Descripción del gasto"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                            <select
                                value={formData.categoria}
                                onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                            >
                                {categorias.map(cat => (
                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
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
                                placeholder="0.00"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            className="w-full py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center justify-center gap-2"
                        >
                            <Plus className="w-5 h-5" />
                            Registrar Gasto
                        </button>
                    </form>
                </div>

                {/* Lista */}
                <div className="bg-white rounded-lg shadow p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-semibold">Últimos Gastos</h2>
                        <div className="text-right">
                            <p className="text-sm text-gray-500">Total</p>
                            <p className="text-xl font-bold text-red-600">
                                C$ {totalGastos.toLocaleString('es-NI', { minimumFractionDigits: 2 })}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2 max-h-96 overflow-auto">
                        {gastos.map((gasto) => (
                            <div key={gasto.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                                <div>
                                    <p className="font-medium">{gasto.concepto}</p>
                                    <p className="text-sm text-gray-500">{gasto.fecha} - {categorias.find(c => c.id === gasto.categoria)?.name}</p>
                                </div>
                                <p className="font-bold text-red-600">
                                    C$ {(gasto.monto || 0).toLocaleString('es-NI', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                        ))}
                        {gastos.length === 0 && (
                            <p className="text-center text-gray-500 py-4">No hay gastos registrados</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GastosDiarios;
