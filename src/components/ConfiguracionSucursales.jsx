// src/components/ConfiguracionSucursales.jsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Building2, Plus, Trash2, Edit2, RefreshCw, CheckCircle } from 'lucide-react';
import { getBranchIsActive, normalizeBranch } from '../utils/branches';

const ConfiguracionSucursales = () => {
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        address: '',
        phone: '',
        isActive: true,
        active: true
    });

    useEffect(() => {
        const branchesRef = collection(db, 'branches');
        const unsubscribe = onSnapshot(branchesRef, (snapshot) => {
            const data = snapshot.docs
                .map(doc => normalizeBranch({
                    id: doc.id,
                    ...doc.data()
                }))
                .sort((left, right) => (left.name || '').localeCompare(right.name || ''));
            setBranches(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const isActive = getBranchIsActive(formData);
        const payload = {
            ...formData,
            name: String(formData.name || '').trim(),
            active: isActive,
            isActive
        };
        try {
            if (editing) {
                await updateDoc(doc(db, 'branches', editing), payload);
                setEditing(null);
            } else {
                await addDoc(collection(db, 'branches'), {
                    ...payload,
                    createdAt: new Date()
                });
            }
            setFormData({ name: '', address: '', phone: '', isActive: true, active: true });
        } catch (err) {
            console.error('Error guardando sucursal:', err);
        }
    };

    const handleEdit = (branch) => {
        setEditing(branch.id);
        setFormData({
            name: branch.name || '',
            address: branch.address || '',
            phone: branch.phone || '',
            isActive: getBranchIsActive(branch),
            active: getBranchIsActive(branch)
        });
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Eliminar esta sucursal?')) {
            try {
                await deleteDoc(doc(db, 'branches', id));
            } catch (err) {
                console.error('Error eliminando sucursal:', err);
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
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <Building2 className="w-8 h-8 text-green-600" />
                Configuración de Sucursales
            </h1>

            <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4">
                    {editing ? 'Editar Sucursal' : 'Nueva Sucursal'}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                            <input
                                type="text"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
                        <input
                            type="text"
                            value={formData.address}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={getBranchIsActive(formData)}
                            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked, active: e.target.checked })}
                            className="w-4 h-4"
                        />
                        <label className="text-sm">Activa</label>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
                        >
                            <Plus className="w-5 h-5" />
                            {editing ? 'Guardar Cambios' : 'Agregar Sucursal'}
                        </button>
                        {editing && (
                            <button
                                type="button"
                                onClick={() => { setEditing(null); setFormData({ name: '', address: '', phone: '', isActive: true, active: true }); }}
                                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                                Cancelar
                            </button>
                        )}
                    </div>
                </form>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Nombre</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Dirección</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Teléfono</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Estado</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {branches.map((branch) => (
                            <tr key={branch.id}>
                                <td className="px-4 py-3 font-medium">{branch.name}</td>
                                <td className="px-4 py-3 text-gray-600">{branch.address || '-'}</td>
                                <td className="px-4 py-3">{branch.phone || '-'}</td>
                                <td className="px-4 py-3 text-center">
                                {getBranchIsActive(branch) ? (
                                    <span className="text-green-600 flex items-center justify-center gap-1">
                                            <CheckCircle className="w-4 h-4" /> Activa
                                        </span>
                                    ) : (
                                        <span className="text-gray-400">Inactiva</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <button
                                            onClick={() => handleEdit(branch)}
                                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(branch.id)}
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
                {branches.length === 0 && (
                    <p className="text-center text-gray-500 py-4">No hay sucursales registradas</p>
                )}
            </div>
        </div>
    );
};

export default ConfiguracionSucursales;
