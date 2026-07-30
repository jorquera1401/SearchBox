# Guía de Publicación en Chrome Web Store

¡Tu extensión está lista! Sigue estos pasos para publicarla.

## 1. Preparación

- **Manifest**: Versión `1.2.0` y descripción limpia.
- **Privacidad**: `PRIVACY.md` está actualizado con la descarga del modelo.
- **Paquete**: Genera `dist.zip` desde cero antes de cada envío:

```bash
npm run build
rm -f dist.zip && cd dist && zip -rq ../dist.zip . -x ".vite/*" && cd ..
```

El `.zip` pesa unos **9 MB** (38 MB descomprimido). Casi todo es el runtime WASM de ONNX Runtime, que debe viajar dentro de la extensión (ver Sección 7).

## 2. Cuenta de Desarrollador

1. Ve al [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard).
2. Si es tu primera vez, deberás pagar una **tarifa única de registro de $5 USD**.

## 3. Subir el Paquete

1. Haz clic en el botón azul **"NUEVO ELEMENTO"** (New Item).
2. Arrastra y suelta el archivo `dist.zip`.

## 4. Ficha de la Tienda (Store Listing)

Completa los campos obligatorios:

- **Descripción**: Explica qué hace la extensión. Menciona que la búsqueda semántica corre **localmente en el dispositivo**, sin enviar tus pestañas a ningún servidor.
- **Categoría**: "Productividad" o "Herramientas de búsqueda".
- **Idioma**: Español (o el que prefieras como principal).
- **Icono**: Sube `store-assets/store-icon-128.png` (PNG de 128x128).
- **Tiles promocionales**: `store-assets/store-promo-small-440x280.png` y `store-promo-marquee-1400x560.png`.
- **Capturas de pantalla**: 1280x800px. Las de `store-assets/` están **desactualizadas** — no muestran el toggle de IA ni la barra de progreso. Recaptúralas antes de enviar.

Todo el arte de marca se regenera con `npm run assets` desde `scripts/generate-assets.mjs`. Vive fuera de `public/` a propósito: ese directorio se copia entero dentro de la extensión, y enviar tiles promocionales a cada usuario es peso muerto.

## 5. Privacidad (Privacy)

1. **Política de Privacidad**: Copia y pega el contenido completo de `PRIVACY.md`.
2. **Uso de Datos**: Marca que **NO** recolectas datos de usuario. Es cierto: los títulos y URLs nunca salen del dispositivo.
3. **Permisos**: Te pedirá justificación para cada uno.

| Permiso | Justificación |
|---|---|
| `tabs` | Needed to index and search through open tabs. |
| `scripting` | Needed to inject the search command palette (modal) into the current page. |
| `storage` | Needed to store the user's AI on/off preference and the locally computed tab embeddings. No personal data is stored. |
| `offscreen` | Needed to run the local embedding model in a single shared context. Without it the model would load once per open tab. |
| `host_permissions` (`<all_urls>`) | Required to ensure the command palette works on any URL the user visits. |

## 6. Revisión y Publicación

1. Haz clic en **"Enviar para revisión"** (Submit for Review).
2. Google revisará la extensión (suele tardar 1-2 días laborables).
3. ¡Recibirás un correo cuando esté publicada!

---

## 7. Nota sobre IA y código remoto

Este es el punto que más mira la revisión. Describe el funcionamiento con precisión:

- **Camino principal**: la extensión descarga, la primera vez que el usuario activa la IA, los **pesos de un modelo público de embeddings** (`Xenova/multilingual-e5-small`, ~129 MB) desde el CDN de HuggingFace. Esa descarga es idéntica para todos los usuarios y **no contiene ningún dato del usuario**. Los pesos quedan cacheados y toda la inferencia ocurre en el dispositivo.
- **Fallback**: si el modelo no puede cargarse, se usa la **Chrome Built-in AI API (`window.LanguageModel`)**, también on-device.

**Sobre la política de código remoto (Remote Hosted Code):** la extensión **no la incumple**. Lo que se descarga son ficheros de pesos `.onnx`, que son **datos**, no código ejecutable. Todo el código —incluido el runtime WASM de ONNX Runtime— viaja dentro del paquete y se ejecuta desde `chrome-extension://`. Por eso el `.zip` pesa 9 MB en lugar de unos pocos KB: empaquetar ese runtime es precisamente lo que mantiene la extensión conforme.

Si el revisor pregunta por la conexión de red, la respuesta corta es: *"One-time download of public model weights (data, not code) from the HuggingFace CDN. No user data is transmitted."*
