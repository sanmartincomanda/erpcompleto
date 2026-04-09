// src/components/Reports.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import {
    BarChart3,
    FileText,
    Calendar,
    RefreshCw,
    TrendingUp,
    PieChart,
    Building2,
    ChevronDown,
    ChevronUp,
    Eye,
    X
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { useBranches } from '../hooks/useBranches';

const normalizeTipoMovimiento = (movimiento) =>
    movimiento?.tipo || movimiento?.type || '';

const toAmount = (value) => Number(value || 0);

const getMovimientoSucursalId = (movimiento) =>
    movimiento?.sucursalId || movimiento?.branchId || '';

const getMovimientoSucursalName = (movimiento) =>
    movimiento?.sucursalName || movimiento?.branchName || movimiento?.tienda || 'General';

const getAccountNature = (account = {}) => {
    const nature = String(account?.nature || '').toUpperCase();

    if (nature.includes('DEUD')) return 'DEUDORA';
    if (nature.includes('ACRE')) return 'ACREEDORA';

    return ['ACTIVO', 'COSTO', 'GASTO'].includes(account?.type) ? 'DEUDORA' : 'ACREEDORA';
};

const getSignedBalanceAmount = (account, movimiento) => {
    const tipo = normalizeTipoMovimiento(movimiento);
    const isDeudora = getAccountNature(account) === 'DEUDORA';

    if ((tipo === 'DEBITO' && isDeudora) || (tipo === 'CREDITO' && !isDeudora)) {
        return toAmount(movimiento.monto);
    }

    return toAmount(movimiento.monto) * -1;
};

