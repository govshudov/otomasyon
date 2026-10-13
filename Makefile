# Istasyon kurulumu ? komutlar. Ayrintilar ve make yoksa dogrudan komutlar: KURULUM.md
#
#   make                          bu yardim
#   make gereksinim [ROL=hazirlik]  bu PC'de gerekenler var mi
#
# Hazirlik PC'si (Blender / Python / web derlemesi):
#   make istasyon AYAR=ayarlar/1-may.json [YENIDEN=1] [GEOMETRI=1]   ayar -> stations/<id>.json
#   make model    AYAR=...                              3D model (Blender)
#   make paket    AYAR=...                              paket/<id>/ (istasyon PC'sine giden hazir paket)
#   make hazirla  AYAR=...                              ucu birden
#   make surucu ; make imzala                           timescale-rt.jar (p12 gerekir)
#
# Istasyon PC'si:
#   make kur   AYAR=ayarlar/1-may.json [ADIM=N] [BITIR=N]  kurulum (yarida kalirsa ADIM=N ile devam)
#   make plan  AYAR=...                                     adimlari yaz
#   make durum AYAR=...                                     kontrol raporu (yazmaz)
#   make tasi  AYAR=... HEDEF=E:\stations                  baska PC'ye tasima klasoru (denetler; TASIMA.md)
#
# Tum hedefler PowerShell betiklerini cagirir (tools/kurulum); make yalniz kisayoldur.

AYAR  ?= ayarlar/magtymguly.json
ADIM  ?= 1
BITIR ?= 10
ROL   ?= istasyon
HEDEF ?=
PS   := powershell -NoProfile -ExecutionPolicy Bypass -File

.PHONY: yardim gereksinim istasyon model paket hazirla surucu imzala kur plan durum tasi

yardim:
	@echo Kullanim (ayrintilar KURULUM.md):
	@echo   make gereksinim [ROL=hazirlik]
	@echo   make istasyon AYAR=ayarlar/1-may.json [YENIDEN=1]
	@echo   make model    AYAR=ayarlar/1-may.json
	@echo   make paket    AYAR=ayarlar/1-may.json
	@echo   make kur      AYAR=ayarlar/1-may.json [ADIM=N] [BITIR=N]
	@echo   make plan     AYAR=ayarlar/1-may.json
	@echo   make durum    AYAR=ayarlar/1-may.json
	@echo   make tasi     AYAR=ayarlar/1-may.json HEDEF=E:\stations
	@echo   make surucu / make imzala

gereksinim:
	$(PS) tools/kurulum/gereksinim.ps1 -Rol $(ROL)

istasyon:
	$(PS) tools/kurulum/hazirla.ps1 -Ayar $(AYAR) -Hedef istasyon $(if $(YENIDEN),-Yeniden,) $(if $(GEOMETRI),-Geometri,)

model:
	$(PS) tools/kurulum/hazirla.ps1 -Ayar $(AYAR) -Hedef model

paket:
	$(PS) tools/kurulum/hazirla.ps1 -Ayar $(AYAR) -Hedef paket

hazirla: istasyon model paket

surucu:
	$(PS) tools/kurulum/hazirla.ps1 -Hedef surucu

imzala:
	$(PS) tools/kurulum/hazirla.ps1 -Hedef imzala

kur:
	$(PS) tools/kurulum/kur-istasyon.ps1 -Ayar $(AYAR) -Basla $(ADIM) -Bitir $(BITIR)

plan:
	$(PS) tools/kurulum/kur-istasyon.ps1 -Ayar $(AYAR) -Plan

durum:
	$(PS) tools/kurulum/kur-istasyon.ps1 -Ayar $(AYAR) -Basla 10 -Bitir 10

tasi:
	$(PS) tools/kurulum/tasima.ps1 -Ayar $(AYAR) -Hedef $(HEDEF)
