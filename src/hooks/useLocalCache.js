// src/hooks/useLocalCache.js
// Hook para caché local con localStorage

import { useState, useEffect, useCallback } from 'react';

const CACHE_PREFIX = 'erp_cache_';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Hook de caché local
 * @param {string} key - Clave de caché
 * @param {*} defaultValue - Valor por defecto
 * @param {number} ttl - Tiempo de vida en ms (default: 5 min)
 */
export const useLocalCache = (key, defaultValue = null, ttl = DEFAULT_TTL) => {
    const cacheKey = CACHE_PREFIX + key;

    const getCachedValue = useCallback(() => {
        try {
            const item = localStorage.getItem(cacheKey);
            if (!item) return defaultValue;

            const parsed = JSON.parse(item);
            const now = Date.now();

            // Verificar si expiró
            if (parsed.expiry && now > parsed.expiry) {
                localStorage.removeItem(cacheKey);
                return defaultValue;
            }

            return parsed.value;
        } catch (err) {
            console.error('Error leyendo caché:', err);
            return defaultValue;
        }
    }, [cacheKey, defaultValue]);

    const [value, setValue] = useState(getCachedValue);

    const setCachedValue = useCallback((newValue) => {
        try {
            const item = {
                value: newValue,
                timestamp: Date.now(),
                expiry: ttl ? Date.now() + ttl : null
            };
            localStorage.setItem(cacheKey, JSON.stringify(item));
            setValue(newValue);
        } catch (err) {
            console.error('Error guardando caché:', err);
            setValue(newValue);
        }
    }, [cacheKey, ttl]);

    const clearCache = useCallback(() => {
        try {
            localStorage.removeItem(cacheKey);
            setValue(defaultValue);
        } catch (err) {
            console.error('Error limpiando caché:', err);
        }
    }, [cacheKey, defaultValue]);

    const isExpired = useCallback(() => {
        try {
            const item = localStorage.getItem(cacheKey);
            if (!item) return true;

            const parsed = JSON.parse(item);
            return parsed.expiry && Date.now() > parsed.expiry;
        } catch {
            return true;
        }
    }, [cacheKey]);

    return {
        value,
        setValue: setCachedValue,
        clearCache,
        isExpired
    };
};

/**
 * Hook para caché de consultas Firestore
 */
export const useFirestoreCache = (collectionName, queryKey) => {
    const cacheKey = `${collectionName}_${queryKey}`;
    return useLocalCache(cacheKey, null, 10 * 60 * 1000); // 10 minutos
};

/**
 * Limpiar toda la caché del ERP
 */
export const clearAllCache = () => {
    try {
        Object.keys(localStorage)
            .filter(key => key.startsWith(CACHE_PREFIX))
            .forEach(key => localStorage.removeItem(key));
        return true;
    } catch (err) {
        console.error('Error limpiando caché:', err);
        return false;
    }
};

/**
 * Obtener estadísticas de caché
 */
export const getCacheStats = () => {
    try {
        const keys = Object.keys(localStorage).filter(key => key.startsWith(CACHE_PREFIX));
        let totalSize = 0;
        const items = keys.map(key => {
            const item = localStorage.getItem(key);
            totalSize += item.length * 2; // Aproximación en bytes
            const parsed = JSON.parse(item);
            return {
                key: key.replace(CACHE_PREFIX, ''),
                timestamp: parsed.timestamp,
                expiry: parsed.expiry,
                size: item.length * 2
            };
        });

        return {
            count: keys.length,
            totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
            items
        };
    } catch (err) {
        console.error('Error obteniendo estadísticas:', err);
        return { count: 0, totalSize: '0 KB', items: [] };
    }
};

export default useLocalCache;
