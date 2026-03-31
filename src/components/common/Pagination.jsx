// src/components/common/Pagination.jsx
// Componente reutilizable de paginación

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

const Pagination = ({ 
    currentPage, 
    totalPages, 
    totalItems,
    startItem,
    endItem,
    pageSize,
    pageSizeOptions = [10, 20, 50, 100],
    hasNextPage,
    hasPrevPage,
    onPageChange,
    onPageSizeChange,
    onFirstPage,
    onLastPage,
    onNextPage,
    onPrevPage
}) => {
    // Generar array de números de página a mostrar
    const getPageNumbers = () => {
        const pages = [];
        const maxVisible = 5;
        
        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            // Siempre mostrar primera, última y alrededor de la actual
            if (currentPage <= 3) {
                for (let i = 1; i <= 4; i++) pages.push(i);
                pages.push('...');
                pages.push(totalPages);
            } else if (currentPage >= totalPages - 2) {
                pages.push(1);
                pages.push('...');
                for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
            } else {
                pages.push(1);
                pages.push('...');
                for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
                pages.push('...');
                pages.push(totalPages);
            }
        }
        
        return pages;
    };

    if (totalPages <= 1) return null;

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 border-t border-gray-200">
            {/* Info de resultados */}
            <div className="text-sm text-gray-600">
                Mostrando <span className="font-medium">{startItem}</span> a{' '}
                <span className="font-medium">{endItem}</span> de{' '}
                <span className="font-medium">{totalItems}</span> resultados
            </div>

            {/* Selector de tamaño de página */}
            <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Mostrar:</span>
                <select
                    value={pageSize}
                    onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
                    className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                >
                    {pageSizeOptions.map(size => (
                        <option key={size} value={size}>{size}</option>
                    ))}
                </select>
            </div>

            {/* Botones de navegación */}
            <div className="flex items-center gap-1">
                {/* Primera página */}
                <button
                    onClick={onFirstPage}
                    disabled={!hasPrevPage}
                    className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Primera página"
                >
                    <ChevronsLeft className="w-4 h-4" />
                </button>

                {/* Página anterior */}
                <button
                    onClick={onPrevPage}
                    disabled={!hasPrevPage}
                    className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Página anterior"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>

                {/* Números de página */}
                <div className="flex items-center gap-1">
                    {getPageNumbers().map((page, index) => (
                        page === '...' ? (
                            <span key={`ellipsis-${index}`} className="px-3 py-2 text-gray-500">
                                ...
                            </span>
                        ) : (
                            <button
                                key={page}
                                onClick={() => onPageChange?.(page)}
                                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    currentPage === page
                                        ? 'bg-blue-600 text-white'
                                        : 'border border-gray-300 hover:bg-gray-50 text-gray-700'
                                }`}
                            >
                                {page}
                            </button>
                        )
                    ))}
                </div>

                {/* Página siguiente */}
                <button
                    onClick={onNextPage}
                    disabled={!hasNextPage}
                    className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Página siguiente"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>

                {/* Última página */}
                <button
                    onClick={onLastPage}
                    disabled={!hasNextPage}
                    className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Última página"
                >
                    <ChevronsRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

export default Pagination;
