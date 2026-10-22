// Los plugins de Android (AGP, Google Services) vienen de Google Maven, que no siempre está al alcance (por ejemplo,
// en el equipo donde se escribió esto). Por eso se cargan aquí solo si hay SDK de Android: así «core» compila igual.
// Todos los plugins quedan en el mismo classpath de la raíz (el de Kotlin necesita ver el de Android).
buildscript {
    val sdkLocal = file("local.properties").takeIf { it.exists() }?.readLines()?.any { it.startsWith("sdk.dir=") } == true
    val conAndroid = !System.getenv("ANDROID_HOME").isNullOrBlank() || !System.getenv("ANDROID_SDK_ROOT").isNullOrBlank() || sdkLocal
    repositories {
        if (conAndroid) google()
        mavenCentral()
        gradlePluginPortal()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20")
        classpath("org.jetbrains.kotlin:kotlin-serialization:2.1.20")
        if (conAndroid) {
            classpath("com.android.tools.build:gradle:8.13.0")
            classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.1.20")
            classpath("com.google.devtools.ksp:symbol-processing-gradle-plugin:2.1.20-1.0.32")
            classpath("com.google.gms:google-services:4.4.4")
            classpath("io.github.takahirom.roborazzi:roborazzi-gradle-plugin:1.43.0")
        }
    }
}
