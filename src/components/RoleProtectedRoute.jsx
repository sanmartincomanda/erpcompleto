// src/components/RoleProtectedRoute.jsx
// Protección de rutas basada en roles de usuario

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AlertCircle, Lock } from 'lucide-react';

const RoleProtectedRoute = ({ 
    children, 
    requiredRole = null,
    requiredPermiso = null,
    modulo = null
}) => {
    const { user, userRole, loading, tienePermiso, puedeAccederModulo } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-slate-600">Verificando permisos...</p>
                </div>
            </div>
        );
    }

    // Si no hay usuario, redirigir a login
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    // Si se requiere un rol específico
    if (requiredRole && userRole !== requiredRole) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Lock className="w-8 h-8 text-red-600" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">
                        Acceso Restringido
                    </h2>
                    <p className="text-slate-600 mb-4">
                        No tiene permisos para acceder a esta sección.
                    </p>
                    <p className="text-sm text-slate-500 mb-6">
                        Su rol actual: <span className="font-medium capitalize">{userRole}</span>
                    </p>
                    <a 
                        href="/inicio" 
                        className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Volver al Inicio
                    </a>
                </div>
            </div>
        );
    }

    // Si se requiere un permiso específico
    if (requiredPermiso && !tienePermiso(requiredPermiso)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="w-8 h-8 text-amber-600" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">
                        Permiso Denegado
                    </h2>
                    <p className="text-slate-600 mb-4">
                        No tiene el permiso necesario para realizar esta acción.
                    </p>
                    <a 
                        href="/inicio" 
                        className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Volver al Inicio
                    </a>
                </div>
            </div>
        );
    }

    // Si se requiere acceso a un módulo
    // NOTA: Si el usuario no tiene rol asignado (null), permitir acceso por defecto
    if (modulo && userRole && !puedeAccederModulo(modulo)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="w-8 h-8 text-amber-600" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">
                        Módulo No Disponible
                    </h2>
                    <p className="text-slate-600 mb-4">
                        Su rol no tiene acceso a este módulo del sistema.
                    </p>
                    <p className="text-sm text-slate-500 mb-2">
                        Módulo: <span className="font-medium">{modulo}</span>
                    </p>
                    <p className="text-sm text-slate-500 mb-6">
                        Su rol actual: <span className="font-medium capitalize">{userRole || 'No asignado'}</span>
                    </p>
                    <div className="flex gap-3 justify-center">
                        <a 
                            href="/inicio" 
                            className="px-6 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300"
                        >
                            Volver al Inicio
                        </a>
                        <a 
                            href="/configuracion-usuarios" 
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            Configurar Roles
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    return children;
};

export default RoleProtectedRoute;
