# Activación de Gemini Nano (window.ai) en Chrome

Si al ejecutar `window.ai` en la consola obtienes `undefined`, significa que el navegador no tiene activada la API experimental. Sigue estos pasos **exactos** para solucionarlo.

### 1. Requisitos Previos
*   **Versión de Chrome**: Debes tener Chrome versión **128** o superior (preferiblemente 131+).
*   **Espacio en Disco**: El modelo pesa ~1.5 GB, asegúrate de tener espacio libre.

### 2. Configuración de "Flags" (Banderas)
Copia y pega estas direcciones en tu barra de búsqueda y configúralas así:

1.  `chrome://flags/#prompt-api-for-gemini-nano`
    *   Cambiar a: **Enabled**
2.  `chrome://flags/#optimization-guide-on-device-model`
    *   Cambiar a: **Enabled BypassPerfRequirement**
    *   *Nota: Es crucial seleccionar "BypassPerfRequirement" para forzar la descarga en cualquier hardware.*
3.  **REINICIA CHROME COMPLETAMENTE** (Cierra todas las ventanas o usa el botón "Relaunch" que aparece abajo).

### 3. Descarga del Modelo (Crucial)
Una vez reiniciado, Chrome necesita descargar el modelo en segundo plano.

1.  Ve a `chrome://components`
2.  Busca **"Optimization Guide On Device Model"**.
3.  Haz clic en **"Check for update"**.
    *   Debe empezar a descargar (puede tardar unos minutos).
    *   **NO** funcionará hasta que diga: **Status - Up-to-date** y muestre una versión (ej. `2024.5.21.1031`).
    *   *Si dice "Component not updated" o se queda en 0.0.0.0, intenta reiniciar de nuevo y esperar unos minutos con el navegador abierto.*

### 4. Verificación Final
1.  Abre una nueva pestaña en `google.com` (no uses `chrome://` ni páginas vacías).
2.  Abre la consola (F12) y escribe:
    ```javascript
    await window.ai.languageModel.capabilities()
    ```
3.  Debería responder con un objeto que dice `{ available: "readily" }` (o "after-download").

---

### Solución de Problemas Comunes

*   **Error: `window.ai` is undefined**:
    *   Casi siempre es porque no has reiniciado Chrome después de activar los flags, o tu versión de Chrome es muy antigua.
*   **Error: `NotSupportedError` o `available: "no"`**:
    *   El modelo aún se está descargando en `chrome://components`. Espera a que termine.
*   **No aparece "Optimization Guide On Device Model" en componentes**:
    *   Asegúrate de haber puesto la flag en **"BypassPerfRequirement"** y reiniciado.
