import React, { useEffect, useMemo, useState } from 'react';
import {
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    serverTimestamp,
    setDoc
} from 'firebase/firestore';
import {
    Archive,
    Boxes,
    Calendar,
    CheckCircle,
    RefreshCw,
    Save,
    Store,
    Trash2
} from 'lucide-react';
import { format, subMonths } from 'date-fns';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useBranches } from '../hooks/useBranches';

const currentPeriod = () => format(new Date(), 'yyyy-MM');
const toAmount = (value) => Number(value || 0);
const formatCurrency = (value) =>
    `C$ ${Number(value || 0).toLocaleString('es-NI', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
const periodLabel = (periodo) => {
    if (!periodo) return '-';
    const date = new Date(`${periodo}-01T12:00:00`);
    if (Number.isNaN(date.getTime())) return periodo;
    return new Intl.DateTimeFormat('es-NI', {
        month: 'long',
        year: 'numeric'
    }).format(date);
};
const previousPeriod = (periodo) => {
    if (!periodo) return '';
    const parsed = new Date(`${periodo}-01T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    return format(subMonths(parsed, 1), 'yyyy-MM');
};
const branchName = (branch) =>
    branch?.name || branch?.nombre || branch?.branchName || branch?.tienda || 'Sucursal';
const sortInventoryRecords = (records) => [...records].sort((left, right) => {
    const periodOrder = String(right.periodo || '').localeCompare(String(left.periodo || ''));
    if (periodOrder !== 0) return periodOrder;
    return String(left.sucursalName || '').localeCompare(String(right.sucursalName || ''));
});

const summaryCardStyles = [
    'bg-blue-50 text-blue-700',
    'bg-emerald-50 text-emerald-700',
    'bg-amber-50 text-amber-700',
    'bg-purple-50 text-purple-700'
];

const initialFormState = {
    inventarioInicial: '',
    inventarioFinal: '',
    observaciones: ''
};

