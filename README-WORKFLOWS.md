# Workflows de .wgt (Tizen TV) y .apk (Android)

Estos dos proyectos son wrappers "lanzadores": no empaquetan tu app adentro,
apuntan directo a `https://osmtwich2.vercel.app/osmtwich.html`. Actualizás
la web en Vercel y tanto el TV como el celular ven la última versión, sin
recompilar, salvo que cambies estos wrappers en sí (ícono, nombre, etc.).

## Qué subir a `OsmTwichPlayer`

Copiá estas carpetas TAL CUAL a la raíz del repo (mismo nivel que
`index.html`, `api/`, etc.) y hacé "Add file → Upload files":

- `tizen/` (config.xml, icon.png, index.html)
- `capacitor/` (package.json, capacitor.config.json, www/index.html)
- `.github/workflows/build-wgt.yml`
- `.github/workflows/build-apk.yml`

⚠️ La carpeta `.github/workflows/` es especial: si "Add files" no te deja
arrastrar carpetas que empiezan con punto, subí primero cualquier archivo
suelto dentro de `.github/workflows/build-wgt.yml` usando "Create new file"
y pegando la ruta completa `.github/workflows/build-wgt.yml` en el nombre —
GitHub crea las carpetas solo. Repetí para `build-apk.yml`.

## Cómo se disparan

Cada uno corre automáticamente cuando hacés push a `main` y tocás su
carpeta (`tizen/` o `capacitor/`), y también podés lanzarlos a mano desde
la pestaña **Actions** del repo → elegís el workflow → "Run workflow".

## Dónde queda el resultado

En cada corrida, en **Actions → (la corrida) → Artifacts** vas a encontrar
`OsmTwich-wgt` (el .wgt) o `OsmTwich-apk` (el .apk) para descargar. Además,
en cada push a `main` se crea automáticamente un **Release** con el archivo
adjunto, así tenés un link fijo para descargar sin entrar a Actions.

## Limitaciones a tener en cuenta

- **El .wgt sale SIN FIRMAR.** Un Samsung TV real no instala paquetes sin
  firmar. Para instalarlo de verdad hay dos caminos:
  1. Abrir el proyecto `tizen/` en Tizen Studio, generar tu certificado de
     autor (Certificate Manager) y usar "Build Signed Package" sobre el
     .wgt descargado, o
  2. Directamente hacer "Run As → Tizen Web Application" desde Tizen
     Studio con el TV en modo desarrollador conectado por IP (firma e
     instala en un solo paso, sin pasar por GitHub Actions).
  Firmar automáticamente en CI requeriría subir tu certificado de
  distribuidor de Samsung (ligado a tu cuenta personal) como secreto del
  repo — es posible, pero preferí no automatizarlo sin que me confirmes
  que querés exponerlo así.

- **El .apk sale como "debug"**, firmado con la clave de depuración de
  Android (sirve para instalar y probar en cualquier dispositivo/TV con
  "orígenes desconocidos" habilitado, pero no para subir a Play Store). Si
  después querés una versión "release" firmada con tu propia clave, se
  agrega un `keystore` como secreto del repo y un paso extra en
  `build-apk.yml` — avisame y lo hago.

- El botón Atrás y el resto de la lógica específica de Android/TV ya están
  resueltos del lado del JS de la propia web (usa `Capacitor.Plugins.App`),
  así que no hace falta tocar código nativo para eso.

- Si más adelante agregás una versión Android **TV** (Leanback launcher,
  como tenías con el proyecto WebView viejo), es un cambio aparte al
  `AndroidManifest.xml` que Capacitor genera — pedímelo cuando lo necesites
  y lo agrego al workflow.
