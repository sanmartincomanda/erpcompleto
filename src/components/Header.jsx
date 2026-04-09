// src/components/Header.jsx - Header ERP Profesional tipo SAP
import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
    Menu, X, ChevronDown, ChevronRight, User, LogOut, 
    Home, BookOpen, FileText, DollarSign, Building2, 
    TrendingUp, TrendingDown, Briefcase, Settings, 
    Landmark, Wallet, CreditCard, ShoppingCart,
    BarChart3, ArrowRightLeft, PiggyBank, Calculator,
    Store, Package
} from 'lucide-react';

const Header = ({ sidebarOpen: externalSidebarOpen, setSidebarOpen: externalSetSidebarOpen }) => {
    const { user, logout, userRole } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [internalSidebarOpen, setInternalSidebarOpen] = useState(true);
    const [expandedMenus, setExpandedMenus] = useState({});
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    
    // Usar props externas si existen, sino usar estado interno
    const sidebarOpen = externalSidebarOpen !== undefined ? externalSidebarOpen : internalSidebarOpen;
    const setSidebarOpen = externalSetSidebarOpen || setInternalSidebarOpen;
    
    // Labels de roles
    const roleLabels = {
        admin: 'Administrador',
        contador: 'Contador',
        cajero: 'Cajero',
        consulta: 'Consulta'
    };

    const menuItems = [
        { path: '/inicio', label: 'Inicio', icon: Home },
        {
            key: 'contabilidad',
            label: 'Contabilidad',
            icon: BookOpen,
            items: [
                { path: '/plan-cuentas', label: 'Plan de Cuentas', icon: BookOpen },
                { path: '/activos-fijos', label: 'Activos Fijos', icon: Package },
                { path: '/inventario-fisico', label: 'Inventario Fisico', icon: Store },
                { path: '/movimientos', label: 'Movimientos Contables', icon: FileText },
                { path: '/asientos', label: 'Asientos Contables', icon: Calculator },
                { path: '/ajustes-manuales', label: 'Ajustes Manuales', icon: TrendingUp },
            ]
        },
        {
            key: 'operaciones',
            label: 'Operaciones',
            icon: DollarSign,
            items: [
                { path: '/data-entry', label: 'Data Entry', icon: FileText },
                { path: '/cierre-caja', label: 'Cierre de Caja', icon: Wallet },
                { path: '/depositos-transito', label: 'Depósitos en Tránsito', icon: ArrowRightLeft },
                { path: '/confirmacion-deposito', label: 'Confirmar Depósito', icon: Landmark },
            ]
        },
        {
            key: 'proveedores',
            label: 'Proveedores',
            icon: Building2,
            items: [
                { path: '/compras', label: 'Compras', icon: ShoppingCart },
                { path: '/cuentas-pagar', label: 'Cuentas por Pagar', icon: Wallet },
                { path: '/proveedores', label: 'Administrar Proveedores', icon: Building2 },
            ]
        },
        {
            key: 'reportes',
            label: 'Reportes',
            icon: BarChart3,
            items: [
                { path: '/reportes', label: 'Estado de Resultados', icon: BarChart3 },
            ]
        },
        { path: '/configuracion', label: 'Configuración', icon: Settings },
    ];

    const toggleMenu = (key) => {
        setExpandedMenus(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const isActive = (path) => location.pathname === path;
    const isMenuActive = (items) => items?.some(item => location.pathname === item.path);

    return (
        <>
            {/* Top Bar */}
            <header className="fixed top-0 left-0 right-0 h-14 bg-slate-900 text-white z-50 flex items-center justify-between px-4 shadow-lg">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                    <Link to="/inicio" className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                            <Briefcase className="w-5 h-5" />
                        </div>
                        <div className="hidden sm:block">
                            <h1 className="font-bold text-sm leading-tight">ERP Carnessanmartin</h1>
                            <p className="text-xs text-slate-400">Granada</p>
                        </div>
                    </Link>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative">
                        <button
                            onClick={() => setUserMenuOpen(!userMenuOpen)}
                            className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700 rounded-lg transition-colors"
                        >
                            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                                <User className="w-4 h-4" />
                            </div>
                            <span className="hidden md:block text-sm">{user?.email || 'Usuario'}</span>
                            <ChevronDown className="w-4 h-4" />
                        </button>

                        {userMenuOpen && (
                            <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-xl border border-slate-200 py-2 z-50">
                                <div className="px-4 py-2 border-b border-slate-100">
                                    <p className="text-sm font-medium text-slate-900">{user?.email}</p>
                                    <p className="text-xs text-slate-500">
                                        {roleLabels[userRole] || 'Usuario'}
                                    </p>
                                </div>
                                <Link
                                    to="/configuracion-usuarios"
                                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                    onClick={() => setUserMenuOpen(false)}
                                >
                                    <Settings className="w-4 h-4" />
                                    Configuración
                                </Link>
                                <button
                                    onClick={handleLogout}
                                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                >
                                    <LogOut className="w-4 h-4" />
                                    Cerrar Sesión
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Sidebar */}
            <aside 
                className={`fixed top-14 left-0 bottom-0 bg-slate-800 text-slate-300 transition-all duration-300 z-40 ${
                    sidebarOpen ? 'w-64' : 'w-16'
                }`}
            >
                <nav className="p-2 space-y-1 overflow-y-auto h-full pb-20">
                    {menuItems.map((item) => {
                        const Icon = item.icon;
                        
                        if (item.items) {
                            const isExpanded = expandedMenus[item.key];
                            const hasActiveChild = isMenuActive(item.items);
                            
                            return (
                                <div key={item.key}>
                                    <button
                                        onClick={() => sidebarOpen && toggleMenu(item.key)}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                                            hasActiveChild 
                                                ? 'bg-blue-600 text-white' 
                                                : 'hover:bg-slate-700'
                                        }`}
                                    >
                                        <Icon className="w-5 h-5 flex-shrink-0" />
                                        {sidebarOpen && (
                                            <>
                                                <span className="flex-1 text-left text-sm">{item.label}</span>
                                                {isExpanded ? (
                                                    <ChevronDown className="w-4 h-4" />
                                                ) : (
                                                    <ChevronRight className="w-4 h-4" />
                                                )}
                                            </>
                                        )}
                                    </button>
                                    
                                    {sidebarOpen && isExpanded && (
                                        <div className="ml-4 mt-1 space-y-1 border-l-2 border-slate-600 pl-3">
                                            {item.items.map((subItem) => {
                                                const SubIcon = subItem.icon;
                                                return (
                                                    <Link
                                                        key={subItem.path}
                                                        to={subItem.path}
                                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                                                            isActive(subItem.path)
                                                                ? 'bg-blue-500 text-white'
                                                                : 'hover:bg-slate-700'
                                                        }`}
                                                    >
                                                        <SubIcon className="w-4 h-4" />
                                                        {subItem.label}
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        }
                        
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                                    isActive(item.path)
                                        ? 'bg-blue-600 text-white'
                                        : 'hover:bg-slate-700'
                                }`}
                                title={!sidebarOpen ? item.label : ''}
                            >
                                <Icon className="w-5 h-5 flex-shrink-0" />
                                {sidebarOpen && <span className="text-sm">{item.label}</span>}
                            </Link>
                        );
                    })}
                </nav>
            </aside>

            {/* Click outside to close user menu */}
            {userMenuOpen && (
                <div 
                    className="fixed inset-0 z-30" 
                    onClick={() => setUserMenuOpen(false)}
                />
            )}
        </>
    );
};

export default Header;
