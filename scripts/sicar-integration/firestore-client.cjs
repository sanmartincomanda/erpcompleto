const fs = require('node:fs');

const admin = require('firebase-admin');

const { chunkArray, cleanString } = require('./helpers.cjs');

const DEFAULT_BATCH_SIZE = 200;

const encodeFirestoreValue = (value) => {
    if (value === null || value === undefined) {
        return { nullValue: null };
    }

    if (value instanceof Date) {
        return { timestampValue: value.toISOString() };
    }

    if (Array.isArray(value)) {
        return {
            arrayValue: {
                values: value.map((item) => encodeFirestoreValue(item))
            }
        };
    }

    if (typeof value === 'boolean') {
        return { booleanValue: value };
    }

    if (typeof value === 'number') {
        return Number.isInteger(value)
            ? { integerValue: String(value) }
            : { doubleValue: value };
    }

    if (typeof value === 'string') {
        const trimmed = cleanString(value);
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed)) {
            return { stringValue: trimmed };
        }
        return { stringValue: trimmed };
    }

    if (typeof value === 'object') {
        const fields = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            if (nestedValue === undefined) continue;
            fields[key] = encodeFirestoreValue(nestedValue);
        }
        return {
            mapValue: {
                fields
            }
        };
    }

    return { stringValue: String(value) };
};

const decodeFirestoreValue = (value = {}) => {
    if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
    if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
    if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
    if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
    if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
    if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;

    if (value.arrayValue) {
        return (value.arrayValue.values || []).map((item) => decodeFirestoreValue(item));
    }

    if (value.mapValue) {
        const result = {};
        const fields = value.mapValue.fields || {};
        for (const [key, nestedValue] of Object.entries(fields)) {
            result[key] = decodeFirestoreValue(nestedValue);
        }
        return result;
    }

    return null;
};

const decodeFirestoreDocument = (document) => {
    const data = {};
    for (const [key, value] of Object.entries(document.fields || {})) {
        data[key] = decodeFirestoreValue(value);
    }

    return {
        id: document.name.split('/').pop(),
        name: document.name,
        createTime: document.createTime || null,
        updateTime: document.updateTime || null,
        data
    };
};

const buildDocumentName = (projectId, documentPath) =>
    `projects/${projectId}/databases/(default)/documents/${cleanString(documentPath)}`;

const buildDocumentUrlPath = (documentPath) =>
    cleanString(documentPath)
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');

const createAdminClient = (config) => {
    const appName = `sicar-sync-${Date.now()}`;
    const appOptions = {
        projectId: config.projectId,
        storageBucket: config.storageBucket || undefined
    };

    if (config.credentialsPath && fs.existsSync(config.credentialsPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(config.credentialsPath, 'utf8'));
        appOptions.credential = admin.credential.cert(serviceAccount);
    } else if (config.clientEmail && config.privateKey) {
        appOptions.credential = admin.credential.cert({
            projectId: config.projectId,
            clientEmail: config.clientEmail,
            privateKey: config.privateKey
        });
    } else {
        appOptions.credential = admin.credential.applicationDefault();
    }

    const app = admin.initializeApp(appOptions, appName);
    const db = admin.firestore(app);

    return {
        mode: 'admin',
        projectId: config.projectId,
        async getDocument(documentPath) {
            const snapshot = await db.doc(documentPath).get();
            return snapshot.exists ? { id: snapshot.id, data: snapshot.data() } : null;
        },
        async listCollection(collectionName) {
            const snapshot = await db.collection(collectionName).get();
            return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
        },
        async setDocument(documentPath, data) {
            await db.doc(documentPath).set(data, { merge: true });
        },
        async setDocuments(collectionName, docs = []) {
            let written = 0;
            for (const chunk of chunkArray(docs, 400)) {
                const batch = db.batch();
                for (const item of chunk) {
                    batch.set(db.collection(collectionName).doc(item.id), item.data, { merge: true });
                }
                await batch.commit();
                written += chunk.length;
            }
            return written;
        }
    };
};

const createRestClient = (config) => {
    const projectId = cleanString(config.projectId);
    const apiKey = cleanString(config.apiKey);
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

    const fetchJson = async (url, init = {}) => {
        const response = await fetch(url, init);
        const rawText = await response.text();
        const payload = rawText ? JSON.parse(rawText) : {};

        if (!response.ok) {
            const message = payload?.error?.message || `${response.status} ${response.statusText}`;
            throw new Error(`Firestore REST error: ${message}`);
        }

        return payload;
    };

    const commitWrites = async (writes = []) => {
        if (!writes.length) return 0;
        const payload = { writes };
        await fetchJson(`${baseUrl}:commit?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return writes.length;
    };

    return {
        mode: 'rest',
        projectId,
        async getDocument(documentPath) {
            const url = `${baseUrl}/${buildDocumentUrlPath(documentPath)}?key=${encodeURIComponent(apiKey)}`;

            try {
                const payload = await fetchJson(url, { method: 'GET' });
                const document = decodeFirestoreDocument(payload);
                return { id: document.id, data: document.data };
            } catch (error) {
                const message = String(error.message || '');
                if (
                    message.includes('Requested entity was not found') ||
                    message.includes('not found') ||
                    message.includes('NOT_FOUND')
                ) {
                    return null;
                }
                throw error;
            }
        },
        async listCollection(collectionName) {
            const documents = [];
            let pageToken = '';

            do {
                const query = new URLSearchParams({
                    key: apiKey,
                    pageSize: '500'
                });

                if (pageToken) query.set('pageToken', pageToken);

                const payload = await fetchJson(`${baseUrl}/${encodeURIComponent(collectionName)}?${query.toString()}`, {
                    method: 'GET'
                });

                for (const item of payload.documents || []) {
                    const document = decodeFirestoreDocument(item);
                    documents.push({ id: document.id, data: document.data });
                }

                pageToken = cleanString(payload.nextPageToken);
            } while (pageToken);

            return documents;
        },
        async setDocument(documentPath, data) {
            const writes = [
                {
                    update: {
                        name: buildDocumentName(projectId, documentPath),
                        fields: encodeFirestoreValue(data).mapValue.fields || {}
                    }
                }
            ];

            await commitWrites(writes);
        },
        async setDocuments(collectionName, docs = []) {
            let written = 0;

            for (const chunk of chunkArray(docs, DEFAULT_BATCH_SIZE)) {
                const writes = chunk.map((item) => ({
                    update: {
                        name: buildDocumentName(projectId, `${collectionName}/${item.id}`),
                        fields: encodeFirestoreValue(item.data).mapValue.fields || {}
                    }
                }));

                written += await commitWrites(writes);
            }

            return written;
        }
    };
};

const createFirestoreClient = (firebaseConfig) => {
    if (firebaseConfig?.admin?.enabled) {
        return createAdminClient(firebaseConfig.admin);
    }

    if (firebaseConfig?.rest?.enabled) {
        return createRestClient(firebaseConfig.rest);
    }

    throw new Error('No se encontro una configuracion valida de Firebase para el integrador.');
};

module.exports = {
    createFirestoreClient,
    decodeFirestoreDocument,
    decodeFirestoreValue,
    encodeFirestoreValue
};
