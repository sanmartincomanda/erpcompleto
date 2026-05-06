import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
    AlertTriangle,
    CheckCircle2,
    CreditCard,
    DollarSign,
    FileSpreadsheet,
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
    formatShortDate,
    matchSearch,
    paymentMethodLabel,
    sourceLabel,
    sortByDateDesc,
    toJsDate,
    toNumber
} from '../utils/erpMirrorUtils';

const statusStyles = {
    pendiente: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    vencida: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    pagada: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    anulada: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
};

const sourceStyles = {
    SICAR: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    Manual: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
};

const cardStyles = [
    'bg-blue-50 text-blue-700',
    'bg-amber-50 text-amber-700',
    'bg-emerald-50 text-emerald-700',
    'bg-rose-50 text-rose-700'
];

const calculateDocumentStatus = (documento) => {
    if (documento?.cancelado || ['anulado', 'cancelada'].includes(String(documento?.estado || '').toLowerCase())) {
        return 'anulada';
    }

    if (toNumber(documento?.saldoPendiente) <= 0.01) {
        return 'pagada';
    }

    const dueDate = toJsDate(documento?.fechaVencimiento);
    if (dueDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dueDate.getTime() < today.getTime()) {
            return 'vencida';
        }
    }

    return 'pendiente';
};

