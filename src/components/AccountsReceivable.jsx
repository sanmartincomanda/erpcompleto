import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
    AlertTriangle,
    CheckCircle2,
    CreditCard,
    DollarSign,
    FileSpreadsheet,
    Info,
    RefreshCw,
    Search,
    Users,
    Wallet
} from 'lucide-react';
import { db } from '../firebase';
import { usePlanCuentas } from '../hooks/useUnifiedAccounting';
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
    toJsDate,
    toNumber
} from '../utils/erpMirrorUtils';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const statusStyles = {
    pendiente: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    parcial: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    vencida: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    pagada: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    anulada: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
};

const sourceStyles = {
    SICAR: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    Manual: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
};

const summaryStyles = [
    'bg-emerald-50 text-emerald-700',
    'bg-rose-50 text-rose-700',
    'bg-blue-50 text-blue-700',
    'bg-slate-100 text-slate-700'
];

const agingStyles = {
    alDia: 'bg-emerald-50 text-emerald-700',
    d1_7: 'bg-amber-50 text-amber-700',
    d8_15: 'bg-orange-50 text-orange-700',
    d16_30: 'bg-rose-50 text-rose-700',
    d31mas: 'bg-slate-800 text-white'
};

const getDateOnly = (value) => {
    const parsed = toJsDate(value);
    if (!parsed) return null;

    const normalized = new Date(parsed);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
};

const getDaysPastDue = (dueDate) => {
    const due = getDateOnly(dueDate);
    if (!due) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diff = Math.floor((today.getTime() - due.getTime()) / DAY_IN_MS);
    return diff > 0 ? diff : 0;
};

const getDaysToDue = (dueDate) => {
    const due = getDateOnly(dueDate);
    if (!due) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Math.floor((due.getTime() - today.getTime()) / DAY_IN_MS);
};

const buildClientKey = (record) => (
    record?.clienteId ||
    record?.clienteCodigo ||
    record?.clienteNombre ||
    record?.id
);

const getPortfolioStatus = (documento) => {
    const rawState = String(documento?.estado || '').toLowerCase();

    if (documento?.cancelado || rawState === 'anulado' || rawState === 'anulada') {
        return 'anulada';
    }

    if (toNumber(documento?.saldoPendiente) <= 0.01) {
        return 'pagada';
    }

    if (getDaysPastDue(documento?.fechaVencimiento) > 0) {
        return 'vencida';
    }

    if (rawState === 'parcial') {
        return 'parcial';
    }

    return 'pendiente';
};

const getAgingBucketKey = (documento) => {
    const status = getPortfolioStatus(documento);
    if (['anulada', 'pagada'].includes(status)) return null;

    const daysPastDue = getDaysPastDue(documento.fechaVencimiento);
    if (daysPastDue <= 0) return 'alDia';
    if (daysPastDue <= 7) return 'd1_7';
    if (daysPastDue <= 15) return 'd8_15';
    if (daysPastDue <= 30) return 'd16_30';
    return 'd31mas';
};

const formatDaysBadge = (documento) => {
    const status = getPortfolioStatus(documento);
    if (status === 'pagada') return 'Pagada';
    if (status === 'anulada') return 'Anulada';

    const daysPastDue = getDaysPastDue(documento.fechaVencimiento);
    if (daysPastDue > 0) return `${daysPastDue} dias vencida`;

    const daysToDue = getDaysToDue(documento.fechaVencimiento);
    if (daysToDue === null) return 'Sin fecha';
    if (daysToDue === 0) return 'Vence hoy';
    return `${daysToDue} dias por vencer`;
};

