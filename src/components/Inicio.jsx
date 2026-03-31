// src/components/Inicio.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { 
    BookOpen, 
    DollarSign, 
    Calculator,
    ArrowRightLeft,
    CheckCircle,
    Building2,
    BarChart3,
    Settings,
    TrendingUp,
    TrendingDown
} from 'lucide-react';

const Inicio = () => {
    const modules = [
        {
            title: 'Plan de Cuentas',
            description: 'Gestione el catálogo de cuentas contables',
            icon: BookOpen,
            path: '/plan-cuentas',
            color: 'bg-blue-500'
        },
        {
            title: 'Ventas y Gastos',
            description: 'Registre operaciones diarias',
            icon: DollarSign,
            path: '/dataentry',
            color: 'bg-green-500'
        },
        {
            title: 'Cierre de Caja',
            description: 'Procese cierres de caja ERP',
            icon: Calculator,
            path: '/cierre-caja-erp',
            color: 'bg-purple-500'
        },
        {
            title: 'Depósitos',
            description: 'Gestione depósitos en tránsito',
            icon: ArrowRightLeft,
            path: '/depositos-transito',
            color: 'bg-orange-500'
        },
        {
            title: 'Confirmar Depósito',
            description: 'Confirme depósitos bancarios',
            icon: CheckCircle,
            path: '/confirmar-deposito',
            color: 'bg-teal-500'
        },
        {
            title: 'Cuentas por Pagar',
            description: 'Administre facturas de proveedores',
            icon: Building2,
            path: '/cuentas-pagar',
            color: 'bg-red-500'
        },
        {
            title: 'Reportes',
            description: 'Genere reportes financieros',
            icon: BarChart3,
            path: '/reportes',
            color: 'bg-indigo-500'
        },
        {
            title: 'Configuración',
            description: 'Configure el sistema',
            icon: Settings,
            path: '/configuracion',
            color: 'bg-gray-500'
        }
    ];

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Welcome Section */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                    Bienvenido al ERP Carnessanmartin
                </h1>
                <p className="text-gray-600">
                    Sistema de gestión contable y financiera - Sucursal Granada
                </p>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Ventas Hoy</p>
                            <p className="text-2xl font-bold text-gray-900">C$ 0.00</p>
                        </div>
                        <TrendingUp className="w-8 h-8 text-blue-500" />
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Gastos Hoy</p>
                            <p className="text-2xl font-bold text-gray-900">C$ 0.00</p>
                        </div>
                        <TrendingDown className="w-8 h-8 text-red-500" />
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Cajas Activas</p>
                            <p className="text-2xl font-bold text-gray-900">4</p>
                        </div>
                        <Calculator className="w-8 h-8 text-green-500" />
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4 border-l-4 border-orange-500">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Depósitos Pendientes</p>
                            <p className="text-2xl font-bold text-gray-900">0</p>
                        </div>
                        <ArrowRightLeft className="w-8 h-8 text-orange-500" />
                    </div>
                </div>
            </div>

            {/* Modules Grid */}
            <h2 className="text-xl font-bold text-gray-900 mb-4">Módulos del Sistema</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {modules.map((module) => {
                    const Icon = module.icon;
                    return (
                        <Link
                            key={module.path}
                            to={module.path}
                            className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6 group"
                        >
                            <div className={`w-12 h-12 ${module.color} rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                                <Icon className="w-6 h-6 text-white" />
                            </div>
                            <h3 className="font-bold text-gray-900 mb-1">{module.title}</h3>
                            <p className="text-sm text-gray-600">{module.description}</p>
                        </Link>
                    );
                })}
            </div>

            {/* Info Section */}
            <div className="mt-8 bg-blue-50 rounded-lg p-6">
                <h3 className="font-bold text-blue-900 mb-2">¿Necesita ayuda?</h3>
                <p className="text-blue-700 text-sm">
                    Este sistema está integrado con el Plan de Cuentas NIC. Todas las transacciones 
                    generan asientos contables automáticamente. Para soporte técnico, contacte al 
                    administrador del sistema.
                </p>
            </div>
        </div>
    );
};

export default Inicio;