const Reports = () => {
    const { branches } = useBranches();
    const sucursalesActivas = useMemo(
        () => branches.filter((branch) => branch.isActive !== false),
        [branches]
    );

    const [activeTab, setActiveTab] = useState('estado');
    const [loading, setLoading] = useState(false);
    const [fechaDesde, setFechaDesde] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [fechaHasta, setFechaHasta] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [filtroSucursal, setFiltroSucursal] = useState('');

    const [estadoResultados, setEstadoResultados] = useState({
        ingresos: 0,
        costos: 0,
        gastos: 0,
        utilidadBruta: 0,
        utilidadNeta: 0
    });

    const [balanceGeneral, setBalanceGeneral] = useState({
        activos: 0,
        pasivos: 0,
        capital: 0,
        patrimonio: 0
    });

    const [movimientos, setMovimientos] = useState([]);
    const [detalleGastosOperativos, setDetalleGastosOperativos] = useState([]);
    const [mostrarDetalleGastos, setMostrarDetalleGastos] = useState(false);
    const [cuentaGastoDetalle, setCuentaGastoDetalle] = useState(null);

    useEffect(() => {
        loadData();
    }, [fechaDesde, fechaHasta, filtroSucursal]);

    const loadData = async () => {
        setLoading(true);

        try {
            const accountsSnap = await getDocs(query(collection(db, 'planCuentas'), orderBy('code')));
            const accounts = accountsSnap.docs.map((docSnapshot) => ({
                id: docSnapshot.id,
                ...docSnapshot.data()
            }));

            const accountById = new Map(accounts.map((account) => [account.id, account]));
            const accountByCode = new Map(accounts.map((account) => [account.code, account]));

            const movimientosPeriodoSnap = await getDocs(query(
                collection(db, 'movimientosContables'),
                where('fecha', '>=', fechaDesde),
                where('fecha', '<=', fechaHasta),
                orderBy('fecha', 'desc')
            ));

            const movimientosPeriodo = movimientosPeriodoSnap.docs
                .map((docSnapshot) => {
                    const raw = docSnapshot.data();
                    const tipo = normalizeTipoMovimiento(raw);

                    return {
                        id: docSnapshot.id,
                        ...raw,
                        monto: toAmount(raw.monto),
                        tipo,
                        type: raw.type || tipo,
                        sucursalName: getMovimientoSucursalName(raw),
                        sucursalId: getMovimientoSucursalId(raw)
                    };
                })
                .filter((movimiento) => !filtroSucursal || movimiento.sucursalId === filtroSucursal);

            setMovimientos(movimientosPeriodo);

            let ingresos = 0;
            let costos = 0;
            let gastos = 0;
            const gastosDetallados = [];

            movimientosPeriodo.forEach((movimiento) => {
                const account =
                    accountById.get(movimiento.accountId) ||
                    accountByCode.get(movimiento.accountCode);

                if (!account) return;

                if (account.type === 'INGRESO' && movimiento.tipo === 'CREDITO') {
                    ingresos += movimiento.monto;
                } else if (account.type === 'COSTO' && movimiento.tipo === 'DEBITO') {
                    costos += movimiento.monto;
                } else if (account.type === 'GASTO' && movimiento.tipo === 'DEBITO') {
                    gastos += movimiento.monto;
                    gastosDetallados.push({
                        id: movimiento.id,
                        fecha: movimiento.fecha,
                        sucursalName: movimiento.sucursalName,
                        accountCode: movimiento.accountCode || account.code || '',
                        accountName: movimiento.accountName || account.name || 'Cuenta de gasto',
                        descripcion: movimiento.descripcion || 'Gasto operativo',
                        referencia: movimiento.referencia || '-',
                        monto: movimiento.monto
                    });
                }
            });

            setDetalleGastosOperativos(gastosDetallados);

            setEstadoResultados({
                ingresos,
                costos,
                gastos,
                utilidadBruta: ingresos - costos,
                utilidadNeta: ingresos - costos - gastos
            });

            const movimientosBalanceSnap = await getDocs(query(
                collection(db, 'movimientosContables'),
                where('fecha', '<=', fechaHasta),
                orderBy('fecha', 'desc')
            ));

            const balanceTotals = {
                ACTIVO: 0,
                PASIVO: 0,
                CAPITAL: 0
            };

            movimientosBalanceSnap.docs.forEach((docSnapshot) => {
                const raw = docSnapshot.data();
                const sucursalId = getMovimientoSucursalId(raw);

                if (filtroSucursal && sucursalId !== filtroSucursal) return;

                const account =
                    accountById.get(raw.accountId) ||
                    accountByCode.get(raw.accountCode);

                if (!account || !balanceTotals.hasOwnProperty(account.type)) return;

                balanceTotals[account.type] += getSignedBalanceAmount(account, raw);
            });

            setBalanceGeneral({
                activos: balanceTotals.ACTIVO,
                pasivos: balanceTotals.PASIVO,
                capital: balanceTotals.CAPITAL,
                patrimonio: balanceTotals.ACTIVO - balanceTotals.PASIVO
            });
        } catch (err) {
            console.error('Error cargando datos:', err);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        return `C$ ${Number(amount || 0).toLocaleString('es-NI', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    };

    const gastosOperativosAgrupados = useMemo(() => {
        const groups = new Map();

        detalleGastosOperativos.forEach((gasto) => {
            const groupKey = `${gasto.accountCode || ''}__${gasto.accountName || ''}`;
            const currentGroup = groups.get(groupKey) || {
                id: groupKey,
                accountCode: gasto.accountCode || '',
                accountName: gasto.accountName || 'Cuenta de gasto',
                total: 0,
                movimientos: []
            };

            currentGroup.total += Number(gasto.monto || 0);
            currentGroup.movimientos.push(gasto);
            groups.set(groupKey, currentGroup);
        });

        return Array.from(groups.values())
            .map((group) => ({
                ...group,
                total: Number(group.total || 0),
                movimientos: [...group.movimientos].sort((left, right) => {
                    const fechaRight = String(right.fecha || '');
                    const fechaLeft = String(left.fecha || '');
                    return fechaRight.localeCompare(fechaLeft);
                })
            }))
            .sort((left, right) => right.total - left.total);
    }, [detalleGastosOperativos]);

    const renderEstadoResultados = () => (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-lg p-4">
                    <p className="text-sm text-green-600 mb-1">Ingresos Totales</p>
                    <p className="text-2xl font-bold text-green-700">{formatCurrency(estadoResultados.ingresos)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-4">
                    <p className="text-sm text-red-600 mb-1">Costos Totales</p>
                    <p className="text-2xl font-bold text-red-700">{formatCurrency(estadoResultados.costos)}</p>
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                    <p className="text-sm text-orange-600 mb-1">Gastos Totales</p>
                    <p className="text-2xl font-bold text-orange-700">{formatCurrency(estadoResultados.gastos)}</p>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-lg mb-4">Estado de Resultados</h3>
                <div className="space-y-4">
                    <div className="flex justify-between items-center py-2 border-b">
                        <span className="font-medium">Ingresos</span>
                        <span className="text-green-600 font-bold">{formatCurrency(estadoResultados.ingresos)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b">
                        <span className="font-medium">Costos</span>
                        <span className="text-red-600 font-bold">({formatCurrency(estadoResultados.costos)})</span>
                    </div>
                    <div className="flex justify-between items-center py-2 bg-gray-50 px-4 rounded">
                        <span className="font-bold">Utilidad Bruta</span>
                        <span className={`font-bold ${estadoResultados.utilidadBruta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(estadoResultados.utilidadBruta)}
                        </span>
                    </div>
                    <div className="border-b">
                        <button
                            type="button"
                            onClick={() => setMostrarDetalleGastos((prev) => !prev)}
                            className="w-full flex justify-between items-center py-2 text-left"
                        >
                            <span className="font-medium flex items-center gap-2">
                                Gastos Operativos
                                {mostrarDetalleGastos ? (
                                    <ChevronUp className="w-4 h-4 text-gray-500" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-gray-500" />
                                )}
                            </span>
                            <span className="text-red-600 font-bold">({formatCurrency(estadoResultados.gastos)})</span>
                        </button>

                        {mostrarDetalleGastos && (
                            <div className="pb-4">
                                <div className="rounded-lg border border-slate-200 overflow-hidden mt-2">
                                    {gastosOperativosAgrupados.length === 0 ? (
                                        <div className="p-4 text-sm text-slate-500 bg-slate-50">
                                            No hay gastos operativos en el período seleccionado.
                                        </div>
                                    ) : (
                                        <>
                                            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                                                <span className="text-sm font-medium text-slate-700">
                                                    Gastos agrupados por cuenta
                                                </span>
                                                <span className="text-sm text-slate-500">
                                                    {gastosOperativosAgrupados.length} cuenta(s)
                                                </span>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-white">
                                                        <tr className="border-b border-slate-200">
                                                            <th className="px-4 py-3 text-left font-medium text-slate-700">Cuenta</th>
                                                            <th className="px-4 py-3 text-center font-medium text-slate-700">Movimientos</th>
                                                            <th className="px-4 py-3 text-right font-medium text-slate-700">Monto</th>
                                                            <th className="px-4 py-3 text-center font-medium text-slate-700">Detalle</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {gastosOperativosAgrupados.map((cuenta) => (
                                                            <tr key={cuenta.id} className="hover:bg-slate-50">
                                                                <td className="px-4 py-3">
                                                                    <span className="font-mono text-xs">{cuenta.accountCode}</span>
                                                                    <br />
                                                                    <span className="text-slate-600">{cuenta.accountName}</span>
                                                                </td>
                                                                <td className="px-4 py-3 text-center">{cuenta.movimientos.length}</td>
                                                                <td className="px-4 py-3 text-right font-medium text-red-600">
                                                                    {formatCurrency(cuenta.total)}
                                                                </td>
                                                                <td className="px-4 py-3 text-center">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setCuentaGastoDetalle(cuenta)}
                                                                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100"
                                                                    >
                                                                        <Eye className="w-4 h-4" />
                                                                        Ver gastos
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex justify-between items-center py-3 bg-blue-50 px-4 rounded-lg">
                        <span className="font-bold text-lg">Utilidad Neta</span>
                        <span className={`text-xl font-bold ${estadoResultados.utilidadNeta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(estadoResultados.utilidadNeta)}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderBalanceGeneral = () => (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-sm text-blue-600 mb-1">Activos Totales</p>
                    <p className="text-2xl font-bold text-blue-700">{formatCurrency(balanceGeneral.activos)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-4">
                    <p className="text-sm text-red-600 mb-1">Pasivos Totales</p>
                    <p className="text-2xl font-bold text-red-700">{formatCurrency(balanceGeneral.pasivos)}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                    <p className="text-sm text-green-600 mb-1">Patrimonio</p>
                    <p className="text-2xl font-bold text-green-700">{formatCurrency(balanceGeneral.patrimonio)}</p>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-bold text-lg mb-4">Balance General</h3>
                <div className="space-y-4">
                    <div className="flex justify-between items-center py-2 border-b">
                        <span className="font-medium">Activos</span>
                        <span className="text-blue-600 font-bold">{formatCurrency(balanceGeneral.activos)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b">
                        <span className="font-medium">Pasivos</span>
                        <span className="text-red-600 font-bold">{formatCurrency(balanceGeneral.pasivos)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b">
                        <span className="font-medium">Capital</span>
                        <span className="text-purple-600 font-bold">{formatCurrency(balanceGeneral.capital)}</span>
                    </div>
                    <div className="flex justify-between items-center py-3 bg-gray-100 px-4 rounded-lg">
                        <span className="font-bold text-lg">Total Pasivo + Capital</span>
                        <span className="text-xl font-bold text-gray-800">
                            {formatCurrency(balanceGeneral.pasivos + balanceGeneral.capital)}
                        </span>
                    </div>
                    <div className={`flex justify-between items-center py-2 px-4 rounded ${
                        Math.abs(balanceGeneral.activos - (balanceGeneral.pasivos + balanceGeneral.capital)) < 0.01
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700'
                    }`}>
                        <span className="font-medium">Diferencia</span>
                        <span className="font-bold">
                            {Math.abs(balanceGeneral.activos - (balanceGeneral.pasivos + balanceGeneral.capital)) < 0.01
                                ? 'Cuadrado'
                                : 'Descuadrado'}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderMovimientos = () => (
        <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Fecha</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Sucursal</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Cuenta</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">DescripciÃ³n</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Referencia</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">DÃ©bito</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">CrÃ©dito</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {movimientos.slice(0, 100).map((movimiento) => (
                        <tr key={movimiento.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm">{movimiento.fecha}</td>
                            <td className="px-4 py-3 text-sm">{movimiento.sucursalName}</td>
                            <td className="px-4 py-3 text-sm">
                                <span className="font-mono text-xs">{movimiento.accountCode}</span>
                                <br />
                                <span className="text-gray-600">{movimiento.accountName}</span>
                            </td>
                            <td className="px-4 py-3 text-sm">{movimiento.descripcion}</td>
                            <td className="px-4 py-3 text-sm font-mono">{movimiento.referencia}</td>
                            <td className="px-4 py-3 text-sm text-right">
                                {movimiento.tipo === 'DEBITO' ? formatCurrency(movimiento.monto) : '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-right">
                                {movimiento.tipo === 'CREDITO' ? formatCurrency(movimiento.monto) : '-'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {movimientos.length === 0 && (
                <div className="p-8 text-center text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>No hay movimientos en el perÃ­odo seleccionado</p>
                </div>
            )}
        </div>
    );

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <BarChart3 className="w-8 h-8 text-blue-600" />
                    Reportes Financieros
                </h1>
                <p className="text-gray-600 mt-1">
                    Genere reportes contables y financieros del sistema
                </p>
            </div>

            <div className="bg-white rounded-lg shadow p-4 mb-6">
                <div className="flex flex-wrap gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <Calendar className="w-4 h-4 inline mr-1" />
                            Fecha Desde
                        </label>
                        <input
                            type="date"
                            value={fechaDesde}
                            onChange={(e) => setFechaDesde(e.target.value)}
                            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <Calendar className="w-4 h-4 inline mr-1" />
                            Fecha Hasta
                        </label>
                        <input
                            type="date"
                            value={fechaHasta}
                            onChange={(e) => setFechaHasta(e.target.value)}
                            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <Building2 className="w-4 h-4 inline mr-1" />
                            Sucursal
                        </label>
                        <select
                            value={filtroSucursal}
                            onChange={(e) => setFiltroSucursal(e.target.value)}
                            className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[220px]"
                        >
                            <option value="">Todas las sucursales</option>
                            {sucursalesActivas.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                    {branch.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Actualizar
                    </button>
                </div>
            </div>

            <div className="flex gap-2 mb-6 border-b">
                <button
                    onClick={() => setActiveTab('estado')}
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${
                        activeTab === 'estado'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                    <TrendingUp className="w-4 h-4" />
                    Estado de Resultados
                </button>
                <button
                    onClick={() => setActiveTab('balance')}
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${
                        activeTab === 'balance'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                    <PieChart className="w-4 h-4" />
                    Balance General
                </button>
                <button
                    onClick={() => setActiveTab('movimientos')}
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${
                        activeTab === 'movimientos'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                    <FileText className="w-4 h-4" />
                    Movimientos
                </button>
            </div>

            {activeTab === 'estado' && renderEstadoResultados()}
            {activeTab === 'balance' && renderBalanceGeneral()}
            {activeTab === 'movimientos' && renderMovimientos()}

            {cuentaGastoDetalle && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">
                                    Gastos de {cuentaGastoDetalle.accountName}
                                </h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    {cuentaGastoDetalle.accountCode} · {cuentaGastoDetalle.movimientos.length} movimiento(s) · {formatCurrency(cuentaGastoDetalle.total)}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setCuentaGastoDetalle(null)}
                                className="p-2 hover:bg-slate-100 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-medium text-slate-700">Fecha</th>
                                            <th className="px-4 py-3 text-left font-medium text-slate-700">Sucursal</th>
                                            <th className="px-4 py-3 text-left font-medium text-slate-700">Descripción</th>
                                            <th className="px-4 py-3 text-left font-medium text-slate-700">Referencia</th>
                                            <th className="px-4 py-3 text-right font-medium text-slate-700">Monto</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {cuentaGastoDetalle.movimientos.map((movimiento) => (
                                            <tr key={movimiento.id} className="hover:bg-slate-50">
                                                <td className="px-4 py-3">{movimiento.fecha}</td>
                                                <td className="px-4 py-3">{movimiento.sucursalName}</td>
                                                <td className="px-4 py-3">{movimiento.descripcion}</td>
                                                <td className="px-4 py-3 font-mono">{movimiento.referencia}</td>
                                                <td className="px-4 py-3 text-right font-medium text-red-600">
                                                    {formatCurrency(movimiento.monto)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Reports;
