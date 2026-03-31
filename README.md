# ERP Carnessanmartin Granada - Versión Corregida

Sistema de gestión contable y financiera para Carnessanmartin Granada.

## Correcciones Realizadas

1. ✅ **Confirmación de Depósito** - Carga cuentas bancarias actuales del plan de cuentas
2. ✅ **Dinero en Tránsito** - Conexión automática al plan de cuentas con asientos contables
3. ✅ **Cuentas por Pagar** - Vinculación correcta con cuenta 2.01.01.01 PROVEEDORES
4. ✅ **Cierre de Caja** - Selección de cuenta de efectivo configurable
5. ✅ **Cierre de Caja** - Modo lectura para ver cierres completados
6. ✅ **Transferencias USD** - Opciones BAC y LAFISE agregadas
7. ✅ **Data Entry** - Vinculación correcta al plan de cuentas actual

## Requisitos Previos

- Node.js 18 o superior
- npm o yarn
- Cuenta de Firebase configurada

## Instalación

1. **Descomprimir el archivo ZIP**
   ```bash
   unzip erp-sanmartin-corregido.zip
   cd erp-sanmartin-corregido
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar Firebase**
   - Copie el archivo `.env.example` a `.env`
   - Complete las variables con sus credenciales de Firebase:
     ```
     REACT_APP_FIREBASE_API_KEY=your-api-key
     REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
     REACT_APP_FIREBASE_PROJECT_ID=your-project-id
     REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
     REACT_APP_FIREBASE_MESSAGING_SENDER_ID=123456789
     REACT_APP_FIREBASE_APP_ID=1:123456789:web:abcdef123456
     ```

4. **Iniciar la aplicación**
   ```bash
   npm run dev
   ```

5. **Abrir en el navegador**
   - La aplicación estará disponible en: `http://localhost:3000`

## Estructura del Proyecto

```
erp-sanmartin-corregido/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── AccountsPayable.jsx
│   │   ├── ChartOfAccounts.jsx
│   │   ├── CierreCajaERP.jsx
│   │   ├── ConfirmacionDeposito.jsx
│   │   ├── DashboardFinanciero.jsx
│   │   ├── DataEntry.jsx
│   │   ├── DepositosTransito.jsx
│   │   ├── GastosDiarios.jsx
│   │   ├── Header.jsx
│   │   ├── Inicio.jsx
│   │   ├── Login.jsx
│   │   ├── PrivateRoute.jsx
│   │   ├── Reports.jsx
│   │   └── ERP/
│   │       ├── AjustesManuales.jsx
│   │       ├── CierreCajaERP.jsx
│   │       └── MovimientosContables.jsx
│   ├── context/
│   │   └── AuthContext.jsx
│   ├── hooks/
│   │   ├── useAccounting.jsx
│   │   ├── useBranches.jsx
│   │   └── useUnifiedAccounting.js
│   ├── services/
│   │   └── unifiedAccountingService.js
│   ├── firebase.js
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── .env.example
```

## Configuración de Firebase

### Colecciones Requeridas

El sistema requiere las siguientes colecciones en Firestore:

1. **planCuentas** - Plan de cuentas contables
2. **movimientosContables** - Movimientos contables
3. **cierresCajaERP** - Cierres de caja
4. **depositosTransito** - Depósitos en tránsito
5. **depositosBancarios** - Depósitos bancarios confirmados
6. **facturasCuentaPagar** - Facturas de proveedores
7. **ventasDirectas** - Ventas registradas
8. **gastosDirectos** - Gastos registrados
9. **ajustesManuales** - Ajustes manuales
10. **users** - Usuarios del sistema
11. **branches** - Sucursales

### Plan de Cuentas NIC

El sistema está diseñado para trabajar con el Plan de Cuentas NIC. Las cuentas principales son:

- **1.01.01** - Efectivo y equivalentes
- **1.01.01.20** - Dinero en tránsito (NIO)
- **1.01.01.21** - Dinero en tránsito (USD)
- **1.01.02** - Bancos
- **2.01.01.01** - Proveedores
- **4.01** - Ingresos
- **6.01** - Gastos

## Módulos del Sistema

### 1. Inicio
Dashboard con accesos rápidos y resumen de KPIs.

### 2. Plan de Cuentas
Gestión completa del catálogo de cuentas contables.

### 3. Ventas y Gastos (Data Entry)
Registro de operaciones diarias vinculadas al plan de cuentas.

### 4. Cierre de Caja ERP
Proceso de cierre con:
- Selección de cuenta de efectivo
- Registro de múltiples métodos de pago
- Transferencias USD (BAC, LAFISE)
- Vista de cierres completados

### 5. Depósitos en Tránsito
Gestión de depósitos con asientos contables automáticos.

### 6. Confirmar Depósito
Confirmación de depósitos en bancos con carga de cuentas actual.

### 7. Cuentas por Pagar
Gestión de facturas de proveedores vinculadas a 2.01.01.01.

### 8. Reportes
- Estado de Resultados
- Balance General
- Movimientos Contables

### 9. Configuración
- Usuarios
- Sucursales
- Parámetros del sistema

## Scripts Disponibles

- `npm run dev` - Inicia el servidor de desarrollo
- `npm run build` - Construye la aplicación para producción
- `npm run preview` - Previsualiza la build de producción

## Solución de Problemas

### Error: "No se encontraron cuentas bancarias"
Verifique que las cuentas en Firestore tengan:
- Código que comience con `1.01.02` o `1.01.03`
- O nombre que contenga "banco", "bac", "banpro" o "lafise"
- O subType igual a "banco"

### Error: "Cuenta de proveedores no encontrada"
Verifique que exista una cuenta con:
- Código `2.01.01.01`
- O nombre que contenga "Proveedores"
- Tipo `PASIVO`

## Soporte

Para soporte técnico, contacte al administrador del sistema.

## Licencia

© 2024 Carnessanmartin Granada. Todos los derechos reservados.
