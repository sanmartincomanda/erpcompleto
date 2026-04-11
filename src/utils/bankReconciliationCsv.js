import { v4 as uuidv4 } from 'uuid';

const HEADER_KEYWORDS = {
    date: ['fecha', 'date', 'posting date', 'transaction date'],
    description: ['descripcion', 'descripción', 'description', 'detalle', 'memo', 'concepto', 'narrative'],
    reference: ['referencia', 'reference', 'documento', 'doc', 'numero', 'número', 'comprobante', 'cheque'],
    debit: ['debito', 'débito', 'debit', 'cargo', 'withdrawal', 'retiro'],
    credit: ['credito', 'crédito', 'credit', 'deposito', 'depósito', 'abono', 'deposit'],
    amount: ['monto', 'amount', 'importe', 'valor']
};

const normalizeHeader = (value) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

export const detectCsvDelimiter = (text) => {
    const sampleLine = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || '';

    const candidates = [',', ';', '\t'];
    let bestDelimiter = ',';
    let bestScore = -1;

    candidates.forEach((delimiter) => {
        const score = sampleLine.split(delimiter).length;
        if (score > bestScore) {
            bestScore = score;
            bestDelimiter = delimiter;
        }
    });

    return bestDelimiter;
};

const parseCsvLine = (line, delimiter) => {
    const cells = [];
    let current = '';
    let insideQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        const nextCharacter = line[index + 1];

        if (character === '"') {
            if (insideQuotes && nextCharacter === '"') {
                current += '"';
                index += 1;
            } else {
                insideQuotes = !insideQuotes;
            }
            continue;
        }

        if (character === delimiter && !insideQuotes) {
            cells.push(current.trim());
            current = '';
            continue;
        }

        current += character;
    }

    cells.push(current.trim());
    return cells;
};

export const parseCsvText = (text) => {
    const delimiter = detectCsvDelimiter(text);
    const rows = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.replace(/\uFEFF/g, ''))
        .filter((line) => line.trim().length > 0)
        .map((line) => parseCsvLine(line, delimiter));

    return {
        delimiter,
        rows
    };
};

export const guessColumnMapping = (headers = []) => {
    const normalizedHeaders = headers.map(normalizeHeader);
    const mapping = {
        date: '',
        description: '',
        reference: '',
        debit: '',
        credit: '',
        amount: ''
    };

    Object.entries(HEADER_KEYWORDS).forEach(([field, keywords]) => {
        const headerIndex = normalizedHeaders.findIndex((header) =>
            keywords.some((keyword) => header.includes(keyword))
        );

        if (headerIndex >= 0) {
            mapping[field] = headers[headerIndex];
        }
    });

    return mapping;
};

export const parseDateInput = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw;
    }

    const compactMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (compactMatch) {
        let [, first, second, year] = compactMatch;
        let day = Number(first);
        let month = Number(second);

        if (Number(first) <= 12 && Number(second) > 12) {
            day = Number(second);
            month = Number(first);
        }

        if (year.length === 2) {
            year = `20${year}`;
        }

        return [
            year,
            String(month).padStart(2, '0'),
            String(day).padStart(2, '0')
        ].join('-');
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    return [
        parsed.getFullYear(),
        String(parsed.getMonth() + 1).padStart(2, '0'),
        String(parsed.getDate()).padStart(2, '0')
    ].join('-');
};

export const parseAmountInput = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return 0;

    const negative = raw.includes('(') && raw.includes(')');
    let sanitized = raw
        .replace(/[()]/g, '')
        .replace(/[A-Za-z$€£₡]/g, '')
        .replace(/\s/g, '');

    if (!sanitized) return 0;

    const lastComma = sanitized.lastIndexOf(',');
    const lastDot = sanitized.lastIndexOf('.');

    if (lastComma > -1 && lastDot > -1) {
        if (lastComma > lastDot) {
            sanitized = sanitized.replace(/\./g, '').replace(',', '.');
        } else {
            sanitized = sanitized.replace(/,/g, '');
        }
    } else if (lastComma > -1) {
        sanitized = sanitized.replace(/\./g, '').replace(',', '.');
    } else {
        sanitized = sanitized.replace(/,/g, '');
    }

    const parsed = Number(sanitized);
    if (Number.isNaN(parsed)) return 0;

    return negative ? -Math.abs(parsed) : parsed;
};

const getMappedValue = (row, headers, columnName) => {
    if (!columnName) return '';
    const index = headers.findIndex((header) => header === columnName);
    return index >= 0 ? row[index] || '' : '';
};

export const mapCsvRowsToTransactions = (rows = [], mapping = {}) => {
    if (!rows.length) return [];

    const [headers, ...dataRows] = rows;

    return dataRows
        .map((row) => {
            const fecha = parseDateInput(getMappedValue(row, headers, mapping.date));
            const descripcion =
                getMappedValue(row, headers, mapping.description) ||
                getMappedValue(row, headers, mapping.reference) ||
                'Movimiento bancario';
            const referencia = getMappedValue(row, headers, mapping.reference);

            const debitValue = parseAmountInput(getMappedValue(row, headers, mapping.debit));
            const creditValue = parseAmountInput(getMappedValue(row, headers, mapping.credit));
            const amountValue = parseAmountInput(getMappedValue(row, headers, mapping.amount));

            let debito = 0;
            let credito = 0;
            let signedAmount = 0;

            if (mapping.amount) {
                signedAmount = amountValue;
                if (amountValue >= 0) {
                    credito = Math.abs(amountValue);
                } else {
                    debito = Math.abs(amountValue);
                }
            } else {
                debito = Math.abs(debitValue);
                credito = Math.abs(creditValue);
                signedAmount = credito - debito;
            }

            if (!fecha && !descripcion && !referencia && !debito && !credito && !signedAmount) {
                return null;
            }

            return {
                id: `bank-line-${uuidv4()}`,
                fecha,
                descripcion,
                referencia,
                debito,
                credito,
                signedAmount,
                amountAbs: Math.abs(signedAmount || credito || debito),
                rawRow: row
            };
        })
        .filter(Boolean)
        .filter((transaction) => transaction.fecha && transaction.amountAbs > 0);
};
