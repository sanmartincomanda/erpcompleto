import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
    AlertTriangle,
    Boxes,
    Eye,
    PackageSearch,
    RefreshCw,
    Search,
    Warehouse
} from 'lucide-react';
import { db } from '../firebase';
import {
    GRANADA_BRANCH_NAME,
    formatCurrency,
    matchSearch,
    toNumber
} from '../utils/erpMirrorUtils';

const filterOptions = {
    todos: 'Todos',
    disponibles: 'Con stock',
    negativos: 'Negativos',
    servicios: 'Servicios',
    inactivos: 'Inactivos'
};

const summaryStyles = [
    'bg-blue-50 text-blue-700',
    'bg-emerald-50 text-emerald-700',
    'bg-amber-50 text-amber-700',
    'bg-rose-50 text-rose-700'
];

const InventarioFisico = () => {
    const [inventario, setInventario] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [stockFilter, setStockFilter] = useState('disponibles');

    useEffect(() => {
        setLoading(true);

        const unsubscribe = onSnapshot(
            query(collection(db, 'inventarioSaldosCache'), orderBy('descripcion')),
            (snapshot) => {
                setInventario(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
                setLoading(false);
            },
            (error) => {
                console.error('Error cargando inventario SICAR:', error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    const inventarioNormalizado = useMemo(() => inventario.map((item) => ({
        ...item,
        existencia: toNumber(item.existencia),
        disponible: toNumber(item.disponible),
        costoPromedio: toNumber(item.costoPromedio),
        costoActual: toNumber(item.costoActual),
        valorInventario: toNumber(item.existencia) * toNumber(item.costoPromedio)
    })), [inventario]);

    const inventarioFiltrado = useMemo(() => {
        const filtered = inventarioNormalizado.filter((item) => {
            if (stockFilter === 'disponibles' && item.existencia <= 0) return false;
            if (stockFilter === 'negativos' && item.existencia >= 0) return false;
            if (stockFilter === 'servicios' && !item.servicio) return false;
            if (stockFilter === 'inactivos' && item.activo !== false) return false;
            if (stockFilter !== 'servicios' && stockFilter !== 'inactivos' && item.servicio) return false;

            return matchSearch(searchTerm, [
                item.sku,
                item.skuAlterno,
                item.descripcion,
                item.localizacion
            ]);
        });

        return [...filtered].sort((left, right) => (
            String(left.descripcion || '').localeCompare(String(right.descripcion || ''))
        ));
    }, [inventarioNormalizado, searchTerm, stockFilter]);

    const resumen = useMemo(() => inventarioFiltrado.reduce((acc, item) => {
        acc.documentos += 1;

        if (item.activo !== false) acc.activos += 1;
        if (item.existencia > 0) acc.conExistencia += 1;
        if (item.existencia < 0) acc.negativos += 1;
        if (item.servicio) acc.servicios += 1;
        acc.valorInventario += item.valorInventario;

        return acc;
    }, {
        documentos: 0,
        activos: 0,
        conExistencia: 0,
        negativos: 0,
        servicios: 0,
        valorInventario: 0
    }), [inventarioFiltrado]);

    const summaryCards = [
        {
            title: 'Productos visibles',
            value: resumen.documentos,
            icon: Boxes
        },
        {
            title: 'Con stock',
            value: resumen.conExistencia,
            icon: Warehouse
        },
        {
            title: 'Stock negativo',
            value: resumen.negativos,
            icon: AlertTriangle
        },
        {
            title: 'Valor estimado',
            value: formatCurrency(resumen.valorInventario),
            icon: PackageSearch
        }
    ];

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
                            <Warehouse className="w-7 h-7" />
                        </div>
                        Inventario SICAR
                    </h1>
                    <p className="mt-2 text-slate-600">
                        Consulta visual y solo lectura del inventario sincronizado desde SICAR para {GRANADA_BRANCH_NAME}.
                    </p>
                </div>

                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 max-w-md">
                    <div className="flex items-start gap-3">
                        <Eye className="w-5 h-5 text-blue-700 mt-0.5" />
                        <div>
                            <p className="font-semibold">Solo visualizacion</p>
                            <p className="mt-1">
                                Este modulo no edita inventario. Solo expone saldos, costos y disponibilidad que vienen del espejo SICAR.
                            </p>
                        </div>
                    </div>
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
                        <h2 className="text-lg font-semibold text-slate-900">Productos sincronizados</h2>
                        <p className="text-sm text-slate-500">
                            Se muestran SKU, descripcion, saldos y costos sin tocar inventario real.
                        </p>
                    </div>

                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="relative min-w-[260px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Buscar SKU, descripcion o ubicacion"
                                className="w-full rounded-xl border border-slate-300 pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <select
                            value={stockFilter}
                            onChange={(event) => setStockFilter(event.target.value)}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {Object.entries(filterOptions).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1120px] text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">SKU</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Descripcion</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Tipo</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Existencia</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Disponible</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Costo promedio</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Costo actual</th>
                                <th className="px-4 py-3 text-right font-medium text-slate-600">Valor estimado</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-10 text-center">
                                        <RefreshCw className="w-7 h-7 animate-spin text-blue-600 mx-auto" />
                                    </td>
                                </tr>
                            ) : inventarioFiltrado.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                                        No hay productos para los filtros seleccionados.
                                    </td>
                                </tr>
                            ) : inventarioFiltrado.map((item) => (
                                <tr key={item.id} className={`hover:bg-slate-50 ${item.existencia < 0 ? 'bg-rose-50/50' : ''}`}>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-slate-900">{item.sku || '-'}</div>
                                        <div className="text-xs text-slate-500">{item.skuAlterno || 'Sin SKU alterno'}</div>
                                    </td>
                                    <td className="px-4 py-3 max-w-md">
                                        <div className="font-medium text-slate-900">{item.descripcion}</div>
                                        <div className="text-xs text-slate-500">{item.localizacion || 'Sin localizacion'}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                            item.servicio
                                                ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
                                                : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
                                        }`}>
                                            {item.servicio ? 'Servicio' : 'Producto'}
                                        </span>
                                    </td>
                                    <td className={`px-4 py-3 text-right font-semibold ${item.existencia < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                                        {item.existencia.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-4 py-3 text-right text-slate-700">
                                        {item.disponible.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(item.costoPromedio)}</td>
                                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(item.costoActual)}</td>
                                    <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCurrency(item.valorInventario)}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-2">
                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                                item.activo === false
                                                    ? 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
                                                    : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                            }`}>
                                                {item.activo === false ? 'Inactivo' : 'Activo'}
                                            </span>
                                            {item.existencia < 0 && (
                                                <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                                                    Stock negativo
                                                </span>
                                            )}
                                        </div>
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

export default InventarioFisico;
