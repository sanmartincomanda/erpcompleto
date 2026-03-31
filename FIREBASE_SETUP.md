# Configuración de Firebase - ERP Carnessanmartin

## Paso 1: Configurar Reglas de Seguridad de Firestore

Ve a Firebase Console → Firestore Database → Reglas y pega esto:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Haz clic en "Publicar".

## Paso 2: Configurar Reglas de Storage

Ve a Firebase Console → Storage → Reglas y pega esto:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Haz clic en "Publicar".

## Paso 3: Habilitar Autenticación

Ve a Firebase Console → Authentication → Método de inicio de sesión

Habilita "Correo electrónico/Contraseña"

## Paso 4: Crear Índices (si es necesario)

Si ves errores de índice, ve a Firestore Database → Índices y crea los índices necesarios.

## Paso 5: Verificar Conexión

1. Abre la aplicación
2. Crea una cuenta
3. Ve a Configuración → Cuentas Vinculadas
4. Haz clic en "Cargar Plan DGI"
5. Debería cargar ~100 cuentas

## Solución de Problemas

### "Client is offline"
- Verifica tu conexión a internet
- Recarga la página (F5)
- Espera unos segundos y vuelve a intentar

### Las cuentas no se guardan
- Verifica las reglas de seguridad (Paso 1)
- Abre la consola del navegador (F12) y revisa errores

### Las sucursales no se guardan
- Asegúrate de que la colección "branches" exista
- Verifica que tengas permisos de escritura

## Colecciones Necesarias

El sistema usa estas colecciones en Firestore:

- `planCuentas` - Plan de cuentas contables
- `branches` - Sucursales
- `configuracion` - Configuración del sistema
- `compras` - Registro de compras
- `movimientosContables` - Movimientos contables
- `asientosContables` - Asientos contables
- `facturasProveedor` - Facturas de proveedores
- `cierresCaja` - Cierres de caja
- `depositosTransito` - Depósitos en tránsito
