// src/hooks/usePaginacion.js
// Hook reutilizable para paginación de datos

import { useState, useMemo, useCallback } from 'react';

/**
 * Hook de paginación para listados
 * @param {Array} items - Array de items a paginar
 * @param {number} itemsPerPage - Items por página (default: 20)
 * @returns {Object} - Datos y funciones de paginación
 */
export const usePaginacion = (items = [], itemsPerPage = 20) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(itemsPerPage);

    // Calcular datos paginados
    const paginatedItems = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        return items.slice(startIndex, endIndex);
    }, [items, currentPage, pageSize]);

    // Calcular totales
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const hasNextPage = currentPage < totalPages;
    const hasPrevPage = currentPage > 1;

    // Navegación
    const goToPage = useCallback((page) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    }, [totalPages]);

    const nextPage = useCallback(() => {
        if (hasNextPage) {
            setCurrentPage(prev => prev + 1);
        }
    }, [hasNextPage]);

    const prevPage = useCallback(() => {
        if (hasPrevPage) {
            setCurrentPage(prev => prev - 1);
        }
    }, [hasPrevPage]);

    const firstPage = useCallback(() => {
        setCurrentPage(1);
    }, []);

    const lastPage = useCallback(() => {
        setCurrentPage(totalPages);
    }, [totalPages]);

    const changePageSize = useCallback((newSize) => {
        setPageSize(newSize);
        setCurrentPage(1); // Reset a primera página
    }, []);

    // Reset cuando cambian los items
    const resetPagination = useCallback(() => {
        setCurrentPage(1);
    }, []);

    // Info de rango
    const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    return {
        // Datos paginados
        items: paginatedItems,
        currentPage,
        pageSize,
        totalItems,
        totalPages,
        
        // Navegación
        hasNextPage,
        hasPrevPage,
        goToPage,
        nextPage,
        prevPage,
        firstPage,
        lastPage,
        
        // Configuración
        changePageSize,
        resetPagination,
        
        // Info
        startItem,
        endItem,
        
        // Opciones de tamaño de página
        pageSizeOptions: [10, 20, 50, 100]
    };
};

export default usePaginacion;
