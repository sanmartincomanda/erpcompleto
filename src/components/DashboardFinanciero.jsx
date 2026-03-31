// src/components/DashboardFinanciero.jsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { 
    TrendingUp, 
    TrendingDown, 
    DollarSign, 
    Building2, 
    Wallet,
    CreditCard,
    RefreshCw,
    BarChart3
} from 'lucide-react';

const DashboardFinanciero = () => {
    const [stats, setStats] = useState({
        totalVentas: 0,
        totalGastos: 0,
        balance: 0,
        cuentasPendientes: 0
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Cargar estadísticas
        const loadStats = async () => {
            try {
                // Ventas del mes
                const ventasRef = collection(db, 'ventasDirectas');
                const unsubscribeVentas = onSnapshot(ventasRef, (snapshot) => {
                    const total = snapshot.docs.reduce((sum, doc) => sum + (doc.data().monto || 0), 0);
                    setStats(prev => ({ ...prev, totalVentas: total }));
                });

                // Gastos del mes
                const gastosRef = collection(db, 'gastosDirectos');
                const unsubscribeGastos = onSnapshot(gastosRef, (snapshot) => {
                    const total = snapshot.docs.reduce((sum, doc) => sum + (doc.data().monto || 0), 0);
                    setStats(prev => ({ ...prev, totalGastos: total }));
                });

                // Cuentas por pagar pendientes
                const facturasRef = collection(db, 'facturasCuentaPagar');
                const q = query(facturasRef, where('estado', 'in', ['pendiente', 'parcial']));
                const unsubscribeFacturas = onSnapshot(q, (snapshot) => {
                    setStats(prev => ({ ...prev, cuentasPendientes: snapshot.size }));
                });

                setLoading(false);

                return () => {
                    unsubscribeVentas();
                    unsubscribeGastos();
                    unsubscribeFacturas();
                };
            } catch (err) {
                console.error('Error cargando estadísticas:', err);
                setLoading(false);
            }
        };

        loadStats();
    }, []);

    const formatCurrency = (amount) => {
        return `C$ ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    const kpiCards = [
        {
            title: 'Ventas del Mes',
            value: formatCurrency(stats.totalVentas),
            icon: TrendingUp,
            color: 'bg-green-500',
            trend: '+0%'
        },
        {
            title: 'Gastos del Mes',
            value: formatCurrency(stats.totalGastos),
            icon: TrendingDown,
            color: 'bg-red-500',
            trend: '+0%'
        },
        {
            title: 'Balance',
            value: formatCurrency(stats.totalVentas - stats.totalGastos),
            icon: DollarSign,
            color: 'bg-blue-500',
            trend: 'vs mes anterior'
        },
        {
            title: 'Cuentas por Pagar',
            value: stats.cuentasPendientes,
            icon: Building2,
            color: 'bg-orange-500',
            trend: 'pendientes'
        }
    ];

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <BarChart3 className="w-8 h-8 text-blue-600" />
                Dashboard Financiero
            </h1>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {kpiCards.map((card, index) => {
                    const Icon = card.icon;
                    return (
                        <div key={index} className="bg-white rounded-lg shadow p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-500 mb-1">{card.title}</p>
                                    <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                                    <p className="text-xs text-gray-400 mt-1">{card.trend}</p>
                                </div>
                                <div className={`w-12 h-12 ${card.color} rounded-lg flex items-center justify-center`}>
                                    <Icon className="w-6 h-6 text-white" />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Secciones adicionales */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-lg font-semibold mb-4">Resumen de Cuentas</h2>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                            <div className="flex items-center gap-2">
                                <Wallet className="w-5 h-5 text-blue-600" />
                                <span>Efectivo en Caja</span>
                            </div>
                            <span className="font-bold">C$ 0.00</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                            <div className="flex items-center gap-2">
                                <CreditCard className="w-5 h-5 text-green-600" />
                                <span>Bancos</span>
                            </div>
                            <span className="font-bold">C$ 0.00</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                            <div className="flex items-center gap-2">
                                <Building2 className="w-5 h-5 text-orange-600" />
                                <span>Proveedores</span>
                            </div>
                            <span className="font-bold">C$ 0.00</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-lg font-semibold mb-4">Accesos Rápidos</h2>
                    <div className="grid grid-cols-2 gap-3">
                        <a href="/dataentry" className="p-4 bg-green-50 rounded-lg hover:bg-green-100 text-center">
                            <TrendingUp className="w-6 h-6 text-green-600 mx-auto mb-2" />
                            <span className="text-sm font-medium">Registrar Venta</span>
                        </a>
                        <a href="/dataentry" className="p-4 bg-red-50 rounded-lg hover:bg-red-100 text-center">
                            <TrendingDown className="w-6 h-6 text-red-600 mx-auto mb-2" />
                            <span className="text-sm font-medium">Registrar Gasto</span>
                        </a>
                        <a href="/depositos-transito" className="p-4 bg-blue-50 rounded-lg hover:bg-blue-100 text-center">
                            <Wallet className="w-6 h-6 text-blue-600 mx-auto mb-2" />
                            <span className="text-sm font-medium">Depósitos</span>
                        </a>
                        <a href="/cuentas-pagar" className="p-4 bg-orange-50 rounded-lg hover:bg-orange-100 text-center">
                            <Building2 className="w-6 h-6 text-orange-600 mx-auto mb-2" />
                            <span className="text-sm font-medium">Cuentas por Pagar</span>
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DashboardFinanciero;
