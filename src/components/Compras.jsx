import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
    ArrowUpRight,
    CreditCard,
    DollarSign,
    Receipt,
    RefreshCw,
    Search,
    ShoppingCart,
    Wallet
} from 'lucide-react';
import { db } from '../firebase';
import {
    GRANADA_BRANCH_NAME,
    formatCurrency,
    formatShortDate,
    matchSearch,
    sourceKind,
    sourceLabel,
    sortByDateDesc,
    toNumber
} from '../utils/erpMirrorUtils';

const categoryStyles = {
    mercaderia: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    gasto: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
};

const sourceStyles = {
    SICAR: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    Manual: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
};

const paymentStyles = {
    pendiente: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    pagada: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    anulada: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
};

const summaryStyles = [
    'bg-amber-50 text-amber-700',
    'bg-rose-50 text-rose-700',
    'bg-blue-50 text-blue-700',
    'bg-emerald-50 text-emerald-700'
];

const resolveCategory = (documento) => {
    const code = String(documento?.cuentaCostoCode || documento?.cuentaGastoCode || '');
    const type = String(documento?.cuentaCostoType || documento?.cuentaGastoType || '').toUpperCase();

    if (
        documento?.clasificacionContable === 'costo_mercaderia_vendida' ||
        code.startsWith('51') ||
        type === 'COSTO' ||
        documento?.esGasto === false
    ) {
        return 'mercaderia';
    }

    return 'gasto';
};

const resolvePaymentStatus = (documento) => {
    if (documento?.cancelado || ['anulado', 'cancelada'].includes(String(documento?.estado || '').toLowerCase())) {
        return 'anulada';
    }

    if (documento?.pagada === true || toNumber(documento?.saldoPendiente) <= 0.01) {
        return 'pagada';
    }

    if (documento?.esCredito || toNumber(documento?.saldoPendiente) > 0.01) {
        return 'pendiente';
    }

    return 'pagada';
};

const normalizePurchaseDocument = (documento, collectionName) => {
    const source = sourceLabel(documento);
    const category = resolveCategory(documento);
    const paymentStatus = resolvePaymentStatus(documento);

    return {
        ...documento,
        mergedId: `${collectionName}:${documento.id}`,
        collectionName,
        source,
        category,
        paymentStatus,
        monto: toNumber(documento.monto),
        saldoPendiente: toNumber(documento.saldoPendiente),
        montoPagado: toNumber(documento.montoPagado || documento.montoAbonado),
        moneda: documento.moneda || 'NIO',
        proveedorNombre: documento.proveedorNombre || documento.proveedor || 'Proveedor',
        referencia: documento.numeroFactura || documento.factura || documento.documentoId,
        cuentaCode: documento.cuentaCostoCode || documento.cuentaGastoCode || '',
        cuentaName: documento.cuentaCostoName || documento.cuentaGastoName || '',
        fechaPrincipal: documento.fechaEmision || documento.fecha || documento.createdAt || documento.syncedAt
    };
};

