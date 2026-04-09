import { collection, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

const DEFAULT_MAX_DIMENSION = 1400;
const DEFAULT_MAX_DATA_URL_BYTES = 140 * 1024;
const MIN_QUALITY = 0.4;
const QUALITY_STEP = 0.08;
const SCALE_STEP = 0.85;
const MIN_DIMENSION = 320;

export const sanitizeAttachmentFileName = (fileName = 'adjunto.jpg') =>
    fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
        reader.readAsDataURL(file);
    });

const loadImage = (src) =>
    new Promise((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('No se pudo procesar la imagen seleccionada.'));
        image.src = src;
    });

const fitWithin = (width, height, maxDimension) => {
    if (!maxDimension || (width <= maxDimension && height <= maxDimension)) {
        return { width, height };
    }

    const scale = Math.min(maxDimension / width, maxDimension / height);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
};

const getStringByteSize = (value) => new TextEncoder().encode(String(value || '')).length;

export const createLocalImagePreviewItems = (files = [], prefix = 'img') =>
    Array.from(files).map((file, index) => ({
        id: `${prefix}-${Date.now()}-${index}-${file.name}`,
        file,
        name: file.name,
        size: file.size || 0,
        previewUrl: URL.createObjectURL(file)
    }));

export const revokeLocalImagePreviewItems = (items = []) => {
    items.forEach((item) => {
        if (item?.previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(item.previewUrl);
        }
    });
};

const renderImageCandidate = (image, width, height, quality) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
        throw new Error('No se pudo preparar la imagen para guardarla.');
    }

    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', quality);
};

const compressImageToDataUrl = async (file, options = {}) => {
    const {
        maxDimension = DEFAULT_MAX_DIMENSION,
        maxDataUrlBytes = DEFAULT_MAX_DATA_URL_BYTES
    } = options;

    const sourceDataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(sourceDataUrl);
    const fitted = fitWithin(
        image.naturalWidth || image.width,
        image.naturalHeight || image.height,
        maxDimension
    );

    let width = fitted.width;
    let height = fitted.height;
    let quality = 0.82;
    let bestDataUrl = '';
    let bestBytes = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < 18; attempt += 1) {
        const candidate = renderImageCandidate(image, width, height, quality);
        const candidateBytes = getStringByteSize(candidate);

        if (candidateBytes < bestBytes) {
            bestDataUrl = candidate;
            bestBytes = candidateBytes;
        }

        if (candidateBytes <= maxDataUrlBytes) {
            return {
                dataUrl: candidate,
                storedBytes: candidateBytes,
                width,
                height,
                mimeType: 'image/jpeg'
            };
        }

        if (quality > MIN_QUALITY) {
            quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP);
            continue;
        }

        if (width <= MIN_DIMENSION || height <= MIN_DIMENSION) {
            break;
        }

        width = Math.max(1, Math.round(width * SCALE_STEP));
        height = Math.max(1, Math.round(height * SCALE_STEP));
        quality = 0.76;
    }

    if (!bestDataUrl || bestBytes > maxDataUrlBytes) {
        throw new Error('No se pudo optimizar la imagen. Pruebe con una foto más liviana o recortada.');
    }

    return {
        dataUrl: bestDataUrl,
        storedBytes: bestBytes,
        width,
        height,
        mimeType: 'image/jpeg'
    };
};

export const createImageAttachment = async ({
    file,
    entityType,
    entityId = null,
    category = 'general',
    fileName,
    userId = null,
    userEmail = null,
    maxDimension = DEFAULT_MAX_DIMENSION,
    maxDataUrlBytes = DEFAULT_MAX_DATA_URL_BYTES
}) => {
    if (!file) {
        throw new Error('No se recibió ninguna imagen para guardar.');
    }

    const optimized = await compressImageToDataUrl(file, {
        maxDimension,
        maxDataUrlBytes
    });

    const attachmentsCollection = collection(db, 'adjuntosERP');
    const attachmentRef = doc(attachmentsCollection);
    const safeName = sanitizeAttachmentFileName(fileName || file.name || `adjunto_${attachmentRef.id}.jpg`);
    const now = Timestamp.now();

    await setDoc(attachmentRef, {
        entityType: entityType || 'general',
        entityId,
        category,
        originalName: file.name || safeName,
        fileName: safeName,
        mimeType: optimized.mimeType,
        dataUrl: optimized.dataUrl,
        sizeOriginalBytes: file.size || 0,
        sizeStoredBytes: optimized.storedBytes,
        width: optimized.width,
        height: optimized.height,
        createdAt: now,
        createdBy: userId,
        createdByEmail: userEmail
    });

    return {
        attachmentId: attachmentRef.id,
        name: file.name || safeName,
        mimeType: optimized.mimeType,
        sizeOriginalBytes: file.size || 0,
        sizeStoredBytes: optimized.storedBytes,
        uploadedAt: new Date().toISOString(),
        storageType: 'firestoreInline'
    };
};

export const fetchImageAttachment = async (attachmentId) => {
    if (!attachmentId) return null;

    const snapshot = await getDoc(doc(db, 'adjuntosERP', attachmentId));
    if (!snapshot.exists()) return null;

    return {
        id: snapshot.id,
        ...snapshot.data()
    };
};

export const resolveStoredImageEntries = async (items = []) => {
    const normalizedItems = Array.isArray(items) ? items : [];

    const resolved = await Promise.all(
        normalizedItems.map(async (item, index) => {
            const directUrl =
                typeof item === 'string'
                    ? item
                    : item?.url || item?.downloadURL || item?.comprobanteURL || item?.dataUrl || null;

            if (directUrl) {
                return {
                    ...(typeof item === 'object' && item ? item : {}),
                    url: directUrl,
                    name:
                        (typeof item === 'object' && item?.name) ||
                        `Imagen ${index + 1}`
                };
            }

            if (!item?.attachmentId) return null;

            const attachment = await fetchImageAttachment(item.attachmentId);
            if (!attachment?.dataUrl) return null;

            return {
                ...item,
                url: attachment.dataUrl,
                name: item?.name || attachment.originalName || `Imagen ${index + 1}`
            };
        })
    );

    return resolved.filter(Boolean);
};
