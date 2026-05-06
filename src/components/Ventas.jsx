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
    ShoppingBag,
    TrendingUp
} from 'lucide-react';
import { db } from '../firebase';
import {
    GRANADA_BRANCH_NAME,
    formatCurrency,
    formatDateTime,
    formatShortDate,
    matchSearch,
    paymentMethodLabel,
    sourceKind,
    sourceLabel,
    sortByDateDesc,
    toNumber
} from '../utils/erpMirrorUtils';

const sourceStyles = {
    SICAR: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    Manual: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
};

const statusStyles = {
    activa: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    cancelada: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    credito: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
};

const summaryStyles = [
    'bg-emerald-50 text-emerald-700',
    'bg-blue-50 text-blue-700',
    'bg-amber-50 text-amber-700',
    'bg-violet-50 text-violet-700'
];

const normalizeSaleState = (sale) => {
    if (sale?.cancelado || String(sale?.estado || '').toLowerCase() === 'cancelada') {
        return 'cancelada';
    }

    if (sale?.esCredito || String(sale?.metodoPago || '').toLowerCase() === 'credito') {
        return 'credito';
    }

    return 'activa';
};

const Ventas = () => {
    const [ventas, setVentas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sourceFilter, setSourceFilter] = useState('todas');
    const [statusFilter, setStatusFilter] = useState('todas');

    useEffect(() => {
        setLoading(true);

        const unsubscribe = onSnapshot(
            query(collection(db, 'ventasDirectas'), orderBy('fecha', 'desc')),
            (snapshot) => {
                setVentas(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
                setLoading(false);
            },
            (error) => {
                console.error('Error cargando ventas:', error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    const ventasNormalizadas = useMemo(() => {
        const rows = ventas.map((venta) => {
            const source = sourceLabel(venta);
            const status = normalizeSaleState(venta);
            const monto = toNumber(venta.monto);
            const costoVenta = toNumber(venta.costoVenta);
            const utilidadBruta = toNumber(venta.utilidadBruta);
            const cantidadItems = Array.isArray(venta.items)
                ? venta.items.length
                : toNumber(venta.totalItems);

            return {
                ...venta,
                source,
                status,
                monto,
                costoVenta,
                utilidadBruta,
                cantidadItems
            };
        });

        return sortByDateDesc(rows, 'fechaHora', 'createdAt', 'fecha');
    }, [ventas]);

    const ventasFiltradas = useMemo(() => ventasNormalizadas.filter((venta) => {
        if (sourceFilter !== 'todas' && sourceKind(venta) !== sourceFilter) {
            return false;
        }

        if (statusFilter !== 'todas' && venta.status !== statusFilter) {
            return false;
        }

        return matchSearch(searchTerm, [
            venta.factura,
            venta.cliente,
            venta.descripcion,
            venta.documentoId
        ]);
    }), [searchTerm, sourceFilter, statusFilter, ventasNormalizadas]);

    const resumen = useMemo(() => ventasFiltradas.reduce((acc, venta) => {
        acc.documentos += 1;

        if (venta.status === 'cancelada') {
            acc.canceladas += 1;
        } else {
            acc.totalVentas += venta.monto;
            acc.totalCosto += venta.costoVenta;
            acc.totalUtilidad += venta.utilidadBruta;
        }

        if (venta.status === 'credito') {
            acc.totalCredito += venta.monto;
        }

        if (sourceKind(venta) === 'sicar') {
            acc.sicar += 1;
        } else {
            acc.manual += 1;
        }

        return acc;
    }, {
        documentos: 0,
        totalVentas: 0,
        totalCosto: 0,
        totalUtilidad: 0,
        totalCredito: 0,
        canceladas: 0,
        sicar: 0,
        manual: 0
    }), [ventasFiltradas]);

    const summaryCards = [
        {
            title: 'Ventas vigentes',
            value: formatCurrency(resumen.totalVentas),
            icon: DollarSign
        },
        {
            title: 'Costo vendido',
            value: formatCurrency(resumen.totalCosto),
            icon: ShoppingBag
        },
        {
            title: 'Ventas a credito',
            value: formatCurrency(resumen.totalCredito),
            icon: CreditCard
        },
        {
            title: 'Utilidad bruta visible',
            value: formatCurrency(resumen.totalUtilidad),
            icon: TrendingUp
        }
    ];

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-green-100 text-green-700 flex items-center justify-center">
                            <TrendingUp className="w-7 h-7" />
                        </div>
                        Ventas
                    </h1>
                    <p className="mt-2 text-slate-600">
                        Vista unificada de ventas manuales y ventas integradas desde SICAR para {GRANADA_BRANCH_NAME}.
                    </p>
                </div>

                <Link
                    to="/data-entry"
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 text-white px-4 py-3 hover:bg-slate-800 transition-colors"
                >
                    Registrar venta manual
                    <ArrowUpRight className="w-4 h-4" />
                </Link>
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
                        <h2 className="text-lg font-semibold text-slate-900">Todas las ventas</h2>
                        <p className="text-sm text-slate-500">
                            Documentos visibles: {resumen.documentos}. Fuente SICAR: {resumen.sicar}. Manuales: {resumen.manual}.
                        </p>
                    </div>

                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="relative min-w-[260px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Buscar cliente, factura o descripcion"
                                className="w-full rounded-xl border border-slate-300 pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                        </div>
                        <select
                            value={sourceFilter}
                            onChange={(event) => setSourceFilter(event.target.value)}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                        >
                            <option value="todas">Todas las fuentes</option>
                            <option value="sicar">SICAR</option>
                            <option value="manual">Manual</option>
                        </select>
                        <select
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value)}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                        >
                            <option value="todas">Todos los estados</option>
                            <option value="activa">Activas</option>
                            <option value="credito">Credito</option>
                            <option value="cancelada">Canceladas</option>
                        </select>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1100px] text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Documento</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Cliente</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Descripcion</th>
                                <th className="px-4 py-3 text-center font-medium text-slate-600">Fuente</th>
                                <th className="px-4 py-3 text-center font-medium text-slate-600">Cobro</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Monto</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Costo</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Utilidad</th>
                                <th className="px-4 py-3 text-center font-medium text-slate-600">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-10 text-center">
                                        <RefreshCw className="w-7 h-7 animate-spin text-green-600 mx-auto" />
                                    </td>
                                </tr>
                            ) : ventasFiltradas.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                                        No hay ventas para los filtros seleccionados.
                                    </td>
                                </tr>
                            ) : ventasFiltradas.map((venta) => (
                                <tr key={venta.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 text-slate-600">
                                        <div>{formatShortDate(venta.fecha)}</div>
                                        <div className="text-xs text-slate-500">{formatDateTime(venta.fechaHora)}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-slate-900">{venta.factura || venta.documentoId}</div>
                                        <div className="text-xs text-slate-500">{venta.sucursalName || GRANADA_BRANCH_NAME}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-slate-900">{venta.cliente || 'Cliente de mostrador'}</div>
                                        <div className="text-xs text-slate-500">
                                            {venta.cantidadItems
                                                ? `${venta.cantidadItems} item${venta.cantidadItems === 1 ? '' : 's'}`
                                                : 'Sin detalle de items'}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600 max-w-md">
                                        <div className="truncate" title={venta.descripcion || ''}>
                                            {venta.descripcion || '-'}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${sourceStyles[venta.source]}`}>
                                            {venta.source}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-700">
                                            {paymentMethodLabel(venta.metodoPago)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                                        {formatCurrency(venta.monto, venta.moneda)}
                                    </td>
                                    <td className="px-4 py-3 text-right text-slate-600">
                                        {venta.costoVenta > 0 ? formatCurrency(venta.costoVenta) : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right text-emerald-700">
                                        {venta.utilidadBruta > 0 ? formatCurrency(venta.utilidadBruta) : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[venta.status]}`}>
                                            {venta.status === 'activa' ? 'Activa' : venta.status === 'credito' ? 'Credito' : 'Cancelada'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-4">
                <div className="flex items-start gap-3">
                    <Receipt className="w-5 h-5 text-green-700 mt-0.5" />
                    <div className="text-sm text-green-900">
                        <p className="font-semibold">Como se unifica este modulo</p>
                        <p className="mt-1">
                            Las ventas manuales y las integradas desde MySQL SICAR viven juntas en <code>ventasDirectas</code>. El distintivo de fuente te deja ver de donde viene cada documento.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Ventas;
