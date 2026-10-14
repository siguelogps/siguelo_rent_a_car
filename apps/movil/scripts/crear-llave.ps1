# Crea la llave de carga de Síguelo On Rent (para Play Store) y la deja lista para GitHub Actions.
# Se corre UNA sola vez, en tu computador, en PowerShell:
#     powershell -ExecutionPolicy Bypass -File apps\movil\scripts\crear-llave.ps1
# Necesita Java (keytool; viene con Android Studio). Si tienes GitHub CLI (gh) con sesión iniciada,
# además carga los 4 secretos en el repositorio. Si no, te dice qué pegar en GitHub.
#
# La llave y su clave quedan SOLO en tu computador: guárdalas en un lugar seguro (gestor de contraseñas
# y una copia fuera del computador). Nunca las subas al repositorio ni las mandes por chat.

$ErrorActionPreference = "Stop"
$alias = "siguelo-on-rent"
$archivo = Join-Path (Get-Location) "siguelo-on-rent.jks"
$repo = "siguelogps/siguelo_rent_a_car"

if (Test-Path $archivo) { throw "Ya existe $archivo. No se sobrescribe: si es tu llave, guárdala bien." }

$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $keytool) {
    $candidatos = @(
        "$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe",
        "$env:ProgramFiles\Android\Android Studio\jre\bin\keytool.exe"
    )
    $keytool = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $keytool) { throw "No encontré keytool. Instala Android Studio (trae Java) y vuelve a correr el script." }

$clave = Read-Host "Elige una clave para la llave (mínimo 8 caracteres)" -AsSecureString
$texto = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($clave))
if ($texto.Length -lt 8) { throw "La clave debe tener al menos 8 caracteres." }

& $keytool -genkeypair -v -keystore $archivo -alias $alias -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $texto -keypass $texto `
    -dname "CN=Siguelo GPS, O=Tecnologias de Rastreo y Seguridad SpA, C=CL"
if ($LASTEXITCODE -ne 0) { throw "keytool falló." }

$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($archivo))
Write-Host ""
Write-Host "Llave creada: $archivo" -ForegroundColor Green

if (Get-Command gh -ErrorAction SilentlyContinue) {
    $base64 | gh secret set ANDROID_KEYSTORE_BASE64 --repo $repo
    $texto  | gh secret set ANDROID_KEYSTORE_PASSWORD --repo $repo
    $alias  | gh secret set ANDROID_KEY_ALIAS --repo $repo
    $texto  | gh secret set ANDROID_KEY_PASSWORD --repo $repo
    Write-Host "Listo: los 4 secretos quedaron en $repo. La próxima compilación deja el .aab firmado." -ForegroundColor Green
} else {
    $base64 | Set-Clipboard
    Write-Host "No está GitHub CLI. Crea estos 4 secretos en GitHub:" -ForegroundColor Yellow
    Write-Host "  https://github.com/$repo/settings/secrets/actions"
    Write-Host "  ANDROID_KEYSTORE_BASE64  = (ya quedó copiado en el portapapeles: pégalo)"
    Write-Host "  ANDROID_KEYSTORE_PASSWORD = la clave que elegiste"
    Write-Host "  ANDROID_KEY_ALIAS        = $alias"
    Write-Host "  ANDROID_KEY_PASSWORD     = la misma clave"
}
Write-Host ""
Write-Host "Guarda siguelo-on-rent.jks y su clave en un lugar seguro." -ForegroundColor Yellow
