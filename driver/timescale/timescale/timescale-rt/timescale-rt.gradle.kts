/*
 * Copyright 2026 MiRDEV Otomasyon. All Rights Reserved.
 */

import com.tridium.gradle.plugins.bajadoc.task.Bajadoc
import com.tridium.gradle.plugins.module.util.ModulePart.RuntimeProfile.*

plugins {
  id("com.tridium.niagara-module")
  id("com.tridium.niagara-signing")
  id("com.tridium.bajadoc")
  id("com.tridium.niagara-jacoco")
  id("com.tridium.niagara-annotation-processors")
  id("com.tridium.convention.niagara-home-repositories")
}

description = "Niagara -> TimescaleDB history / point / alarm export driver"

moduleManifest {
  moduleName.set("timescale")
  runtimeProfile.set(rt)
}

dependencies {
  // NRE
  nre(":nre")

  // Niagara module dependencies
  api(":baja")
  api(":alarm-rt")
  api(":control-rt")
  api(":driver-rt")
  api(":ndriver-rt")
  api(":history-rt")

  // PostgreSQL JDBC sürücüsü modül jar'ının içine gömülür.
  // 42.7.x Java 8 uyumludur — Niagara 4.15 JDK 8 ile derlenir.
  uberjar("org.postgresql:postgresql:42.7.4")

  moduleTestImplementation(":test-wb")
}

tasks.named<Bajadoc>("bajadoc") {
  //includePackage("com.akyllyoy.timescale")
}
