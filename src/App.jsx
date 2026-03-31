// src/App.jsx
// ERP Distribuidoras SR - Aplicación Principal con React Router
// CORREGIDO: Integración con hooks y servicios unificados

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { BranchesProvider } from './hooks/useBranches.jsx';
import { AccountingProvider } from './hooks/useAccounting.jsx';

// Componentes de Layout
import Header from './components/Header';
import PrivateRoute from './components/PrivateRoute';
import RoleProtectedRoute from './components/RoleProtectedRoute';

// Páginas de Autenticación
import Login from './components/Login';

// INICIO - Dashboard con accesos rápidos
import Inicio from './components/Inicio';

// Dashboard Financiero (original con KPIs)
import DashboardFinanciero from './components/DashboardFinanciero';

// Entrada de Datos
import DataEntry from './components/DataEntry';

// Módulos Financieros - Contabilidad
import ChartOfAccounts from './components/ChartOfAccounts';
import GastosDiarios from './components/GastosDiarios';

// NUEVOS MÓDULOS: Ventas y Gastos
import Ventas from './components/Ventas';
import Gastos from './components/Gastos';

// Depósitos Bancarios
import DepositosTransito from './components/DepositosTransito';
import ConfirmacionDeposito from './components/ConfirmacionDeposito';

// Proveedores - Cuentas por Pagar (original con ERP)
import AccountsPayable from './components/AccountsPayable';
import ComprasGastos from './components/ComprasGastos';
import Compras from './components/Compras';
import Proveedores from './components/Proveedores';

// Reportes (original)
import Reports from './components/Reports';

// Configuración
import Configuracion from './components/Configuracion';
import ConfiguracionUsuarios from './components/ConfiguracionUsuarios';
import ConfiguracionSucursales from './components/ConfiguracionSucursales';

// Componentes ERP (subcarpeta)
import AjustesManuales from './components/ERP/AjustesManuales';
import CierreCajaERP from './components/ERP/CierreCajaERP';
import MovimientosContables from './components/ERP/MovimientosContables';

// Componente de Layout con Header para rutas protegidas
const PrivateLayout = ({ children }) => {
    const [sidebarOpen, setSidebarOpen] = React.useState(true);
    return (
        <>
            <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
            <main 
                className={`pt-14 min-h-screen bg-slate-50 transition-all duration-300 ${
                    sidebarOpen ? 'ml-64' : 'ml-16'
                }`}
            >
                {children}
            </main>
        </>
    );
};

// Wrapper para PrivateRoute que incluye el Header
const PrivatePage = ({ element, modulo = null }) => (
    <PrivateRoute 
        element={
            <RoleProtectedRoute modulo={modulo}>
                <PrivateLayout>
                    {element}
                </PrivateLayout>
            </RoleProtectedRoute>
        } 
    />
);

