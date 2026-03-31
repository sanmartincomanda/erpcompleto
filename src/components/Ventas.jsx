// src/components/Ventas.jsx
import React from 'react';
import { TrendingUp } from 'lucide-react';

const Ventas = () => {
    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <TrendingUp className="w-8 h-8 text-green-600" />
                Módulo de Ventas
            </h1>
            <div className="bg-white rounded-lg shadow p-8 text-center">
                <p className="text-gray-600 mb-4">Use el módulo Data Entry para registrar ventas</p>
                <a 
                    href="/dataentry" 
                    className="inline-block px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                    Ir a Data Entry
                </a>
            </div>
        </div>
    );
};

export default Ventas;
