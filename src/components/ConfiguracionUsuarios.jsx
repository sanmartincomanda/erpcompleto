// src/components/ConfiguracionUsuarios.jsx
// Gestión de usuarios y roles del sistema

import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { 
    collection, query, onSnapshot, doc, updateDoc, 
    Timestamp, getDoc, setDoc, deleteDoc 
} from 'firebase/firestore';
import { useAuth, ROLES } from '../context/AuthContext';
import { 
    Users, UserPlus, UserX, UserCheck, Shield, 
    Edit2, Save, X, Search, Filter, RefreshCw,
    CheckCircle, AlertCircle, Mail, Calendar
} from 'lucide-react';

const ROLES_INFO = {
    [ROLES.ADMIN]: {
        label: 'Administrador',
        description: 'Acceso total al sistema',
        color: 'bg-red-100 text-red-700',
        icon: Shield
    },
    [ROLES.CONTADOR]: {
        label: 'Contador',
        description: 'Contabilidad, reportes y pagos',
        color: 'bg-blue-100 text-blue-700',
        icon: CheckCircle
    },
    [ROLES.CAJERO]: {
        label: 'Cajero',
        description: 'Cierre de caja y depósitos',
        color: 'bg-green-100 text-green-700',
        icon: Users
    },
    [ROLES.CONSULTA]: {
        label: 'Consulta',
        description: 'Solo lectura de reportes',
        color: 'bg-gray-100 text-gray-700',
        icon: UserCheck
    }
};

