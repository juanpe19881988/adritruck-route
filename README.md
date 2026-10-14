# 🚛 AdriTruck PRO — Planificador de Rutas para Camiones

Aplicación web y móvil (PWA) diseñada para el cálculo y verificación de rutas de transporte pesado en **España y Europa**, teniendo en cuenta **dimensiones (metros de longitud, altura/gálibo y anchura)**, **geometría de giros (rígido vs. articulado)**, **límites de tonelaje** y **restricciones de paso**.

---

## 🚀 Cómo Ejecutar la Aplicación

No necesitas instalar Node.js ni compilar nada:

1. **Abrir directamente:** Haz doble clic en [`index.html`](file:///c:/Users/juaanpe/OneDrive%20-%20ENAIRE/Script%20Workplace/Adri_app/index.html) para abrirlo en tu navegador favorito (Chrome, Edge, Firefox, etc.).
2. **O servir en red local (opcional):** Si quieres abrirlo desde el móvil conectado al mismo Wi-Fi:
   ```powershell
   python -m http.server 8080
   ```
   Y en el navegador de tu móvil entra a `http://IP_DE_TU_PC:8080`.

---

## ✨ Características Principales

### 1. 📐 Dimensiones y Geometría de Giro
* **Plantillas Rápidas:**
  * 🚐 *Carrozado / Reparto Urbano (6.5m · ↕3.1m · 3.5t)*
  * 🚚 *Rígido 2 Ejes (8.5m · ↕3.5m · 18t)*
  * 🚛 *Rígido 3 Ejes (11.0m · ↕3.8m · 26t)*
  * 🚛 *Tráiler Articulado (16.5m · ↕4.0m · 40t)*
* **Geometría de Giro:** Diferenciación entre vehículo **Rígido** y **Articulado (Semirremolque)**. Aplica penalizaciones dinámicas a giros de más de 75°-90° en intersecciones y rotondas estrechas para evitar tijeras o barridos del remolque.
* **Control Fino:** Ajuste de longitud exacta, altura/gálibo, anchura (lona 2.55m vs. frigo 2.60m), peso total MMA, peso por eje y mercancías peligrosas (ADR).

### 2. ⚙️ Selector de Motor de Rutas (Dual-Engine)
* **🌍 Valhalla OSM Truck (Activo por defecto):** 100% gratuito, sin registro ni API key. Utiliza perfiles de `truck` con penalizaciones dinámicas de maniobra y gálibos de OpenStreetMap.
* **🏢 HERE Truck Routing v8:** Compatible con la API industrial de HERE (Mercedes/Garmin) introduciendo tu API Key gratuita en la pestaña *Motor*.
* **🛣️ OpenRouteService HGV:** Perfil especializado europeo para vehículos pesados sobre OpenStreetMap.

### 3. ⚠️ Radar en Vivo de Restricciones y Giros Cerrados
* **Puentes y Túneles Bajos (`maxheight`):** Avisos automáticos en el mapa indicando la altura real del puente frente a la de tu camión (resaltando en rojo si no pasas).
* **Límites de Peso (`maxweight` y `maxaxleload`):** Señalización de puentes o calles limitadas a cierto tonelaje.
* **Calles Estrechas o Prohibidas (`maxwidth` y `hgv=no`).**
* **Detector de Giros Cerrados:** Alerta visual `↪ Giro X°` en esquinas complejas donde un camión largo debe abrir la cabeza tractora.

### 4. 🗺️ Comparador Coche vs. Camión
* Muestra sobre el mapa la **ruta segura de camión (azul)** y en línea punteada roja la **ruta de coche descartada**, permitiendo ver al instante qué calles estrechas o pasos inferiores se están evitando.

### 5. 📲 Exportación Inteligente a Navegadores GPS (Google Maps / Waze)
* Al pulsar **"Abrir en Google Maps"**, la app inyecta hasta **8 waypoints (puntos de paso intermedios)** tomados de la ruta de camión calculada. De este modo, **se fuerza a Google Maps a guiar por voz siguiendo el camino seguro de camión**, evitando que recalcule por atajos o calles estrechas de turismo.

---

## 📍 Escenarios de Demostración en España
En la barra superior, pulsa **"📍 Ejemplos España"** para probar con un solo clic:
* **Madrid Pacífico → Méndez Álvaro:** Caso clásico de pasos inferiores y gálibos ferroviarios de 3.2m / 3.6m donde el tráiler de 4m se desvía por la ruta segura.
* **Coslada CTC → Mercamadrid:** Ruta logística pesada por vías de alta capacidad.
* **Toledo Polígono → Acceso Urbano:** Comparativa en accesos históricos y calles estrechas.
* **Barcelona Zona Franca → Badalona Sur:** Tránsito por rondas y zonas industriales.
