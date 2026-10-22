// Síguelo On Rent nativa (Android). Dos módulos:
//  · core: Kotlin puro (sin Android). Modelos de la API, reglas de la entrega y devolución (las mismas del servidor), cola de envío,
//    formatos chilenos. Se compila y se prueba en cualquier computador con Java: ./gradlew :core:test
//  · app: la app Android (Jetpack Compose). Necesita el SDK de Android; se compila en GitHub Actions.
// Sin SDK de Android (sin ANDROID_HOME ni local.properties con sdk.dir) solo se incluye «core»: así las pruebas de la
// lógica corren en un equipo que no puede bajar el SDK.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "siguelo-onrent"

include(":core")

val sdkLocal = file("local.properties").takeIf { it.exists() }?.readLines()?.any { it.startsWith("sdk.dir=") } == true
val conAndroid = !System.getenv("ANDROID_HOME").isNullOrBlank() || !System.getenv("ANDROID_SDK_ROOT").isNullOrBlank() || sdkLocal
if (conAndroid && providers.gradleProperty("soloCore").orNull != "true") {
    include(":app")
} else {
    println("Sin SDK de Android: solo se incluye el módulo «core» (la app se compila en GitHub Actions).")
}
