export const GRANADA_BRANCH_ID = 'granada';
export const GRANADA_BRANCH_NAME = 'CARNES SAN MARTIN GRANADA';

export const toNumber = (value) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : 0;
};

export const sourceKind = (record) => (
    String(record?.sourceSystem || '').toLowerCase() === 'sicar' ? 'sicar' : 'manual'
);

export const sourceLabel = (record) => (
    sourceKind(record) === 'sicar' ? 'SICAR' : 'Manual'
);

export const paymentMethodLabel = (method) => {
    const normalized = String(method || '').toLowerCase();

    const labels = {
        credito: 'Credito',
        efectivo: 'Efectivo',
        transferencia: 'Transferencia',
        cheque: 'Cheque',
        deposito: 'Deposito',
        tarjeta: 'Tarjeta',
        vales: 'Vales',
        sicarpagos: 'Sicar Pagos',
        mixto: 'Mixto',
        otro: 'Otro'
    };

    return labels[normalized] || (method ? String(method) : 'Sin definir');
};

export const toJsDate = (value) => {
    if (!value) return null;

    if (typeof value?.toDate === 'function') {
        const timestampDate = value.toDate();
        return Number.isNaN(timestampDate.getTime()) ? null : timestampDate;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'string') {
        const normalized = value.length <= 10 ? `${value}T12:00:00` : value;
        const parsed = new Date(normalized);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
};

export const formatShortDate = (value) => {
    const date = toJsDate(value);
    if (!date) return '-';

    return new Intl.DateTimeFormat('es-NI', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(date);
};

export const formatDateTime = (value) => {
    const date = toJsDate(value);
    if (!date) return '-';

    return new Intl.DateTimeFormat('es-NI', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
};

export const formatCurrency = (amount, currency = 'NIO') => {
    const normalizedCurrency = currency === 'USD' ? 'USD' : 'NIO';

    return new Intl.NumberFormat('es-NI', {
        style: 'currency',
        currency: normalizedCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(toNumber(amount));
};

export const matchSearch = (query, values) => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return true;

    return values.some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
};

export const sortByDateDesc = (records, ...fields) => (
    [...records].sort((left, right) => {
        for (const field of fields) {
            const leftDate = toJsDate(left?.[field]);
            const rightDate = toJsDate(right?.[field]);
            const leftTime = leftDate?.getTime() || 0;
            const rightTime = rightDate?.getTime() || 0;

            if (leftTime !== rightTime) {
                return rightTime - leftTime;
            }
        }

        return String(left?.documentoId || left?.id || '').localeCompare(
            String(right?.documentoId || right?.id || '')
        );
    })
);
