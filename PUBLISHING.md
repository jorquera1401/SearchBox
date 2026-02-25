# Guía de Publicación en Chrome Web Store

¡Tu extensión está lista! Sigue estos pasos para publicarla.

## 1. Preparación (Ya realizada)
- **Archivo**: Tienes un archivo `dist.zip` en la raíz del proyecto.
- **Privacidad**: Tienes un archivo `PRIVACY.md` con la política lista.
- **Manifest**: Versión `1.0.0` y descripción limpia.

## 2. Cuenta de Desarrollador
1. Ve al [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard).
2. Si es tu primera vez, deberás pagar una **tarifa única de registro de $5 USD**.

## 3. Subir el Paquete
1. Haz clic en el botón azul **"NUEVO ELEMENTO"** (New Item).
2. Arrastra y suelta el archivo `dist.zip` que generamos.

## 4. Ficha de la Tienda (Store Listing)
Completa los campos obligatorios:
- **Descripción**: Explica qué hace la extensión. Menciona que usa "Chrome Built-in AI" para búsquedas inteligentes pero privadas.
- **Categoría**: "Productividad" o "Herramientas de búsqueda".
- **Idioma**: Español (o el que prefieras como principal).
- **Icono**: Sube `public/icons/icon128.png` (o el SVG si te lo permite, aunque suele pedir PNG de 128x128).
- **Capturas de pantalla**: Toma 1 o 2 capturas de la extensión funcionando (el modal negro flotante). Sube al menos una de 1280x800px.

## 5. Privacidad (Privacy)
1. **Política de Privacidad**: Copia y pega el contenido completo de `PRIVACY.md`.
2. **Permisos**: Te pedirá justificación para:
    - `tabs`: "Needed to index and search through open tabs."
    - `scripting`: "Needed to inject the search command palette (modal) into the current page."
    - `host_permissions` (`<all_urls>`): "Required to ensure the command palette works on any URL the user visits."
3. **Uso de Datos**: Marca que **NO** recolectas datos de usuario (todo es local).

## 6. Revisión y Publicación
1. Haz clic en **"Enviar para revisión"** (Submit for Review).
2. Google revisará la extensión (suele tardar 1-2 días laborables).
3. ¡Recibirás un correo cuando esté publicada!

---
**Nota sobre IA**: Como es una característica experimental de Chrome, es posible que la tienda pregunte sobre el uso de "IA". Aclara siempre que usas **"Chrome Built-in AI APIs (window.ai)"** y que **todo el procesamiento es on-device (local)**.