function App() {
    return (
        <AuthProvider>
            <BranchesProvider>
            <AccountingProvider>
            <Router>
                <Routes>
                    {/* Ruta pública - Login */}
                    <Route path="/login" element={<Login />} />
                    
                    {/* Ruta por defecto - Redirige a login */}
                    <Route path="/" element={<Navigate to="/login" replace />} />
                    
                    {/* ============================================ */}
                    {/* RUTAS PROTEGIDAS - Requieren autenticación */}
                    {/* ============================================ */}
                    
                    {/* INICIO - Dashboard con accesos rápidos */}
                    <Route 
                        path="/inicio" 
                        element={<PrivatePage element={<Inicio />} />} 
                    />
                    
                    {/* Dashboard Financiero (original con KPIs) */}
                    <Route 
                        path="/dashboard-financiero" 
                        element={<PrivatePage element={<DashboardFinanciero />} />} 
                    />
                    
                    {/* Entrada de Datos / Ingreso Manual */}
                    <Route 
                        path="/ingresar" 
                        element={<PrivatePage element={<DataEntry />} />} 
                    />
                    <Route 
                        path="/dataentry" 
                        element={<PrivatePage element={<DataEntry />} />} 
                    />
                    <Route 
                        path="/data-entry" 
                        element={<PrivatePage element={<DataEntry />} />} 
                    />
                    <Route 
                        path="/ingreso-manual" 
                        element={<PrivatePage element={<DataEntry />} />} 
                    />
                    <Route 
                        path="/ingresos-egresos" 
                        element={<PrivatePage element={<DataEntry />} />} 
                    />
                    
                    {/* NUEVO: Módulo de Ventas */}
                    <Route 
                        path="/ventas" 
                        element={<PrivatePage element={<Ventas />} />} 
                    />
                    
                    {/* NUEVO: Módulo de Gastos */}
                    <Route 
                        path="/gastos" 
                        element={<PrivatePage element={<Gastos />} />} 
                    />
                    
                    {/* Plan de Cuentas */}
                    <Route 
                        path="/plan-cuentas" 
                        element={<PrivatePage element={<ChartOfAccounts />} modulo="plan-cuentas" />} 
                    />
                    
                    {/* Cierre de Caja ERP */}
                    <Route 
                        path="/cierre-caja-erp" 
                        element={<PrivatePage element={<CierreCajaERP />} modulo="cierre-caja-erp" />} 
                    />
                    
                    {/* Movimientos Contables */}
                    <Route 
                        path="/movimientos-contables" 
                        element={<PrivatePage element={<MovimientosContables />} modulo="movimientos-contables" />} 
                    />
                    
                    {/* Ajustes Manuales */}
                    <Route 
                        path="/ajustes-manuales" 
                        element={<PrivatePage element={<AjustesManuales />} modulo="ajustes-manuales" />} 
                    />
                    
                    {/* Gastos Diarios */}
                    <Route 
                        path="/gastos-diarios" 
                        element={<PrivatePage element={<GastosDiarios />} modulo="gastos-diarios" />} 
                    />
                    
                    {/* Depósitos en Tránsito */}
                    <Route 
                        path="/depositos-transito" 
                        element={<PrivatePage element={<DepositosTransito />} modulo="depositos-transito" />} 
                    />
                    
                    {/* Confirmar Depósito */}
                    <Route 
                        path="/confirmar-deposito" 
                        element={<PrivatePage element={<ConfirmacionDeposito />} modulo="confirmar-deposito" />} 
                    />
                    
                    {/* Cuentas por Pagar - ORIGINAL CON ERP */}
                    <Route 
                        path="/cuentas-pagar" 
                        element={<PrivatePage element={<AccountsPayable />} modulo="cuentas-pagar" />} 
                    />
                    
                    {/* Proveedores - Administración */}
                    <Route 
                        path="/proveedores" 
                        element={<PrivatePage element={<Proveedores />} modulo="proveedores" />} 
                    />
                    
                    {/* Cierre de Caja */}
                    <Route 
                        path="/cierre-caja" 
                        element={<PrivatePage element={<CierreCajaERP />} />} 
                    />
                    
                    {/* Movimientos */}
                    <Route 
                        path="/movimientos" 
                        element={<PrivatePage element={<MovimientosContables />} />} 
                    />
                    
                    {/* Confirmación Depósito */}
                    <Route 
                        path="/confirmacion-deposito" 
                        element={<PrivatePage element={<ConfirmacionDeposito />} />} 
                    />
                    
                    {/* Compras/Gastos */}
                    <Route 
                        path="/compras-gastos" 
                        element={<PrivatePage element={<ComprasGastos />} />} 
                    />
                    
                    {/* Compras - Nuevo módulo completo */}
                    <Route 
                        path="/compras" 
                        element={<PrivatePage element={<Compras />} />} 
                    />
                    
                    {/* Reportes - ORIGINAL */}
                    <Route 
                        path="/reportes" 
                        element={<PrivatePage element={<Reports />} modulo="reportes" />} 
                    />
                    
                    {/* Configuración General */}
                    <Route 
                        path="/configuracion" 
                        element={<PrivatePage element={<Configuracion />} modulo="configuracion" />} 
                    />
                    
                    {/* Configuración de Usuarios */}
                    <Route 
                        path="/configuracion-usuarios" 
                        element={<PrivatePage element={<ConfiguracionUsuarios />} modulo="configuracion-usuarios" />} 
                    />
                    
                    {/* Configuración de Sucursales */}
                    <Route 
                        path="/configuracion-sucursales" 
                        element={<PrivatePage element={<ConfiguracionSucursales />} modulo="configuracion-sucursales" />} 
                    />
                    
                    {/* Perfil de Usuario */}
                    <Route 
                        path="/perfil" 
                        element={<PrivatePage element={<div className="p-8 text-center text-slate-500">Perfil en desarrollo</div>} />} 
                    />
                    
                    {/* Ruta 404 - Página no encontrada */}
                    <Route 
                        path="*" 
                        element={
                            <PrivateLayout>
                                <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                                    <div className="text-center">
                                        <h1 className="text-6xl font-black text-slate-300 mb-4">404</h1>
                                        <p className="text-xl text-slate-500 mb-6">Página no encontrada</p>
                                        <a 
                                            href="/inicio" 
                                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors"
                                        >
                                            Volver al Inicio
                                        </a>
                                    </div>
                                </div>
                            </PrivateLayout>
                        } 
                    />
                </Routes>
            </Router>
            </AccountingProvider>
            </BranchesProvider>
        </AuthProvider>
    );
}

export default App;
