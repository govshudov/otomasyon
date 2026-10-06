/** twin-map.json'un tip karşılığı — model üreticisi tarafından yazılır. */

export interface SignalDef {
  tag: string
  label: string
  unit: string | null
  type: 'float' | 'int' | 'bool'
  range: [number, number] | null
  alarms: { level: 'WARN' | 'ALARM'; op: string; value: number | boolean; msg: string }[]
}

export interface CameraFrame {
  target: [number, number, number]
  radius: number
}

export interface ComponentDef {
  node: string
  label: string
  signals: Record<string, SignalDef>
  camera?: CameraFrame
}

export interface EquipmentDef {
  type: string
  label: string
  node: string
  signals: Record<string, SignalDef>
  components: Record<string, ComponentDef>
  camera?: CameraFrame
}

export interface TwinMap {
  station: string
  schema_version: string
  equipment: Record<string, EquipmentDef>
  static: string[]
  geometry: {
    water: {
      invert_el: number; deck_el: number
      /** [y, taban genişliği, üst genişlik] — Blender koordinatında, memba → mansap */
      plan?: [number, number, number][]
      y_from?: number; y_to?: number
      // eski biçim (tek trapez + doğrusal daralma)
      sections?: number; width_bottom?: number; width_top?: number; inlet_scale?: number
    }
    /** Emme hücrelerinin plan merkezleri (Blender x, y) */
    cells?: [number, number][]
  }
  budget: { tris: number; objects: number; materials: number }
}

/** Bir bileşenin görsel durumu — sahne bunu renge çevirir. */
export type Health = 'OK' | 'WARN' | 'ALARM' | 'UNKNOWN'
export type RunState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'FAULT' | 'MAINT' | 'UNKNOWN'
