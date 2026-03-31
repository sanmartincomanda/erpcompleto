// src/context/AuthContext.jsx
// CORREGIDO: Sistema de roles de usuario implementado

import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { auth, db } from '../firebase';
import { 
    onAuthStateChanged, 
    signInWithEmailAndPassword, 
    signOut, 
    createUserWithEmailAndPassword 
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, Timestamp, collection, getDocs } from 'firebase/firestore';

// Definición de roles
export const ROLES = {
    ADMIN: 'admin',           // Acceso total
    CONTADOR: 'contador',     // Contabilidad, reportes
    CAJERO: 'cajero',         // Cierre de caja, depósitos
    CONSULTA: 'consulta'      // Solo lectura
};

// Permisos por rol
export const PERMISOS = {
    [ROLES.ADMIN]: {
        puedeCrear: true,
        puedeEditar: true,
        puedeEliminar: true,
        puedeVerTodo: true,
        puedeCerrarCaja: true,
        puedeConfirmarDepositos: true,
        puedePagarProveedores: true,
        puedeConfigurar: true,
        puedeVerReportes: true,
        modulos: ['*'] // Todos los módulos
    },
    [ROLES.CONTADOR]: {
        puedeCrear: true,
        puedeEditar: true,
        puedeEliminar: false,
        puedeVerTodo: true,
        puedeCerrarCaja: true,
        puedeConfirmarDepositos: true,
        puedePagarProveedores: true,
        puedeConfigurar: false,
        puedeVerReportes: true,
        modulos: [
            'plan-cuentas',
            'movimientos-contables',
            'cuentas-pagar',
            'proveedores',
            'reportes',
            'dashboard-financiero',
            'depositos-transito',
            'confirmar-deposito',
            'cierre-caja-erp'
        ]
    },
    [ROLES.CAJERO]: {
        puedeCrear: true,
        puedeEditar: true,
        puedeEliminar: false,
        puedeVerTodo: false,
        puedeCerrarCaja: true,
        puedeConfirmarDepositos: false,
        puedePagarProveedores: false,
        puedeConfigurar: false,
        puedeVerReportes: false,
        modulos: [
            'cierre-caja-erp',
            'depositos-transito',
            'dataentry'
        ]
    },
    [ROLES.CONSULTA]: {
        puedeCrear: false,
        puedeEditar: false,
        puedeEliminar: false,
        puedeVerTodo: true,
        puedeCerrarCaja: false,
        puedeConfirmarDepositos: false,
        puedePagarProveedores: false,
        puedeConfigurar: false,
        puedeVerReportes: true,
        modulos: [
            'plan-cuentas',
            'movimientos-contables',
            'reportes',
            'dashboard-financiero',
            'cuentas-pagar',
            'proveedores'
        ]
    }
};

const AuthContext = createContext();

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth debe usarse dentro de AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [userRole, setUserRole] = useState(null);
    const [permisos, setPermisos] = useState(null);
    const [loading, setLoading] = useState(true);

    // Cargar datos del usuario desde Firestore
    const loadUserData = useCallback(async (uid, userEmail = null) => {
        try {
            const userDoc = await getDoc(doc(db, 'usuarios', uid));
            if (userDoc.exists()) {
                const data = userDoc.data();
                setUserData(data);
                setUserRole(data.role || ROLES.CONSULTA);
                setPermisos(PERMISOS[data.role || ROLES.CONSULTA]);
                return data;
            } else {
                // Detectar si es usuario admin (por email o primer usuario)
                const isAdminEmail = userEmail && (
                    userEmail.includes('admin') || 
                    userEmail === 'admin@empresa.com'
                );
                
                // Verificar si es el primer usuario en el sistema
                const usuariosRef = collection(db, 'usuarios');
                const usuariosSnapshot = await getDocs(usuariosRef);
                const isFirstUser = usuariosSnapshot.empty;
                
                // Asignar rol: admin si es primer usuario o email de admin, sino cajero
                const defaultRole = (isAdminEmail || isFirstUser) ? ROLES.ADMIN : ROLES.CAJERO;
                
                const defaultData = {
                    uid: uid,
                    email: userEmail,
                    role: defaultRole,
                    isActive: true,
                    createdAt: Timestamp.now()
                };
                await setDoc(doc(db, 'usuarios', uid), defaultData);
                setUserData(defaultData);
                setUserRole(defaultRole);
                setPermisos(PERMISOS[defaultRole]);
                
                console.log(`Nuevo usuario creado con rol: ${defaultRole}`);
                return defaultData;
            }
        } catch (err) {
            console.error('Error cargando datos de usuario:', err);
            setUserRole(ROLES.CAJERO);
            setPermisos(PERMISOS[ROLES.CAJERO]);
            return null;
        }
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setUser(firebaseUser);
            if (firebaseUser) {
                await loadUserData(firebaseUser.uid, firebaseUser.email);
            } else {
                setUserData(null);
                setUserRole(null);
                setPermisos(null);
            }
            setLoading(false);
        });
        return unsubscribe;
    }, [loadUserData]);

    const login = async (email, password) => {
        const result = await signInWithEmailAndPassword(auth, email, password);
        // Verificar si el usuario está activo
        const userDoc = await getDoc(doc(db, 'usuarios', result.user.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.isActive === false) {
                await signOut(auth);
                throw new Error('Usuario desactivado. Contacte al administrador.');
            }
        }
        return result;
    };

    const register = async (email, password, role = ROLES.CONSULTA, userInfo = {}) => {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        // Crear documento de usuario en Firestore
        await setDoc(doc(db, 'usuarios', result.user.uid), {
            uid: result.user.uid,
            email,
            role,
            isActive: true,
            ...userInfo,
            createdAt: Timestamp.now()
        });
        return result;
    };

    const logout = async () => {
        return signOut(auth);
    };

    // Funciones de utilidad para permisos
    const tienePermiso = useCallback((permiso) => {
        if (!permisos) return false;
        if (userRole === ROLES.ADMIN) return true;
        return permisos[permiso] === true;
    }, [permisos, userRole]);

    const puedeAccederModulo = useCallback((modulo) => {
        if (!permisos) return false;
        if (userRole === ROLES.ADMIN) return true;
        return permisos.modulos.includes(modulo) || permisos.modulos.includes('*');
    }, [permisos, userRole]);

    const actualizarRol = useCallback(async (uid, nuevoRol) => {
        if (userRole !== ROLES.ADMIN) {
            throw new Error('Solo el administrador puede cambiar roles');
        }
        await updateDoc(doc(db, 'usuarios', uid), {
            role: nuevoRol,
            updatedAt: Timestamp.now()
        });
    }, [userRole]);

    const activarUsuario = useCallback(async (uid, activo) => {
        if (userRole !== ROLES.ADMIN) {
            throw new Error('Solo el administrador puede activar/desactivar usuarios');
        }
        await updateDoc(doc(db, 'usuarios', uid), {
            isActive: activo,
            updatedAt: Timestamp.now()
        });
    }, [userRole]);

    const value = {
        user,
        userData,
        userRole,
        permisos,
        ROLES,
        login,
        register,
        logout,
        loading,
        tienePermiso,
        puedeAccederModulo,
        actualizarRol,
        activarUsuario
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
