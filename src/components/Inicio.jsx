// src/components/Inicio.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
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
    TrendingDown,
    Package,
    RefreshCw
} from 'lucide-react';
import { db } from '../firebase';
import { useBranches } from '../hooks/useBranches';

const getDateKey = (dateValue = new Date()) => {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
};

const toNumber = (value) => Number(value || 0);

const toDateKey = (value) => {
    if (!value) return '';

    if (typeof value?.toDate === 'function') {
        return getDateKey(value.toDate());
    }

    if (typeof value?.seconds === 'number') {
        return getDateKey(new Date(value.seconds * 1000));
    }

    if (typeof value === 'string') {
        const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];
    }

    return getDateKey(value);
};

const normalizeCode = (value) => String(value || '').replace(/\./g, '');

const isExpenseFacturaProveedor = (factura = {}) => {
    if (['dataEntry', 'activosFijos'].includes(factura.origenModulo)) {
        return false;
    }

    const accountType = String(factura.cuentaGastoType || '').toUpperCase();
    if (['GASTO', 'COSTO'].includes(accountType)) {
        return true;
    }

    const accountCode = normalizeCode(factura.cuentaGastoCode);
    return accountCode.startsWith('61') || accountCode.startsWith('51');
};

const getClosureSalesAmount = (cierre = {}) =>
    toNumber(
        cierre.totalIngreso ??
        cierre.cuadre?.totalIngreso ??
        cierre.cuadre?.totalIngresoRegistrado
    );

const getClosureCashExpenses = (cierre = {}) => {
    if (cierre.totalGastosCaja !== undefined) {
        return toNumber(cierre.totalGastosCaja);
    }

    return (cierre.gastosCaja || []).reduce(
        (sum, gasto) => sum + toNumber(gasto?.monto),
        0
    );
};

