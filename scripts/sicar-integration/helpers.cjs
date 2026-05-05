const crypto = require('node:crypto');

const normalizeKey = (value) =>
    String(value === undefined || value === null ? '' : value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

const cleanString = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
};

const pickFirst = (row, candidates = [], fallback = null) => {
    for (const candidate of candidates) {
        if (row && Object.prototype.hasOwnProperty.call(row, candidate)) {
            const value = row[candidate];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                return value;
            }
        }
    }

    return fallback;
};

const pickExistingKey = (row, candidates = []) => {
    for (const candidate of candidates) {
        if (row && Object.prototype.hasOwnProperty.call(row, candidate)) {
            return candidate;
        }
    }

    return null;
};

const toNumber = (value, fallback = 0) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;

    const parsed = Number(
        String(value)
            .replace(/,/g, '')
            .replace(/[^\d.-]/g, '')
    );

    return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    const normalized = cleanString(value).toLowerCase();
    return ['1', 'true', 'si', 'yes', 'y', 'activo', 'active'].includes(normalized);
};

const toIsoDate = (value) => {
    if (!value) return null;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return value.toISOString().slice(0, 10);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
    }

    const raw = cleanString(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

const toIsoDateTime = (value) => {
    if (!value) return null;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return value.toISOString();
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
    }

    return null;
};

const startOfDayIso = (isoDate) => `${isoDate}T00:00:00.000Z`;
const endOfDayIso = (isoDate) => `${isoDate}T23:59:59.999Z`;

const stableStringify = (value) => {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }

    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const sha1 = (value) =>
    crypto.createHash('sha1').update(stableStringify(value)).digest('hex');

const chunkArray = (items = [], size = 250) => {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
};

const buildMirrorDocId = (sourceTable, sourceId) =>
    `sicar__${normalizeKey(sourceTable)}__${normalizeKey(sourceId)}`;

const nowIso = () => new Date().toISOString();

const uniqueValues = (values = []) => [...new Set(values.filter(Boolean))];

const clampText = (value, maxLength = 300) => {
    const text = cleanString(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 3)}...`;
};

module.exports = {
    buildMirrorDocId,
    chunkArray,
    clampText,
    cleanString,
    endOfDayIso,
    normalizeKey,
    nowIso,
    pickExistingKey,
    pickFirst,
    sha1,
    stableStringify,
    startOfDayIso,
    toBoolean,
    toIsoDate,
    toIsoDateTime,
    toNumber,
    uniqueValues
};