const ConfiguracionUsuarios = () => {
    const { user, userRole, actualizarRol, activarUsuario, ROLES: AuthROLES } = useAuth();
    const [usuarios, setUsuarios] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRole, setFilterRole] = useState('');
    const [editingUser, setEditingUser] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserRole, setNewUserRole] = useState(ROLES.CONSULTA);
    const [success, setSuccess] = useState(null);
    const [error, setError] = useState(null);

    // Cargar usuarios
    useEffect(() => {
        const usuariosRef = collection(db, 'usuarios');
        const q = query(usuariosRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setUsuarios(data);
            setLoading(false);
        }, (err) => {
            console.error('Error cargando usuarios:', err);
            setError('Error al cargar usuarios');
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Filtrar usuarios
    const usuariosFiltrados = usuarios.filter(u => {
        const matchesSearch = !searchTerm || 
            u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.displayName?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesRole = !filterRole || u.role === filterRole;
        return matchesSearch && matchesRole;
    });

    // Actualizar rol de usuario
    const handleUpdateRole = async (uid, nuevoRol) => {
        try {
            await actualizarRol(uid, nuevoRol);
            setSuccess('Rol actualizado correctamente');
            setEditingUser(null);
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err.message);
            setTimeout(() => setError(null), 5000);
        }
    };

    // Activar/desactivar usuario
    const handleToggleActive = async (uid, activo) => {
        try {
            await activarUsuario(uid, activo);
            setSuccess(activo ? 'Usuario activado' : 'Usuario desactivado');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err.message);
            setTimeout(() => setError(null), 5000);
        }
    };

    // Crear nuevo usuario (solo crea el documento, el registro se hace por Firebase Auth)
    const handleCreateUser = async (e) => {
        e.preventDefault();
        if (!newUserEmail) return;

        try {
            const userId = newUserEmail.replace(/[@.]/g, '_');
            await setDoc(doc(db, 'usuarios', userId), {
                email: newUserEmail,
                role: newUserRole,
                isActive: true,
                createdAt: Timestamp.now(),
                createdBy: user?.uid
            });
            setSuccess('Usuario creado. Debe registrarse con este email.');
            setShowModal(false);
            setNewUserEmail('');
            setNewUserRole(ROLES.CONSULTA);
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err.message);
            setTimeout(() => setError(null), 5000);
        }
    };

    if (userRole !== ROLES.ADMIN) {
        return (
            <div className="p-8 text-center">
                <Shield className="w-16 h-16 text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-800 mb-2">Acceso Restringido</h2>
                <p className="text-slate-600">Solo los administradores pueden gestionar usuarios.</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <Users className="w-7 h-7" />
                    Gestión de Usuarios
                </h1>
                <p className="text-slate-600">Administre los usuarios y roles del sistema</p>
            </div>

            {/* Alertas */}
            {success && (
                <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
                    <CheckCircle className="w-5 h-5" />
                    {success}
                </div>
            )}
            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                </div>
            )}

            {/* Acciones y Filtros */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
                <div className="flex flex-wrap gap-4 items-center justify-between">
                    <div className="flex gap-4 items-center">
                        <div className="relative">
                            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Buscar usuario..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 w-64"
                            />
                        </div>
                        <select
                            value={filterRole}
                            onChange={(e) => setFilterRole(e.target.value)}
                            className="px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Todos los roles</option>
                            {Object.entries(ROLES_INFO).map(([key, info]) => (
                                <option key={key} value={key}>{info.label}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                    >
                        <UserPlus className="w-5 h-5" />
                        Nuevo Usuario
                    </button>
                </div>
            </div>

            {/* Tabla de Usuarios */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center">
                        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-slate-400" />
                        <p className="mt-2 text-slate-500">Cargando usuarios...</p>
                    </div>
                ) : usuariosFiltrados.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                        No se encontraron usuarios
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Usuario</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Rol</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Estado</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Creado</th>
                                <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {usuariosFiltrados.map((u) => {
                                const rolInfo = ROLES_INFO[u.role] || ROLES_INFO[ROLES.CONSULTA];
                                const RolIcon = rolInfo.icon;
                                
                                return (
                                    <tr key={u.id} className="hover:bg-slate-50">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                                                    <Mail className="w-5 h-5 text-slate-500" />
                                                </div>
                                                <div>
                                                    <p className="font-medium text-slate-800">{u.email}</p>
                                                    <p className="text-sm text-slate-500">{u.displayName || 'Sin nombre'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {editingUser === u.id ? (
                                                <select
                                                    value={u.role}
                                                    onChange={(e) => handleUpdateRole(u.id, e.target.value)}
                                                    className="px-3 py-1 border border-slate-300 rounded text-sm"
                                                    autoFocus
                                                >
                                                    {Object.entries(ROLES_INFO).map(([key, info]) => (
                                                        <option key={key} value={key}>{info.label}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${rolInfo.color}`}>
                                                    <RolIcon className="w-4 h-4" />
                                                    {rolInfo.label}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
                                                u.isActive !== false 
                                                    ? 'bg-green-100 text-green-700' 
                                                    : 'bg-red-100 text-red-700'
                                            }`}>
                                                {u.isActive !== false ? (
                                                    <><UserCheck className="w-4 h-4" /> Activo</>
                                                ) : (
                                                    <><UserX className="w-4 h-4" /> Inactivo</>
                                                )}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-slate-600">
                                            {u.createdAt?.toDate ? 
                                                u.createdAt.toDate().toLocaleDateString() : 
                                                'N/A'
                                            }
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-center gap-2">
                                                {editingUser === u.id ? (
                                                    <button
                                                        onClick={() => setEditingUser(null)}
                                                        className="p-2 text-slate-600 hover:bg-slate-100 rounded"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => setEditingUser(u.id)}
                                                        className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                                                        title="Editar rol"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleToggleActive(u.id, u.isActive === false)}
                                                    className={`p-2 rounded ${
                                                        u.isActive !== false 
                                                            ? 'text-red-600 hover:bg-red-50' 
                                                            : 'text-green-600 hover:bg-green-50'
                                                    }`}
                                                    title={u.isActive !== false ? 'Desactivar' : 'Activar'}
                                                >
                                                    {u.isActive !== false ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Modal: Nuevo Usuario */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <UserPlus className="w-6 h-6" />
                            Nuevo Usuario
                        </h2>
                        <form onSubmit={handleCreateUser}>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Correo Electrónico
                                </label>
                                <input
                                    type="email"
                                    value={newUserEmail}
                                    onChange={(e) => setNewUserEmail(e.target.value)}
                                    placeholder="usuario@empresa.com"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Rol
                                </label>
                                <select
                                    value={newUserRole}
                                    onChange={(e) => setNewUserRole(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                    {Object.entries(ROLES_INFO).map(([key, info]) => (
                                        <option key={key} value={key}>{info.label} - {info.description}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    Crear Usuario
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Info de Roles */}
            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(ROLES_INFO).map(([key, info]) => {
                    const Icon = info.icon;
                    return (
                        <div key={key} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium mb-2 ${info.color}`}>
                                <Icon className="w-4 h-4" />
                                {info.label}
                            </div>
                            <p className="text-sm text-slate-600">{info.description}</p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ConfiguracionUsuarios;
