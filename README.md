# Ollama Chat (Electron)

Aplicación de escritorio multiplataforma (Windows / Linux) tipo ChatGPT que permite:

- Seleccionar modelos locales instalados en Ollama
- Enviar mensajes tipo chat
- Adjuntar imagen local para modelos con capacidad de visión
- Arquitectura limpia: domain / application / infrastructure / renderer

## Requisitos

- Node.js 18+
- Ollama instalado y corriendo (`ollama serve`), modelos instalados (`ollama pull llama3`, etc.)

## Scripts principales

- `npm run dev` levanta build en watch (main/preload) y Vite para renderer. Luego ejecutar `npm start` en otra terminal o añadir `wait-on` para automatizar.
- `npm run build` compila todo.
- `npm run package` genera instaladores (usa electron-builder).

## Estructura
```
src/
  main/          (Proceso principal Electron)
  preload/       (API segura expuesta al renderer)
  renderer/      (UI React)
  shared/
    domain/      (Entidades, interfaces)
    application/ (Casos de uso futuros)
    infrastructure/ (Adaptadores: OllamaClient)
```

## Futuras mejoras sugeridas
- Streaming de tokens (usar endpoint con `stream: true` y canal IPC incremental)
- Manejo de múltiples chats y persistencia (electron-store)
- Mejorar UI (tailwind / chakra / material)
- Tests unitarios (Jest / Vitest)
- Accesibilidad y i18n

## Desarrollo
Instalar dependencias:
```
npm install
```
Modo desarrollo (dos terminales):
```
# Terminal 1
npm run dev
# Terminal 2
npm start
```
(Alternativamente se puede integrar `wait-on` y `cross-env` en un único script.)

## Distribución
```
npm run package
```
Generará artefactos en `dist` y `dist/{os}` usando electron-builder.

## Seguridad
- `contextIsolation` y `preload` para exponer API mínima
- Sin `nodeIntegration` en renderer
- CSP básica en `index.html`

## Licencia
MIT