const AccountsReceivable = () => {
    const { getClientesAccount } = usePlanCuentas();
    const [creditos, setCreditos] = useState([]);
    const [abonos, setAbonos] = useState([]);
    const [clientes, setClientes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('todas');
    const [sourceFilter, setSourceFilter] = useState('todas');

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
            const saldoPendiente = toNumber(credito.saldoPendiente);
            const montoOriginal = toNumber(credito.montoOriginal || credito.monto);
            const montoAbonado = toNumber(credito.montoAbonado);
            const status = calculateDocumentStatus(credito);

            return {
                ...credito,
                clienteNombre: credito.clienteNombre || cliente?.nombre || 'Cliente',
                clienteCodigo: credito.clienteCodigo || cliente?.codigo || '-',
                montoOriginal,
                montoAbonado,
                saldoPendiente,
                status,
                sourceLabel: sourceLabel(credito)
            };
        });

        return sortByDateDesc(rows, 'fechaEmision', 'lastSeenAt');
    }, [creditos, clientesMap]);

    const creditosFiltrados = useMemo(() => creditosNormalizados.filter((credito) => {
        if (statusFilter !== 'todas' && credito.status !== statusFilter) {
            return false;
        }

        if (sourceFilter !== 'todas' && credito.sourceLabel.toLowerCase() !== sourceFilter) {
            return false;
        }

        return matchSearch(searchTerm, [
            credito.clienteNombre,
            credito.clienteCodigo,
            credito.numeroDocumento,
            credito.cuentaContableCode
        ]);
    }), [creditosNormalizados, searchTerm, sourceFilter, statusFilter]);

    const abonosNormalizados = useMemo(() => {
        const rows = abonos.map((abono) => ({
            ...abono,
            clienteNombre: abono.clienteNombre || clientesMap.get(abono.clienteId)?.nombre || 'Cliente',
            montoTotal: toNumber(abono.montoTotal),
            montoAplicado: toNumber(abono.montoAplicado),
            sourceLabel: sourceLabel(abono)
        }));

        return sortByDateDesc(rows, 'fecha', 'lastSeenAt');
    }, [abonos, clientesMap]);

    const resumen = useMemo(() => creditosFiltrados.reduce((acc, credito) => {
        acc.documentos += 1;
        acc.totalOriginal += credito.montoOriginal;
        acc.totalAbonado += credito.montoAbonado;
        acc.totalPendiente += credito.saldoPendiente;

        if (credito.status === 'vencida') {
            acc.totalVencido += credito.saldoPendiente;
        }

        if (credito.status === 'pagada') {
            acc.documentosPagados += 1;
        }

        return acc;
    }, {
        documentos: 0,
        documentosPagados: 0,
        totalOriginal: 0,
        totalAbonado: 0,
        totalPendiente: 0,
        totalVencido: 0
    }), [creditosFiltrados]);

    const clientesConSaldo = useMemo(() => {
        const grouped = new Map();

        creditosFiltrados.forEach((credito) => {
            const key = credito.clienteId || credito.clienteNombre;
            const current = grouped.get(key) || {
                clienteId: credito.clienteId,
                clienteNombre: credito.clienteNombre,
                clienteCodigo: credito.clienteCodigo,
                saldoPendiente: 0
            };

            current.saldoPendiente += credito.saldoPendiente;
            grouped.set(key, current);
        });

        return [...grouped.values()]
            .filter((item) => item.saldoPendiente > 0.01)
            .sort((left, right) => right.saldoPendiente - left.saldoPendiente)
            .slice(0, 5);
    }, [creditosFiltrados]);

    const summaryCards = [
        {
            title: 'Cartera pendiente',
            value: formatCurrency(resumen.totalPendiente),
            icon: Wallet
        },
        {
            title: 'Saldo vencido',
            value: formatCurrency(resumen.totalVencido),
            icon: AlertTriangle
        },
        {
            title: 'Abonado',
            value: formatCurrency(resumen.totalAbonado),
            icon: CheckCircle2
        },
        {
            title: 'Documentos',
            value: resumen.documentos,
            icon: FileSpreadsheet
        }
    ];

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                            <Users className="w-7 h-7" />
                        </div>
                        Cuentas por Cobrar
                    </h1>
                    <p className="mt-2 text-slate-600">
                        Espejo de SICAR y registros manuales sobre la cuenta 110301 para {GRANADA_BRANCH_NAME}.
                    </p>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 max-w-md">
                    <p className="font-semibold">Cuenta vinculada al ERP</p>
                    <p className="mt-1">
                        {cuentaClientes
                            ? `${cuentaClientes.code} - ${cuentaClientes.name}`
                            : 'La cuenta 110301 no esta disponible en planCuentas.'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {summaryCards.map((card, index) => {
                    const Icon = card.icon;
                    return (
                        <div key={card.title} className={`rounded-2xl p-4 ${cardStyles[index]}`}>
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

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-5 border-b border-slate-200 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">Documentos por cobrar</h2>
                            <p className="text-sm text-slate-500">
                                Todo lo que se refleja desde SICAR cae a 110301 y se puede conciliar desde aqui.
                            </p>
                        </div>

                        <div className="flex flex-col md:flex-row gap-3">
                            <div className="relative min-w-[260px]">
                                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                    placeholder="Buscar cliente o documento"
                                    className="w-full rounded-xl border border-slate-300 pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                            <select
                                value={statusFilter}
                                onChange={(event) => setStatusFilter(event.target.value)}
                                className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="todas">Todos los estados</option>
                                <option value="pendiente">Pendientes</option>
                                <option value="vencida">Vencidas</option>
                                <option value="pagada">Pagadas</option>
                                <option value="anulada">Anuladas</option>
                            </select>
                            <select
                                value={sourceFilter}
                                onChange={(event) => setSourceFilter(event.target.value)}
                                className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="todas">Todas las fuentes</option>
                                <option value="sicar">SICAR</option>
                                <option value="manual">Manual</option>
                            </select>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-600">Documento</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-600">Cliente</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-600">Cuenta</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-600">Vencimiento</th>
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
                                ) : creditosFiltrados.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                                            No hay cuentas por cobrar para los filtros seleccionados.
                                        </td>
                                    </tr>
                                ) : creditosFiltrados.map((credito) => (
                                    <tr key={credito.id} className="hover:bg-slate-50">
                                        <td className="px-4 py-3 text-slate-600">{formatShortDate(credito.fechaEmision)}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900">{credito.numeroDocumento || credito.documentoId}</div>
                                            <div className="text-xs text-slate-500">{credito.sucursalName || GRANADA_BRANCH_NAME}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900">{credito.clienteNombre}</div>
                                            <div className="text-xs text-slate-500">{credito.clienteCodigo}</div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">
                                            {credito.cuentaContableCode || '110301'} - {credito.cuentaContableName || 'Clientes - Cuentas por Cobrar'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{formatShortDate(credito.fechaVencimiento)}</td>
                                        <td className="px-4 py-3 text-right font-medium text-slate-800">{formatCurrency(credito.montoOriginal)}</td>
                                        <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(credito.montoAbonado)}</td>
                                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(credito.saldoPendiente)}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[credito.status]}`}>
                                                {credito.status === 'vencida' ? 'Vencida' : credito.status === 'pagada' ? 'Pagada' : credito.status === 'anulada' ? 'Anulada' : 'Pendiente'}
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

                <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                        <h2 className="text-lg font-semibold text-slate-900">Clientes con saldo</h2>
                        <p className="text-sm text-slate-500 mt-1">
                            Top de clientes con mayor saldo pendiente en Granada.
                        </p>

                        <div className="mt-4 space-y-3">
                            {clientesConSaldo.length === 0 ? (
                                <p className="text-sm text-slate-500">No hay clientes con cartera abierta.</p>
                            ) : clientesConSaldo.map((cliente) => (
                                <div key={cliente.clienteId || cliente.clienteNombre} className="rounded-xl border border-slate-200 px-4 py-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="font-medium text-slate-900">{cliente.clienteNombre}</p>
                                            <p className="text-xs text-slate-500">{cliente.clienteCodigo}</p>
                                        </div>
                                        <p className="font-semibold text-amber-700">{formatCurrency(cliente.saldoPendiente)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                        <div className="flex items-center gap-2">
                            <DollarSign className="w-5 h-5 text-blue-600" />
                            <h2 className="text-lg font-semibold text-slate-900">Abonos recientes</h2>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                            Cobros aplicados a la cartera reflejada desde SICAR y captura manual.
                        </p>

                        <div className="mt-4 space-y-3">
                            {abonosNormalizados.slice(0, 6).map((abono) => (
                                <div key={abono.id} className="rounded-xl border border-slate-200 px-4 py-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="font-medium text-slate-900">{abono.clienteNombre}</p>
                                            <p className="text-xs text-slate-500">
                                                {formatShortDate(abono.fecha)} Â· {paymentMethodLabel(abono.metodoPago)}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-1">{abono.referencia || abono.documentoId}</p>
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

                            {!abonosNormalizados.length && (
                                <p className="text-sm text-slate-500">Todavia no hay abonos registrados.</p>
                            )}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4">
                        <div className="flex items-start gap-3">
                            <CreditCard className="w-5 h-5 text-blue-700 mt-0.5" />
                            <div className="text-sm text-blue-900">
                                <p className="font-semibold">Como se enlaza a MySQL y al ERP</p>
                                <p className="mt-1">
                                    Este modulo no toca MySQL directamente desde el navegador. Lee el espejo importado desde SICAR y lo cruza con la cuenta 110301 del plan de cuentas.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AccountsReceivable;
