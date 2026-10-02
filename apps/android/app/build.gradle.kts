plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

// Firebase push is configured from app/google-services.json when that file exists. The
// google-services plugin is not used, so the app still builds (with push off) without it.
val fcm: Map<String, String> = run {
    val f = file("google-services.json")
    if (!f.exists()) return@run emptyMap()
    @Suppress("UNCHECKED_CAST")
    val root = groovy.json.JsonSlurper().parse(f) as Map<String, Any?>
    val info = root["project_info"] as? Map<String, Any?> ?: return@run emptyMap()
    @Suppress("UNCHECKED_CAST")
    val clients = root["client"] as? List<Map<String, Any?>> ?: return@run emptyMap()
    val client = clients.firstOrNull {
        @Suppress("UNCHECKED_CAST")
        val ci = it["client_info"] as? Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val aci = ci?.get("android_client_info") as? Map<String, Any?>
        aci?.get("package_name") == "dev.samal.app"
    } ?: return@run emptyMap()
    @Suppress("UNCHECKED_CAST")
    val ci = client["client_info"] as Map<String, Any?>
    @Suppress("UNCHECKED_CAST")
    val keys = client["api_key"] as? List<Map<String, Any?>>
    mapOf(
        "FCM_PROJECT_ID" to info["project_id"].toString(),
        "FCM_SENDER_ID" to info["project_number"].toString(),
        "FCM_APP_ID" to ci["mobilesdk_app_id"].toString(),
        "FCM_API_KEY" to (keys?.firstOrNull()?.get("current_key")?.toString() ?: ""),
    )
}

android {
    namespace = "dev.samal.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.samal.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        for (key in listOf("FCM_PROJECT_ID", "FCM_SENDER_ID", "FCM_APP_ID", "FCM_API_KEY")) {
            buildConfigField("String", key, "\"${fcm[key].orEmpty()}\"")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.navigation:navigation-compose:2.8.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.room:room-runtime:2.8.5")
    implementation("androidx.room:room-ktx:2.8.5")
    ksp("androidx.room:room-compiler:2.8.5")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.livekit:livekit-android:2.28.2")
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
