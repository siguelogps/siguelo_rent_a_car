// App Android nativa de Síguelo On Rent (Jetpack Compose) para el personal del rentacar: agenda del día, flota con
// km y combustible de la plataforma GPS, entrega y devolución con fotos, daños y firma (sin señal también),
// reservas, contratos e incidentes. Lo demás del sistema se abre en el navegador.
// Paquete cl.siguelogps.onrent, el mismo que tenía la app anterior (Capacitor), así Play la toma como actualización.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
    id("io.github.takahirom.roborazzi")
}

// Versión: la pone GitHub Actions (1.0.N, N = número de compilación, igual que la app anterior). En un computador 1 / 1.0-dev.
val versionCodeCi = System.getenv("VERSION_CODE")?.toIntOrNull() ?: 1
val versionNameCi = System.getenv("VERSION_NAME") ?: "1.0-dev"

// Servidor de On Rent. Se puede cambiar sin tocar el código: -Ponrent.url=… o la variable ONRENT_URL.
val urlOnRent = (findProperty("onrent.url") as String?) ?: System.getenv("ONRENT_URL") ?: "https://onrent.siguelogps.com"

// Llave de firma para Play: solo en GitHub Actions (secretos). Nunca va en el repositorio.
val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")

fun texto(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "cl.siguelogps.onrent"
    compileSdk = 36

    defaultConfig {
        applicationId = "cl.siguelogps.onrent"
        minSdk = 26
        targetSdk = 36
        versionCode = versionCodeCi
        versionName = versionNameCi
        buildConfigField("String", "API_URL", texto(urlOnRent.trimEnd('/')))
        resValue("string", "app_name", "Síguelo On Rent")
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // Sin R8: sin un teléfono donde probar la versión optimizada, una regla de más o de menos puede romper la
            // lectura del JSON (kotlinx.serialization) o Room solo en producción. La app queda algo más pesada, sin riesgo.
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            // Como la app anterior: la de prueba se instala aparte (cl.siguelogps.onrent.prueba) y convive con la de Play.
            applicationIdSuffix = ".prueba"
            versionNameSuffix = "-prueba"
            resValue("string", "app_name", "On Rent prueba")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Capturas de las pantallas con Robolectric + Roborazzi (sin emulador): src/test/…/CapturasPantallas.kt
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all { it.systemProperty("robolectric.pixelCopyRenderMode", "hardware") }
        }
    }
    packaging {
        resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/LICENSE*", "META-INF/NOTICE*")
    }
}

roborazzi {
    outputDir.set(file("build/capturas"))
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(project(":core"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.tooling.preview)
    debugImplementation(libs.compose.tooling)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)
    implementation(libs.play.location)
    implementation(libs.play.app.update)
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.junit)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}

// Avisos push (Firebase): solo si está google-services.json (GitHub Actions lo crea desde el secreto
// GOOGLE_SERVICES_JSON). Sin el archivo la app compila igual y no recibe avisos (lo demás funciona).
if (file("google-services.json").let { it.exists() && it.readText().isNotBlank() }) {
    apply(plugin = "com.google.gms.google-services")
    logger.lifecycle("google-services.json encontrado: avisos push activados")
} else {
    logger.lifecycle("Sin google-services.json: la app compila sin avisos push")
}