const Compras = () => {
    const [compras, setCompras] = useState([]);
    const [gastos, setGastos] = useState([]);
    const [facturasManualCredito, setFacturasManualCredito] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('todas');
    const [sourceFilter, setSourceFilter] = useState('todas');
    const [paymentFilter, setPaymentFilter] = useState('todas');

    useEffect(() => {
        setLoading(true);
        const readyState = { compras: false, gastos: false, facturas: false };

        const markReady = (key) => {
            readyState[key] = true;
            if (Object.values(readyState).every(Boolean)) {
                setLoading(false);
            }
        };

        const unsubCompras = onSnapshot(
            query(collection(db, 'compras'), orderBy('fecha', 'desc')),
            (snapshot) => {
                setCompras(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
                markReady('compras');
            },
            (error) => {
                console.error('Error cargando compras:', error);
                markReady('compras');
            }
        );

        const unsubGastos = onSnapshot(
            query(collection(db, 'gastosDirectos'), orderBy('fecha', 'desc')),
            (snapshot) => {
                setGastos(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
                markReady('gastos');
            },
            (error) => {
                console.error('Error cargando gastos:', error);
                markReady('gastos');
            }
        );

        const unsubFacturas = onSnapshot(
            query(collection(db, 'facturasProveedor'), orderBy('fechaEmision', 'desc')),
            (snapshot) => {
                const manualOnly = snapshot.docs
                    .map((item) => ({ id: item.id, ...item.data() }))
                    .filter((item) => sourceKind(item) !== 'sicar');

                setFacturasManualCredito(manualOnly);
                markReady('facturas');
            },
            (error) => {
                console.error('Error cargando facturas proveedor para compras:', error);
                markReady('facturas');
            }
        );

        return () => {
            unsubCompras();
            unsubGastos();
            unsubFacturas();
        };
    }, []);

    const documentos = useMemo(() => {
        const merged = [
            ...compras.map((item) => normalizePurchaseDocument(item, 'compras')),
            ...gastos.map((item) => normalizePurchaseDocument(item, 'gastosDirectos')),
            ...facturasManualCredito.map((item) => normalizePurchaseDocument(item, 'facturasProveedor'))
        ];

        return sortByDateDesc(merged, 'fechaPrincipal', 'createdAt', 'syncedAt');
    }, [compras, facturasManualCredito, gastos]);

    const documentosFiltrados = useMemo(() => documentos.filter((documento) => {
        if (categoryFilter !== 'todas' && documento.category !== categoryFilter) {
            return false;
        }

        if (sourceFilter !== 'todas' && sourceKind(documento) !== sourceFilter) {
            return false;
        }

        if (paymentFilter !== 'todas' && documento.paymentStatus !== paymentFilter) {
            return false;
        }

        return matchSearch(searchTerm, [
            documento.proveedorNombre,
            documento.descripcion,
            documento.referencia,
            documento.cuentaCode,
            documento.cuentaName
        ]);
    }), [categoryFilter, documentos, paymentFilter, searchTerm, sourceFilter]);

    const resumen = useMemo(() => documentosFiltrados.reduce((acc, documento) => {
        acc.documentos += 1;
        acc.totalGeneral += documento.monto;

        if (documento.category === 'mercaderia') {
            acc.totalMercaderia += documento.monto;
        } else {
            acc.totalGastos += documento.monto;
        }

        if (documento.paymentStatus === 'pendiente') {
            acc.totalPendiente += documento.saldoPendiente || documento.monto;
        }

        return acc;
    }, {
        documentos: 0,
        totalGeneral: 0,
        totalMercaderia: 0,
        totalGastos: 0,
        totalPendiente: 0
    }), [documentosFiltrados]);

    const summaryCards = [
        {
            title: 'Mercaderia / CMV',
            value: formatCurrency(resumen.totalMercaderia),
            icon: ShoppingCart
        },
        {
            title: 'Gastos',
            value: formatCurrency(resumen.totalGastos),
            icon: DollarSign
        },
        {
            title: 'Pendiente por pagar',
            value: formatCurrency(resumen.totalPendiente),
            icon: CreditCard
        },
        {
            title: 'Documentos visibles',
            value: resumen.documentos,
            icon: Receipt
        }
    ];

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
                            <ShoppingCart className="w-7 h-7" />
                        </div>
                        Compras y Gastos
                    </h1>
                    <p className="mt-2 text-slate-600">
                        Vista consolidada para {GRANADA_BRANCH_NAME} con mercaderia vendida y gastos en un solo lugar.
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <Link
                        to="/data-entry"
                        className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 text-white px-4 py-3 hover:bg-slate-800 transition-colors"
                    >
                        Registrar gasto manual
                        <ArrowUpRight className="w-4 h-4" />
                    </Link>
                    <Link
                        to="/cuentas-pagar"
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                        Ir a cuentas por pagar
                        <Wallet className="w-4 h-4" />
                    </Link>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {summaryCards.map((card, index) => {
                    const Icon = card.icon;
                    return (
                        <div key={card.title} className={`rounded-2xl p-4 ${summaryStyles[index]}`}>
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium opacity-80">{card.title}</p>
                                    <p className="mt-2 text-2xl font-bold">{card.value}</p>
                                </div>
                                <Icon className="w-8 h-8 opacity-80" />
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-200 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">Documentos de compras</h2>
                        <p className="text-sm text-slate-500">
                            El distintivo separa claramente mercaderia para CMV y gastos operativos.
                        </p>
                    </div>

                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="relative min-w-[260px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Buscar proveedor, referencia o cuenta"
                                className="w-full rounded-xl border border-slate-300 pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                        </div>
                        <select
                            value={categoryFilter}
                            onChange={(event) => setCategoryFilter(event.target.value)}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        >
                            <option value="todas">Mercaderia y gastos</option>
                            <option value="mercaderia">Mercaderia / CMV</option>
                            <option value="gasto">Gastos</option>
                        </select>
                        <select
                            value={sourceFilter}
                            onChange={(event) => setSourceFilter(event.target.value)}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        >
                            <option value="todas">Todas las fuentes</option>
                            <option value="sicar">SICAR</option>
                            <option value="manual">Manual</option>
                        </select>
                        <select
                            value={paymentFilter}
                            onChange={(event) => setPaymentFilter(event.target.value)}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        >
                            <option value="todas">Todos los pagos</option>
                            <option value="pagada">Pagadas</option>
                            <option value="pendiente">Pendientes</option>
                            <option value="anulada">Anuladas</option>
                        </select>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1180px] text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Referencia</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Proveedor</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Descripcion</th>
                                <th className="px-4 py-3 text-center font-medium text-slate-600">Distintivo</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Cuenta</th>
                                <th className="px-4 py-3 text-center font-medium text-slate-600">Fuente</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Monto</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Pendiente</th>
                                <th className="px-4 py-3 text-center font-medium text-slate-600">Estado pago</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-10 text-center">
                                        <RefreshCw className="w-7 h-7 animate-spin text-amber-600 mx-auto" />
                                    </td>
                                </tr>
                            ) : documentosFiltrados.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                                        No hay compras o gastos para los filtros seleccionados.
                                    </td>
                                </tr>
                            ) : documentosFiltrados.map((documento) => (
                                <tr key={documento.mergedId} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 text-slate-600">{formatShortDate(documento.fechaPrincipal)}</td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-slate-900">{documento.referencia || documento.documentoId}</div>
                                        <div className="text-xs text-slate-500">{documento.collectionName}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-slate-900">{documento.proveedorNombre}</div>
                                        <div className="text-xs text-slate-500">{documento.sucursalName || GRANADA_BRANCH_NAME}</div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600 max-w-md">
                                        <div className="truncate" title={documento.descripcion || ''}>
                                            {documento.descripcion || '-'}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${categoryStyles[documento.category]}`}>
                                            {documento.category === 'mercaderia' ? 'Mercaderia / CMV' : 'Gasto'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600">
                                        {documento.cuentaCode ? `${documento.cuentaCode} - ${documento.cuentaName}` : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${sourceStyles[documento.source]}`}>
                                            {documento.source}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                        {formatCurrency(documento.monto, documento.moneda)}
                                    </td>
                                    <td className="px-4 py-3 text-right text-amber-700">
                                        {documento.paymentStatus === 'pendiente'
                                            ? formatCurrency(documento.saldoPendiente || documento.monto, documento.moneda)
                                            : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${paymentStyles[documento.paymentStatus]}`}>
                                            {documento.paymentStatus === 'pagada'
                                                ? 'Pagada'
                                                : documento.paymentStatus === 'pendiente'
                                                    ? 'Pendiente'
                                                    : 'Anulada'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Compras;