const formatCurrency = (amount) =>
    `C$ ${Number(amount || 0).toLocaleString('es-NI', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;

const Inicio = () => {
    const { branches, loading: loadingBranches } = useBranches();
    const sucursalesActivas = useMemo(
        () => branches.filter((branch) => branch.isActive !== false),
        [branches]
    );
    const [todayKey, setTodayKey] = useState(() => getDateKey());

    const [stats, setStats] = useState({
        ventasDirectasHoy: 0,
        ventasCierresHoy: 0,
        gastosDirectosHoy: 0,
        gastosComprasHoy: 0,
        gastosCxPHoy: 0,
        gastosDiariosHoy: 0,
        gastosCierresHoy: 0,
        depositosPendientes: 0
    });
    const [loadingStats, setLoadingStats] = useState(true);

    useEffect(() => {
        const syncTodayKey = () => setTodayKey(getDateKey());
        const intervalId = window.setInterval(syncTodayKey, 60000);

        return () => window.clearInterval(intervalId);
    }, []);

    useEffect(() => {
        const loadedKeys = new Set();
        const markLoaded = (key) => {
            loadedKeys.add(key);
            if (loadedKeys.size >= 7) {
                setLoadingStats(false);
            }
        };
        const isTodayRecord = (value) => toDateKey(value) === todayKey;

        const unsubVentasDirectas = onSnapshot(
            collection(db, 'ventasDirectas'),
            (snapshot) => {
                const total = snapshot.docs.reduce((sum, docSnapshot) => {
                    const data = docSnapshot.data();
                    return isTodayRecord(data.fecha)
                        ? sum + toNumber(data.monto)
                        : sum;
                }, 0);

                setStats((prev) => ({ ...prev, ventasDirectasHoy: total }));
                markLoaded('ventasDirectas');
            },
            () => markLoaded('ventasDirectas')
        );

        const unsubGastosDirectos = onSnapshot(
            collection(db, 'gastosDirectos'),
            (snapshot) => {
                const total = snapshot.docs.reduce((sum, docSnapshot) => {
                    const data = docSnapshot.data();
                    return isTodayRecord(data.fecha)
                        ? sum + toNumber(data.monto)
                        : sum;
                }, 0);

                setStats((prev) => ({ ...prev, gastosDirectosHoy: total }));
                markLoaded('gastosDirectos');
            },
            () => markLoaded('gastosDirectos')
        );

        const unsubCompras = onSnapshot(
            collection(db, 'compras'),
            (snapshot) => {
                const total = snapshot.docs.reduce((sum, docSnapshot) => {
                    const data = docSnapshot.data();
                    return isTodayRecord(data.fecha)
                        ? sum + toNumber(data.monto)
                        : sum;
                }, 0);

                setStats((prev) => ({ ...prev, gastosComprasHoy: total }));
                markLoaded('compras');
            },
            () => markLoaded('compras')
        );

        const unsubFacturasProveedor = onSnapshot(
            collection(db, 'facturasProveedor'),
            (snapshot) => {
                const total = snapshot.docs.reduce((sum, docSnapshot) => {
                    const data = docSnapshot.data();
                    if (!isTodayRecord(data.fechaEmision) || !isExpenseFacturaProveedor(data)) {
                        return sum;
                    }

                    return sum + toNumber(data.monto);
                }, 0);

                setStats((prev) => ({ ...prev, gastosCxPHoy: total }));
                markLoaded('facturasProveedor');
            },
            () => markLoaded('facturasProveedor')
        );

        const unsubGastosDiarios = onSnapshot(
            collection(db, 'gastosDiarios'),
            (snapshot) => {
                const total = snapshot.docs.reduce((sum, docSnapshot) => {
                    const data = docSnapshot.data();
                    return isTodayRecord(data.fecha)
                        ? sum + toNumber(data.monto)
                        : sum;
                }, 0);

                setStats((prev) => ({ ...prev, gastosDiariosHoy: total }));
                markLoaded('gastosDiarios');
            },
            () => markLoaded('gastosDiarios')
        );

        const unsubCierres = onSnapshot(
            collection(db, 'cierresCajaERP'),
            (snapshot) => {
                let ventasHoy = 0;
                let gastosHoy = 0;

                snapshot.docs.forEach((docSnapshot) => {
                    const data = docSnapshot.data();
                    const estado = String(data.estado || '').toLowerCase();
                    const isProcessed = ['completado', 'cerrado'].includes(estado);

                    if (!isProcessed || !isTodayRecord(data.fecha)) {
                        return;
                    }

                    ventasHoy += getClosureSalesAmount(data);
                    gastosHoy += getClosureCashExpenses(data);
                });

                setStats((prev) => ({
                    ...prev,
                    ventasCierresHoy: ventasHoy,
                    gastosCierresHoy: gastosHoy
                }));
                markLoaded('cierresCajaERP');
            },
            () => markLoaded('cierresCajaERP')
        );

        const unsubDepositos = onSnapshot(
            collection(db, 'depositosTransito'),
            (snapshot) => {
                const totalPendientes = snapshot.docs.reduce((sum, docSnapshot) => {
                    const data = docSnapshot.data();
                    const estado = String(data.estado || '').toLowerCase();
                    return estado && estado !== 'confirmado' && estado !== 'anulado'
                        ? sum + 1
                        : sum;
                }, 0);

                setStats((prev) => ({ ...prev, depositosPendientes: totalPendientes }));
                markLoaded('depositosTransito');
            },
            () => markLoaded('depositosTransito')
        );

        return () => {
            unsubVentasDirectas();
            unsubGastosDirectos();
            unsubCompras();
            unsubFacturasProveedor();
            unsubGastosDiarios();
            unsubCierres();
            unsubDepositos();
        };
    }, [todayKey]);

    const ventasHoy = stats.ventasDirectasHoy + stats.ventasCierresHoy;
    const gastosHoy =
        stats.gastosDirectosHoy +
        stats.gastosComprasHoy +
        stats.gastosCxPHoy +
        stats.gastosDiariosHoy +
        stats.gastosCierresHoy;
    const cajasActivas = sucursalesActivas.length;

    const modules = [
        {
            title: 'Plan de Cuentas',
            description: 'Gestione el catálogo de cuentas contables',
            icon: BookOpen,
            path: '/plan-cuentas',
            color: 'bg-blue-500'
        },
        {
            title: 'Activos Fijos',
            description: 'Registre compras de activos y depreciación',
            icon: Package,
            path: '/activos-fijos',
            color: 'bg-amber-500'
        },
        {
            title: 'Conciliación Bancaria',
            description: 'Suba CSV del banco y concilie contra libros',
            icon: Landmark,
            path: '/conciliacion-bancaria',
            color: 'bg-cyan-500'
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
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                    Bienvenido al ERP Carnessanmartin
                </h1>
                <p className="text-gray-600">
                    Sistema de gestión contable y financiera - Sucursal Granada
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Ventas Hoy</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {loadingStats ? <RefreshCw className="w-6 h-6 animate-spin text-blue-500" /> : formatCurrency(ventasHoy)}
                            </p>
                        </div>
                        <TrendingUp className="w-8 h-8 text-blue-500" />
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Gastos Hoy</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {loadingStats ? <RefreshCw className="w-6 h-6 animate-spin text-red-500" /> : formatCurrency(gastosHoy)}
                            </p>
                        </div>
                        <TrendingDown className="w-8 h-8 text-red-500" />
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Cajas Activas</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {loadingBranches ? <RefreshCw className="w-6 h-6 animate-spin text-green-500" /> : cajasActivas}
                            </p>
                        </div>
                        <Calculator className="w-8 h-8 text-green-500" />
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4 border-l-4 border-orange-500">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">Depósitos Pendientes</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {loadingStats ? <RefreshCw className="w-6 h-6 animate-spin text-orange-500" /> : stats.depositosPendientes}
                            </p>
                        </div>
                        <ArrowRightLeft className="w-8 h-8 text-orange-500" />
                    </div>
                </div>
            </div>

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