const InventarioFisico = () => {
    const { user } = useAuth();
    const { branches, loading: loadingBranches } = useBranches();
    const sucursalesActivas = useMemo(
        () => branches.filter((branch) => branch.isActive !== false),
        [branches]
    );

    const [periodo, setPeriodo] = useState(currentPeriod());
    const [sucursalId, setSucursalId] = useState('');
    const [form, setForm] = useState(initialFormState);
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deletingRecordId, setDeletingRecordId] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [periodoFiltro, setPeriodoFiltro] = useState('');
    const [sucursalFiltro, setSucursalFiltro] = useState('');

    useEffect(() => {
        const unsubscribe = onSnapshot(collection(db, 'inventariosFisicosMensuales'), (snapshot) => {
            const data = snapshot.docs.map((docSnapshot) => ({
                id: docSnapshot.id,
                ...docSnapshot.data()
            }));
            setRecords(sortInventoryRecords(data));
            setLoading(false);
        }, (snapshotError) => {
            console.error('Error cargando inventarios fisicos:', snapshotError);
            setError('No se pudo cargar el inventario fisico mensual.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!sucursalesActivas.length || sucursalId) return;
        setSucursalId(sucursalesActivas[0].id);
    }, [sucursalId, sucursalesActivas]);

    const sucursalSeleccionada = useMemo(
        () => sucursalesActivas.find((branch) => branch.id === sucursalId) || null,
        [sucursalId, sucursalesActivas]
    );
    const currentRecordId = useMemo(
        () => (periodo && sucursalId ? `${periodo}__${sucursalId}` : ''),
        [periodo, sucursalId]
    );
    const previousRecordId = useMemo(() => {
        const prevPeriodo = previousPeriod(periodo);
        return prevPeriodo && sucursalId ? `${prevPeriodo}__${sucursalId}` : '';
    }, [periodo, sucursalId]);
    const currentRecord = useMemo(
        () => records.find((record) => record.id === currentRecordId) || null,
        [currentRecordId, records]
    );
    const previousMonthRecord = useMemo(
        () => records.find((record) => record.id === previousRecordId) || null,
        [previousRecordId, records]
    );

    useEffect(() => {
        if (!periodo || !sucursalId) return;
        setForm({
            inventarioInicial: currentRecord
                ? String(currentRecord.inventarioInicial ?? '')
                : previousMonthRecord
                    ? String(previousMonthRecord.inventarioFinal ?? '')
                    : '',
            inventarioFinal: currentRecord ? String(currentRecord.inventarioFinal ?? '') : '',
            observaciones: currentRecord?.observaciones || ''
        });
    }, [
        currentRecord?.id,
        currentRecord?.inventarioInicial,
        currentRecord?.inventarioFinal,
        currentRecord?.observaciones,
        periodo,
        previousMonthRecord?.id,
        previousMonthRecord?.inventarioFinal,
        sucursalId
    ]);

    const diferenciaInventario = useMemo(
        () => toAmount(form.inventarioInicial) - toAmount(form.inventarioFinal),
        [form.inventarioFinal, form.inventarioInicial]
    );

    const inventorySummary = useMemo(() => {
        const visibleRecords = records.filter((record) => {
            if (periodoFiltro && record.periodo !== periodoFiltro) return false;
            if (sucursalFiltro && record.sucursalId !== sucursalFiltro) return false;
            return true;
        });

        return visibleRecords.reduce((acc, record, index) => {
            acc.totalInicial += toAmount(record.inventarioInicial);
            acc.totalFinal += toAmount(record.inventarioFinal);
            acc.totalDiferencia += toAmount(record.diferenciaInventario);
            acc.count += 1;
            return acc;
        }, {
            totalInicial: 0,
            totalFinal: 0,
            totalDiferencia: 0,
            count: 0
        });
    }, [periodoFiltro, records, sucursalFiltro]);

    const recordsFiltrados = useMemo(() => records.filter((record) => {
        if (periodoFiltro && record.periodo !== periodoFiltro) return false;
        if (sucursalFiltro && record.sucursalId !== sucursalFiltro) return false;
        return true;
    }), [periodoFiltro, records, sucursalFiltro]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setSuccess('');

        if (!periodo || !sucursalSeleccionada) {
            setError('Debes seleccionar periodo y sucursal.');
            return;
        }

        if (toAmount(form.inventarioInicial) < 0 || toAmount(form.inventarioFinal) < 0) {
            setError('Los montos de inventario no pueden ser negativos.');
            return;
        }

        setSaving(true);

        try {
            const payload = {
                periodo,
                sucursalId: sucursalSeleccionada.id,
                sucursalName: branchName(sucursalSeleccionada),
                inventarioInicial: toAmount(form.inventarioInicial),
                inventarioFinal: toAmount(form.inventarioFinal),
                diferenciaInventario,
                observaciones: String(form.observaciones || '').trim(),
                updatedAt: serverTimestamp(),
                updatedBy: user?.email || ''
            };

            if (!currentRecord) {
                payload.createdAt = serverTimestamp();
                payload.createdBy = user?.email || '';
            }

            await setDoc(doc(db, 'inventariosFisicosMensuales', currentRecordId), payload, { merge: true });
            setSuccess(currentRecord
                ? 'Inventario fisico mensual actualizado correctamente.'
                : 'Inventario fisico mensual guardado correctamente.');
        } catch (saveError) {
            console.error('Error guardando inventario fisico:', saveError);
            setError('No se pudo guardar el inventario fisico mensual.');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteRecord = async (record) => {
        if (!record?.id) return;

        const confirmed = window.confirm(
            `¿Eliminar el inventario físico de ${record.sucursalName || 'la sucursal'} para ${periodLabel(record.periodo)}?`
        );

        if (!confirmed) return;

        setDeletingRecordId(record.id);
        setError('');
        setSuccess('');

        try {
            await deleteDoc(doc(db, 'inventariosFisicosMensuales', record.id));
            setSuccess('Inventario fisico mensual eliminado correctamente.');
        } catch (deleteError) {
            console.error('Error eliminando inventario fisico:', deleteError);
            setError('No se pudo eliminar el inventario fisico mensual.');
        } finally {
            setDeletingRecordId('');
        }
    };

    if (loading && !records.length) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <Archive className="w-8 h-8 text-blue-600" />
                        Inventario Fisico Mensual
                    </h1>
                    <p className="text-slate-600 mt-2">
                        Registra el inventario fisico inicial y final de cada sucursal para ajustar costos del mes.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                    {
                        title: 'Inventario Inicial',
                        value: formatCurrency(inventorySummary.totalInicial),
                        icon: Boxes
                    },
                    {
                        title: 'Inventario Final',
                        value: formatCurrency(inventorySummary.totalFinal),
                        icon: Store
                    },
                    {
                        title: 'Diferencia Inventario',
                        value: formatCurrency(inventorySummary.totalDiferencia),
                        icon: CalculatorIcon
                    },
                    {
                        title: 'Registros',
                        value: inventorySummary.count,
                        icon: Calendar
                    }
                ].map((card, index) => {
                    const Icon = card.icon;
                    return (
                        <div key={card.title} className={`rounded-xl p-4 ${summaryCardStyles[index]}`}>
                            <div className="flex items-center justify-between">
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

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-semibold text-slate-900 mb-4">Registrar Inventario del Mes</h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                    Periodo
                                </label>
                                <input
                                    type="month"
                                    value={periodo}
                                    onChange={(event) => {
                                        setPeriodo(event.target.value);
                                        setSuccess('');
                                        setError('');
                                    }}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                    Sucursal
                                </label>
                                <select
                                    value={sucursalId}
                                    onChange={(event) => {
                                        setSucursalId(event.target.value);
                                        setSuccess('');
                                        setError('');
                                    }}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    disabled={loadingBranches}
                                    required
                                >
                                    <option value="">Seleccione una sucursal...</option>
                                    {sucursalesActivas.map((branch) => (
                                        <option key={branch.id} value={branch.id}>
                                            {branchName(branch)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                            <p className="font-medium">
                                {currentRecord
                                    ? `Editando registro de ${periodLabel(periodo)} para ${sucursalSeleccionada ? branchName(sucursalSeleccionada) : 'la sucursal'}.`
                                    : `Registro nuevo para ${periodLabel(periodo)}.`}
                            </p>
                            <p className="mt-1">
                                {previousMonthRecord
                                    ? `El inventario inicial se propone con el inventario final de ${periodLabel(previousMonthRecord.periodo)}.`
                                    : 'Si no existe el mes anterior, puedes ingresar el inventario inicial manualmente.'}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                    Inventario Inicial C$
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.inventarioInicial}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        inventarioInicial: event.target.value
                                    }))}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="0.00"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                    Inventario Final C$
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.inventarioFinal}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev,
                                        inventarioFinal: event.target.value
                                    }))}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="0.00"
                                    required
                                />
                            </div>
                        </div>

                        <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium text-amber-800">Diferencia de Inventario</p>
                                    <p className="text-xs text-amber-700 mt-1">
                                        Formula: Inventario Inicial - Inventario Final
                                    </p>
                                </div>
                                <p className={`text-2xl font-bold ${diferenciaInventario >= 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                    {formatCurrency(diferenciaInventario)}
                                </p>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                Observaciones
                            </label>
                            <textarea
                                value={form.observaciones}
                                onChange={(event) => setForm((prev) => ({
                                    ...prev,
                                    observaciones: event.target.value
                                }))}
                                rows={4}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Comentarios del conteo fisico, mermas, ajustes o incidencias..."
                            />
                        </div>

                        {error && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                {error}
                            </div>
                        )}

                        {success && (
                            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 flex items-center gap-2">
                                <CheckCircle className="w-4 h-4" />
                                {success}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 disabled:opacity-60"
                            disabled={saving || !currentRecordId}
                        >
                            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {currentRecord ? 'Actualizar Inventario' : 'Guardar Inventario'}
                        </button>
                    </form>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">Historial Mensual</h2>
                            <p className="text-sm text-slate-500">
                                Puedes revisar por sucursal o por periodo para validar el ajuste que entrara a reportes.
                            </p>
                        </div>
                        <div className="flex flex-col md:flex-row gap-3">
                            <input
                                type="month"
                                value={periodoFiltro}
                                onChange={(event) => setPeriodoFiltro(event.target.value)}
                                className="rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <select
                                value={sucursalFiltro}
                                onChange={(event) => setSucursalFiltro(event.target.value)}
                                className="rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Todas las sucursales</option>
                                {sucursalesActivas.map((branch) => (
                                    <option key={branch.id} value={branch.id}>
                                        {branchName(branch)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-4 py-3 text-left font-medium text-slate-700">Periodo</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-700">Sucursal</th>
                                    <th className="px-4 py-3 text-right font-medium text-slate-700">Inicial</th>
                                    <th className="px-4 py-3 text-right font-medium text-slate-700">Final</th>
                                    <th className="px-4 py-3 text-right font-medium text-slate-700">Diferencia</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-700">Observaciones</th>
                                    <th className="px-4 py-3 text-center font-medium text-slate-700">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {recordsFiltrados.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                                            No hay inventarios fisicos registrados para el filtro seleccionado.
                                        </td>
                                    </tr>
                                ) : recordsFiltrados.map((record) => (
                                    <tr
                                        key={record.id}
                                        className={`hover:bg-slate-50 ${record.id === currentRecordId ? 'bg-blue-50/60' : ''}`}
                                    >
                                        <td className="px-4 py-3 font-medium text-slate-800 capitalize">
                                            {periodLabel(record.periodo)}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{record.sucursalName || 'Sucursal'}</td>
                                        <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(record.inventarioInicial)}</td>
                                        <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(record.inventarioFinal)}</td>
                                        <td className={`px-4 py-3 text-right font-semibold ${toAmount(record.diferenciaInventario) >= 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                            {formatCurrency(record.diferenciaInventario)}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 max-w-xs">
                                            <div className="truncate" title={record.observaciones || ''}>
                                                {record.observaciones || '-'}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteRecord(record)}
                                                className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                disabled={deletingRecordId === record.id}
                                            >
                                                {deletingRecordId === record.id ? (
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="w-4 h-4" />
                                                )}
                                                Eliminar
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CalculatorIcon = ({ className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <line x1="8" y1="6" x2="16" y2="6" />
        <line x1="8" y1="10" x2="8" y2="10" />
        <line x1="12" y1="10" x2="12" y2="10" />
        <line x1="16" y1="10" x2="16" y2="10" />
        <line x1="8" y1="14" x2="8" y2="14" />
        <line x1="12" y1="14" x2="12" y2="14" />
        <line x1="16" y1="14" x2="16" y2="18" />
        <line x1="8" y1="18" x2="12" y2="18" />
    </svg>
);

export default InventarioFisico;