const AccountsReceivable = () => {
    const { getClientesAccount } = usePlanCuentas();
    const [creditos, setCreditos] = useState([]);
    const [abonos, setAbonos] = useState([]);
    const [clientes, setClientes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('abiertas');
    const [sourceFilter, setSourceFilter] = useState('sicar');
    const [selectedClientKey, setSelectedClientKey] = useState('all');

    useEffect(() => {
        setLoading(true);
        const readyState = { creditos: false, abonos: false, clientes: false };

        const markReady = (key) => {
            readyState[key] = true;
            if (Object.values(readyState).every(Boolean)) {
                setLoading(false);
            }
        };

        const unsubCreditos = onSnapshot(
            query(collection(db, 'cuentasPorCobrar'), orderBy('fechaEmision', 'desc')),
            (snapshot) => {
                setCreditos(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
                markReady('creditos');
            },
            (error) => {
                console.error('Error cargando cuentas por cobrar:', error);
                markReady('creditos');
            }
        );

        const unsubAbonos = onSnapshot(
            query(collection(db, 'abonosClientes'), orderBy('fecha', 'desc')),
            (snapshot) => {
                setAbonos(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
                markReady('abonos');
            },
            (error) => {
                console.error('Error cargando abonos de clientes:', error);
                markReady('abonos');
            }
        );

        const unsubClientes = onSnapshot(
            query(collection(db, 'clientes'), orderBy('nombre')),
            (snapshot) => {
                setClientes(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
                markReady('clientes');
            },
            (error) => {
                console.error('Error cargando clientes:', error);
                markReady('clientes');
            }
        );

        return () => {
            unsubCreditos();
            unsubAbonos();
            unsubClientes();
        };
    }, []);

    const cuentaClientes = getClientesAccount();

    const clientesMap = useMemo(
        () => new Map(clientes.map((cliente) => [cliente.id, cliente])),
        [clientes]
    );

    const creditosNormalizados = useMemo(() => {
        const rows = creditos.map((credito) => {
            const cliente = clientesMap.get(credito.clienteId);
            const montoOriginal = toNumber(credito.montoOriginal || credito.monto);
            const montoAbonado = toNumber(credito.montoAbonado);
            const saldoPendiente = toNumber(credito.saldoPendiente);
            const portfolioStatus = getPortfolioStatus(credito);
            const clientKey = buildClientKey({
                ...credito,
                clienteNombre: credito.clienteNombre || cliente?.nombre,
                clienteCodigo: credito.clienteCodigo || cliente?.codigo
            });

            return {
                ...credito,
                clientKey,
                clienteNombre: credito.clienteNombre || cliente?.nombre || 'Cliente',
                clienteCodigo: credito.clienteCodigo || cliente?.codigo || '-',
                clienteTelefono: credito.clienteTelefono || cliente?.telefono || '',
                clienteEmail: credito.clienteEmail || cliente?.email || '',
                clienteComentario: credito.clienteComentario || cliente?.comentario || '',
                limiteCreditoCliente: toNumber(credito.limiteCreditoCliente || cliente?.limiteCredito),
                diasCreditoCliente: toNumber(credito.diasCreditoCliente || cliente?.plazoDias),
                montoOriginal,
                montoAbonado,
                saldoPendiente,
                portfolioStatus,
                sourceLabel: sourceLabel(credito),
                sourceKind: sourceKind(credito),
                daysPastDue: getDaysPastDue(credito.fechaVencimiento),
                daysToDue: getDaysToDue(credito.fechaVencimiento),
                agingBucket: getAgingBucketKey(credito),
                daysLabel: formatDaysBadge(credito)
            };
        });

        return sortByDateDesc(rows, 'fechaEmision', 'lastSeenAt');
    }, [creditos, clientesMap]);

    const abonosNormalizados = useMemo(() => {
        const rows = abonos.map((abono) => {
            const cliente = clientesMap.get(abono.clienteId);
            return {
                ...abono,
                clientKey: buildClientKey({
                    ...abono,
                    clienteNombre: abono.clienteNombre || cliente?.nombre,
                    clienteCodigo: abono.clienteCodigo || cliente?.codigo
                }),
                clienteNombre: abono.clienteNombre || cliente?.nombre || 'Cliente',
                clienteCodigo: abono.clienteCodigo || cliente?.codigo || '-',
                montoTotal: toNumber(abono.montoTotal),
                montoAplicado: toNumber(abono.montoAplicado),
                sourceLabel: sourceLabel(abono),
                sourceKind: sourceKind(abono)
            };
        });

        return sortByDateDesc(rows, 'fecha', 'lastSeenAt');
    }, [abonos, clientesMap]);

    const creditosFiltrados = useMemo(() => creditosNormalizados.filter((credito) => {
        if (sourceFilter !== 'todas' && credito.sourceKind !== sourceFilter) {
            return false;
        }

        if (statusFilter === 'abiertas' && ['pagada', 'anulada'].includes(credito.portfolioStatus)) {
            return false;
        }

        if (statusFilter !== 'todas' && statusFilter !== 'abiertas' && credito.portfolioStatus !== statusFilter) {
            return false;
        }

        return matchSearch(searchTerm, [
            credito.clienteNombre,
            credito.clienteCodigo,
            credito.numeroDocumento,
            credito.folioSicar,
            credito.cuentaContableCode,
            credito.comentarioSicar
        ]);
    }), [creditosNormalizados, searchTerm, sourceFilter, statusFilter]);

    const abonosFiltrados = useMemo(() => abonosNormalizados.filter((abono) => {
        if (sourceFilter !== 'todas' && abono.sourceKind !== sourceFilter) {
            return false;
        }

        return matchSearch(searchTerm, [
            abono.clienteNombre,
            abono.clienteCodigo,
            abono.numeroDocumento,
            abono.referencia,
            abono.comentarioSicar
        ]);
    }), [abonosNormalizados, searchTerm, sourceFilter]);

    const resumenGeneral = useMemo(() => creditosFiltrados.reduce((acc, credito) => {
        acc.documentos += 1;
        acc.totalOriginal += credito.montoOriginal;
        acc.totalAbonado += credito.montoAbonado;
        acc.totalPendiente += credito.saldoPendiente;

        if (credito.portfolioStatus === 'vencida') {
            acc.totalVencido += credito.saldoPendiente;
        }

        if (!['pagada', 'anulada'].includes(credito.portfolioStatus)) {
            acc.documentosAbiertos += 1;
        }

        return acc;
    }, {
        documentos: 0,
        documentosAbiertos: 0,
        totalOriginal: 0,
        totalAbonado: 0,
        totalPendiente: 0,
        totalVencido: 0
    }), [creditosFiltrados]);

    const agingSummary = useMemo(() => creditosFiltrados.reduce((acc, credito) => {
        const bucket = credito.agingBucket;
        if (!bucket) return acc;
        acc[bucket] += credito.saldoPendiente;
        return acc;
    }, {
        alDia: 0,
        d1_7: 0,
        d8_15: 0,
        d16_30: 0,
        d31mas: 0
    }), [creditosFiltrados]);

    const clientSummaries = useMemo(() => {
        const grouped = new Map();

        creditosFiltrados.forEach((credito) => {
            const key = credito.clientKey;
            const current = grouped.get(key) || {
                key,
                clienteId: credito.clienteId,
                clienteNombre: credito.clienteNombre,
                clienteCodigo: credito.clienteCodigo,
                clienteTelefono: credito.clienteTelefono,
                clienteEmail: credito.clienteEmail,
                clienteComentario: credito.clienteComentario,
                limiteCreditoCliente: credito.limiteCreditoCliente,
                diasCreditoCliente: credito.diasCreditoCliente,
                totalOriginal: 0,
                totalAbonado: 0,
                totalPendiente: 0,
                totalVencido: 0,
                documentos: 0,
                documentosAbiertos: 0,
                ultimoVencimiento: '',
                ultimaVenta: '',
                ultimoAbonoFecha: '',
                ultimoAbonoMonto: 0
            };

            current.totalOriginal += credito.montoOriginal;
            current.totalAbonado += credito.montoAbonado;
            current.totalPendiente += credito.saldoPendiente;
            current.documentos += 1;

            if (!['pagada', 'anulada'].includes(credito.portfolioStatus)) {
                current.documentosAbiertos += 1;
            }

            if (credito.portfolioStatus === 'vencida') {
                current.totalVencido += credito.saldoPendiente;
            }

            if (!current.ultimoVencimiento || (getDateOnly(credito.fechaVencimiento)?.getTime() || 0) < (getDateOnly(current.ultimoVencimiento)?.getTime() || Number.MAX_SAFE_INTEGER)) {
                current.ultimoVencimiento = credito.fechaVencimiento || current.ultimoVencimiento;
            }

            if ((toJsDate(credito.fechaEmision)?.getTime() || 0) > (toJsDate(current.ultimaVenta)?.getTime() || 0)) {
                current.ultimaVenta = credito.fechaEmision || current.ultimaVenta;
            }

            grouped.set(key, current);
        });

        abonosFiltrados.forEach((abono) => {
            const current = grouped.get(abono.clientKey);
            if (!current) return;

            const abonoTime = toJsDate(abono.fecha)?.getTime() || 0;
            const currentTime = toJsDate(current.ultimoAbonoFecha)?.getTime() || 0;
            if (abonoTime >= currentTime) {
                current.ultimoAbonoFecha = abono.fecha;
                current.ultimoAbonoMonto = abono.montoTotal;
            }
        });

        return [...grouped.values()].sort((left, right) => {
            if (right.totalPendiente !== left.totalPendiente) {
                return right.totalPendiente - left.totalPendiente;
            }

            return String(left.clienteNombre || '').localeCompare(String(right.clienteNombre || ''));
        });
    }, [abonosFiltrados, creditosFiltrados]);

    useEffect(() => {
        if (selectedClientKey === 'all') return;
        if (!clientSummaries.some((item) => item.key === selectedClientKey)) {
            setSelectedClientKey('all');
        }
    }, [clientSummaries, selectedClientKey]);

    const selectedClient = useMemo(
        () => clientSummaries.find((item) => item.key === selectedClientKey) || null,
        [clientSummaries, selectedClientKey]
    );

    const creditosVisibles = useMemo(() => (
        selectedClientKey === 'all'
            ? creditosFiltrados
            : creditosFiltrados.filter((credito) => credito.clientKey === selectedClientKey)
    ), [creditosFiltrados, selectedClientKey]);

    const abonosVisibles = useMemo(() => (
        selectedClientKey === 'all'
            ? abonosFiltrados
            : abonosFiltrados.filter((abono) => abono.clientKey === selectedClientKey)
    ), [abonosFiltrados, selectedClientKey]);

    const summaryCards = [
        {
            title: 'Saldo abierto',
            value: formatCurrency(resumenGeneral.totalPendiente),
            icon: Wallet
        },
        {
            title: 'Saldo vencido',
            value: formatCurrency(resumenGeneral.totalVencido),
            icon: AlertTriangle
        },
        {
            title: 'Cobrado',
            value: formatCurrency(resumenGeneral.totalAbonado),
            icon: CheckCircle2
        },
        {
            title: 'Documentos abiertos',
            value: resumenGeneral.documentosAbiertos,
            icon: FileSpreadsheet
        }
    ];

    const agingCards = [
        { key: 'alDia', label: 'Al dia' },
        { key: 'd1_7', label: '1-7 dias' },
        { key: 'd8_15', label: '8-15 dias' },
        { key: 'd16_30', label: '16-30 dias' },
        { key: 'd31mas', label: '31+ dias' }
    ];

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                            <Users className="w-7 h-7" />
                        </div>
                        Cartera de Cobro
                    </h1>
                    <p className="mt-2 text-slate-600">
                        Espejo de SICAR en solo lectura para {GRANADA_BRANCH_NAME}. Esta vista no aplica cobros ni modifica MySQL; solo consume lo importado desde SICAR.
                    </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                        <p className="font-semibold">Cuenta ligada al ERP</p>
                        <p className="mt-1">
                            {cuentaClientes
                                ? `${cuentaClientes.code} - ${cuentaClientes.name}`
                                : 'La cuenta 110301 no esta disponible en planCuentas.'}
                        </p>
                    </div>
                    <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                        <div className="flex items-start gap-3">
                            <Info className="w-5 h-5 mt-0.5 text-blue-700" />
                            <div>
                                <p className="font-semibold">Regla de integracion</p>
                                <p className="mt-1">SICAR es fuente de consulta. El ERP puede reflejar, agrupar y analizar, pero nunca alterar la cartera original.</p>
                            </div>
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

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                {agingCards.map((card) => (
                    <div key={card.key} className={`rounded-2xl px-4 py-3 ${agingStyles[card.key]}`}>
                        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{card.label}</p>
                        <p className="mt-2 text-xl font-bold">{formatCurrency(agingSummary[card.key])}</p>
                    </div>
                ))}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">Consulta de cartera</h2>
                        <p className="text-sm text-slate-500">
                            Filtra la cartera espejo y luego entra a un cliente para revisar documentos, antiguedad y abonos.
                        </p>
                    </div>

                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="relative min-w-[260px]">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Buscar cliente, folio o comentario"
                                className="w-full rounded-xl border border-slate-300 pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value)}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                            <option value="abiertas">Solo abiertas</option>
                            <option value="todas">Todos los estados</option>
                            <option value="pendiente">Pendientes</option>
                            <option value="parcial">Parciales</option>
                            <option value="vencida">Vencidas</option>
                            <option value="pagada">Pagadas</option>
                            <option value="anulada">Anuladas</option>
                        </select>
                        <select
                            value={sourceFilter}
                            onChange={(event) => setSourceFilter(event.target.value)}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                            <option value="sicar">SICAR</option>
                            <option value="todas">Todas las fuentes</option>
                            <option value="manual">Manual</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-200">
                        <button
                            type="button"
                            onClick={() => setSelectedClientKey('all')}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                                selectedClientKey === 'all'
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                            }`}
                        >
                            <p className="text-sm font-semibold">Toda la cartera</p>
                            <p className="mt-1 text-xs opacity-80">
                                {clientSummaries.length} clientes visibles, {formatCurrency(resumenGeneral.totalPendiente)} pendientes.
                            </p>
                        </button>
                    </div>

                    <div className="max-h-[760px] overflow-y-auto">
                        {loading ? (
                            <div className="px-4 py-10 text-center">
                                <RefreshCw className="w-7 h-7 animate-spin text-emerald-600 mx-auto" />
                            </div>
                        ) : !clientSummaries.length ? (
                            <div className="px-4 py-10 text-center text-sm text-slate-500">
                                No hay clientes que coincidan con los filtros.
                            </div>
                        ) : clientSummaries.map((cliente) => (
                            <button
                                key={cliente.key}
                                type="button"
                                onClick={() => setSelectedClientKey(cliente.key)}
                                className={`w-full px-4 py-4 text-left border-b border-slate-100 transition-colors ${
                                    selectedClientKey === cliente.key ? 'bg-emerald-50' : 'hover:bg-slate-50'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-slate-900 truncate">{cliente.clienteNombre}</p>
                                        <p className="text-xs text-slate-500 mt-1">{cliente.clienteCodigo}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-semibold text-slate-900">{formatCurrency(cliente.totalPendiente)}</p>
                                        <p className="text-xs text-slate-500">{cliente.documentosAbiertos} abiertos</p>
                                    </div>
                                </div>
                                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                                    <span>{cliente.totalVencido > 0 ? `${formatCurrency(cliente.totalVencido)} vencido` : 'Sin vencidos'}</span>
                                    <span>{cliente.ultimoAbonoFecha ? `Ult. abono ${formatShortDate(cliente.ultimoAbonoFecha)}` : 'Sin abonos'}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-6">
                    {selectedClient && (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <h2 className="text-xl font-semibold text-slate-900">{selectedClient.clienteNombre}</h2>
                                    <p className="text-sm text-slate-500 mt-1">
                                        {selectedClient.clienteCodigo} {selectedClient.clienteTelefono ? `· ${selectedClient.clienteTelefono}` : ''} {selectedClient.clienteEmail ? `· ${selectedClient.clienteEmail}` : ''}
                                    </p>
                                    {selectedClient.clienteComentario && (
                                        <p className="mt-3 text-sm text-slate-600">{selectedClient.clienteComentario}</p>
                                    )}
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                                        <p className="text-xs uppercase tracking-wide text-slate-500">Saldo abierto</p>
                                        <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(selectedClient.totalPendiente)}</p>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                                        <p className="text-xs uppercase tracking-wide text-slate-500">Credito / plazo</p>
                                        <p className="mt-1 text-lg font-semibold text-slate-900">
                                            {selectedClient.limiteCreditoCliente > 0 ? formatCurrency(selectedClient.limiteCreditoCliente) : 'Sin limite'}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1">{selectedClient.diasCreditoCliente || 0} dias</p>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50 px-4 py-3">
                                        <p className="text-xs uppercase tracking-wide text-slate-500">Ultimo abono</p>
                                        <p className="mt-1 text-lg font-semibold text-slate-900">
                                            {selectedClient.ultimoAbonoMonto > 0 ? formatCurrency(selectedClient.ultimoAbonoMonto) : 'Sin abono'}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1">
                                            {selectedClient.ultimoAbonoFecha ? formatShortDate(selectedClient.ultimoAbonoFecha) : 'Sin fecha'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-5 border-b border-slate-200">
                            <h2 className="text-lg font-semibold text-slate-900">Documentos de cartera</h2>
                            <p className="text-sm text-slate-500">
                                {selectedClient
                                    ? `Documentos visibles para ${selectedClient.clienteNombre}.`
                                    : 'Vista global de la cartera filtrada.'}
                            </p>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1180px] text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Documento</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Cliente</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Vence</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Dias</th>
                                        <th className="px-4 py-3 text-right font-medium text-slate-600">Original</th>
                                        <th className="px-4 py-3 text-right font-medium text-slate-600">Abonado</th>
                                        <th className="px-4 py-3 text-right font-medium text-slate-600">Saldo</th>
                                        <th className="px-4 py-3 text-center font-medium text-slate-600">Estado</th>
                                        <th className="px-4 py-3 text-center font-medium text-slate-600">Fuente</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    {loading ? (
                                        <tr>
                                            <td colSpan={10} className="px-4 py-10 text-center">
                                                <RefreshCw className="w-7 h-7 animate-spin text-emerald-600 mx-auto" />
                                            </td>
                                        </tr>
                                    ) : !creditosVisibles.length ? (
                                        <tr>
                                            <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                                                No hay documentos para los filtros seleccionados.
                                            </td>
                                        </tr>
                                    ) : creditosVisibles.map((credito) => (
                                        <tr key={credito.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-slate-600">
                                                <div>{formatShortDate(credito.fechaEmision)}</div>
                                                <div className="text-xs text-slate-500">{formatDateTime(credito.fechaVentaHora || credito.fechaEmision)}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-slate-900">{credito.numeroDocumento || credito.documentoId}</div>
                                                <div className="text-xs text-slate-500">
                                                    {credito.sourceCajaName || GRANADA_BRANCH_NAME}
                                                    {credito.comentarioSicar ? ` · ${credito.comentarioSicar}` : ''}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-slate-900">{credito.clienteNombre}</div>
                                                <div className="text-xs text-slate-500">{credito.clienteCodigo}</div>
                                            </td>
                                            <td className="px-4 py-3 text-slate-600">{formatShortDate(credito.fechaVencimiento)}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                                    credito.portfolioStatus === 'vencida'
                                                        ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                                                        : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
                                                }`}>
                                                    {credito.daysLabel}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-medium text-slate-900">{formatCurrency(credito.montoOriginal)}</td>
                                            <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(credito.montoAbonado)}</td>
                                            <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(credito.saldoPendiente)}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[credito.portfolioStatus]}`}>
                                                    {credito.portfolioStatus === 'vencida'
                                                        ? 'Vencida'
                                                        : credito.portfolioStatus === 'parcial'
                                                            ? 'Parcial'
                                                            : credito.portfolioStatus === 'pagada'
                                                                ? 'Pagada'
                                                                : credito.portfolioStatus === 'anulada'
                                                                    ? 'Anulada'
                                                                    : 'Pendiente'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${sourceStyles[credito.sourceLabel]}`}>
                                                    {credito.sourceLabel}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_340px] gap-6">
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                            <div className="flex items-center gap-2">
                                <DollarSign className="w-5 h-5 text-emerald-600" />
                                <h2 className="text-lg font-semibold text-slate-900">Abonos recientes</h2>
                            </div>
                            <p className="text-sm text-slate-500 mt-1">
                                {selectedClient ? `Cobros reflejados para ${selectedClient.clienteNombre}.` : 'Cobros visibles para toda la cartera filtrada.'}
                            </p>

                            <div className="mt-4 space-y-3">
                                {!abonosVisibles.length ? (
                                    <p className="text-sm text-slate-500">Todavia no hay abonos visibles.</p>
                                ) : abonosVisibles.slice(0, 10).map((abono) => (
                                    <div key={abono.id} className="rounded-2xl border border-slate-200 px-4 py-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-medium text-slate-900">{abono.clienteNombre}</p>
                                                <p className="text-xs text-slate-500 mt-1">
                                                    {formatShortDate(abono.fecha)} · {paymentMethodLabel(abono.metodoPago)}
                                                </p>
                                                <p className="text-xs text-slate-500 mt-1">
                                                    {abono.numeroDocumento || abono.documentoId}
                                                    {abono.referencia ? ` · ${abono.referencia}` : ''}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-semibold text-emerald-700">{formatCurrency(abono.montoTotal)}</p>
                                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium mt-2 ${sourceStyles[abono.sourceLabel]}`}>
                                                    {abono.sourceLabel}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                                <div className="flex items-center gap-2">
                                    <CreditCard className="w-5 h-5 text-blue-600" />
                                    <h2 className="text-lg font-semibold text-slate-900">Lectura contable</h2>
                                </div>
                                <p className="text-sm text-slate-500 mt-1">
                                    Todo lo que entra desde SICAR sigue ligado a la cuenta 110301 del ERP.
                                </p>
                                <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
                                    <p className="text-sm font-medium text-slate-900">
                                        {cuentaClientes
                                            ? `${cuentaClientes.code} - ${cuentaClientes.name}`
                                            : '110301 no disponible'}
                                    </p>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                                <h2 className="text-lg font-semibold text-slate-900">Como opera esta cartera</h2>
                                <div className="mt-4 space-y-3 text-sm text-slate-600">
                                    <p>Las ventas a credito nacen en SICAR, se espejan en Firebase y aqui solo se consultan.</p>
                                    <p>Los abonos se muestran por separado para que puedas ver el historial sin tocar el credito original.</p>
                                    <p>La antiguedad se calcula contra la fecha de vencimiento real importada desde `creditocliente.fechaLimite`.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AccountsReceivable;
