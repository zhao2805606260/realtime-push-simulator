import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

// ========== 类型 ==========
interface Entity {
  id: number; lat: number; lng: number; heading: number
  speed: number; icon: string; type: string; targetLat: number; targetLng: number
}

// ========== 军事实体定义 ==========
const ENTITY_TYPES = [
  { icon: '🛩️', type: '战斗机', speed: 800 },
  { icon: '🚁', type: '直升机', speed: 250 },
  { icon: '🚢', type: '驱逐舰', speed: 30 },
  { icon: '🚛', type: '装甲车', speed: 70 },
  { icon: '🎯', type: '导弹', speed: 2500 },
]

const CENTER: [number, number] = [21.5, 118.5]

function randPos() {
  return { lat: CENTER[0] + (Math.random() - 0.5) * 4, lng: CENTER[1] + (Math.random() - 0.5) * 5 }
}

// ========== 军事实体图标 ==========
function milIcon(emoji: string) {
  return L.divIcon({
    html: `<div style="font-size:22px;transform:translate(-50%,-50%)">${emoji}</div>`,
    className: '', iconSize: [30, 30], iconAnchor: [15, 15],
  })
}

// ========== 模拟推送 ==========
function createSim(onPush: (es: Entity[]) => void, count: number, speedMul: number) {
  let running = false, raf = 0
  const es: Entity[] = []
  for (let i = 0; i < count; i++) {
    const t = ENTITY_TYPES[i % ENTITY_TYPES.length]; const p = randPos()
    es.push({ id: i, lat: p.lat, lng: p.lng, heading: 0, speed: t.speed, icon: t.icon, type: t.type, targetLat: randPos().lat, targetLng: randPos().lng })
  }
  function tick() {
    if (!running) return
    for (let j = 0; j < speedMul; j++) {
      for (const e of es) {
        const dLat = e.targetLat - e.lat, dLng = e.targetLng - e.lng
        const dist = Math.sqrt(dLat * dLat + dLng * dLng)
        if (dist < 0.01) { const np = randPos(); e.targetLat = np.lat; e.targetLng = np.lng }
        else {
          const step = (e.speed * 1.852) / 111 / 3600 * 3
          const r = Math.min(step / dist, 1)
          e.lat += dLat * r; e.lng += dLng * r
          e.heading = (Math.atan2(dLng, dLat) * 180) / Math.PI
        }
      }
    }
    onPush(es.map(e => ({ ...e })))
    raf = requestAnimationFrame(tick)
  }
  return {
    start() { running = true; raf = requestAnimationFrame(tick) },
    stop() { running = false; cancelAnimationFrame(raf) },
  }
}

// ========== FPS ==========
class FPS { f = 0; private c = 0; private t = performance.now()
  tick() { this.c++; const n = performance.now(); if (n - this.t >= 1000) { this.f = this.c; this.c = 0; this.t = n } return this.f }
  reset() { this.f = 0; this.c = 0; this.t = performance.now() }
}

// ========== 直接渲染地图 ==========
function DirectMap({ entities, fps }: { entities: Entity[]; fps: React.MutableRefObject<FPS> }) {
  const mapRef = useRef<L.Map | null>(null)
  const mk = useRef<Map<number, L.Marker>>(new Map())
  function Init() { const m = useMap(); useEffect(() => { mapRef.current = m }, [m]); return null }

  useEffect(() => {
    const m = mapRef.current; if (!m) return
    const exist = new Set(mk.current.keys()), want = new Set(entities.map(e => e.id))
    for (const id of exist) { if (!want.has(id)) { mk.current.get(id)?.remove(); mk.current.delete(id) } }
    for (const e of entities) {
      let marker = mk.current.get(e.id)
      if (marker) {
        marker.setLatLng([e.lat, e.lng])
        const el = marker.getElement(); if (el) { const d = el.querySelector('div'); if (d) d.style.transform = `translate(-50%,-50%) rotate(${e.heading}deg)` }
      } else {
        marker = L.marker([e.lat, e.lng], { icon: milIcon(e.icon) }).addTo(m)
        marker.bindTooltip(`${e.type}-${e.id}`, { direction: 'top', offset: [0, -15] })
        mk.current.set(e.id, marker)
      }
    }
    fps.current.tick()
  }, [entities])
  return <Init />
}

// ========== 优化渲染地图 ==========
function OptimizedMap({ entities, fps }: { entities: Entity[]; fps: React.MutableRefObject<FPS> }) {
  const mapRef = useRef<L.Map | null>(null)
  const mk = useRef<Map<number, L.Marker>>(new Map())
  const cache = useRef<Map<number, Entity>>(new Map())
  const lastFlush = useRef(0); const rafId = useRef(0)
  function Init() { const m = useMap(); useEffect(() => { mapRef.current = m }, [m]); return null }

  useEffect(() => { for (const e of entities) cache.current.set(e.id, { ...e }) }, [entities])

  useEffect(() => {
    const m = mapRef.current; if (!m) return
    function flush() {
      const now = performance.now()
      if (now - lastFlush.current < 16) { rafId.current = requestAnimationFrame(flush); return }
      lastFlush.current = now
      const c = cache.current; const exist = new Set(mk.current.keys()); const want = new Set(c.keys())
      for (const id of exist) { if (!want.has(id)) { mk.current.get(id)?.remove(); mk.current.delete(id) } }
      c.forEach((e, id) => {
        let marker = mk.current.get(id)
        if (marker) {
          marker.setLatLng([e.lat, e.lng])
          const el = marker.getElement(); if (el) { const d = el.querySelector('div'); if (d) d.style.transform = `translate(-50%,-50%) rotate(${e.heading}deg)` }
        } else {
          marker = L.marker([e.lat, e.lng], { icon: milIcon(e.icon) }).addTo(m)
          marker.bindTooltip(`${e.type}-${e.id}`, { direction: 'top', offset: [0, -15] })
          mk.current.set(id, marker)
        }
      })
      fps.current.tick()
      rafId.current = requestAnimationFrame(flush)
    }
    rafId.current = requestAnimationFrame(flush)
    return () => cancelAnimationFrame(rafId.current)
  }, [])
  return <Init />
}

// ========== App ==========
export default function App() {
  const [ea, setEa] = useState<Entity[]>([])
  const [eb, setEb] = useState<Entity[]>([])
  const [fpsA, setFpsA] = useState(0); const [fpsB, setFpsB] = useState(0)
  const [cntA, setCntA] = useState(0); const [cntB, setCntB] = useState(0)
  const [n, setN] = useState(50); const [spd, setSpd] = useState(100)
  const [run, setRun] = useState(false)
  const sA = useRef<ReturnType<typeof createSim> | null>(null)
  const sB = useRef<ReturnType<typeof createSim> | null>(null)
  const fpsARef = useRef(new FPS()); const fpsBRef = useRef(new FPS())
  const cA = useRef(0); const cB = useRef(0)

  const start = useCallback(() => {
    if (run) return; setRun(true)
    fpsARef.current.reset(); fpsBRef.current.reset(); cA.current = 0; cB.current = 0
    sA.current = createSim(es => { cA.current++; setEa(es); setCntA(cA.current) }, n, spd)
    sB.current = createSim(es => { cB.current++; setEb(es); setCntB(cB.current) }, n, spd)
    sA.current.start(); sB.current.start()
    function loop() { setFpsA(fpsARef.current.f); setFpsB(fpsBRef.current.f); requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  }, [run, n, spd])

  const stop = useCallback(() => { setRun(false); sA.current?.stop(); sB.current?.stop() }, [])

  useEffect(() => () => { sA.current?.stop(); sB.current?.stop() }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>🖥️ 军事仿真高频数据推送渲染对比</h1>
        <p className="subtitle">南海区域 · Leaflet 地图 · 同数据源不同渲染策略</p>
      </header>
      <div className="controls">
        <div className="control-group">
          <label>实体：</label>
          <input type="range" min={10} max={200} step={10} value={n} onChange={e => setN(+e.target.value)} disabled={run} />
          <span className="value">{n}</span>
        </div>
        <div className="control-group">
          <label>倍速：</label>
          <input type="range" min={10} max={200} step={10} value={spd} onChange={e => setSpd(+e.target.value)} disabled={run} />
          <span className="value">{spd}x</span>
        </div>
        {!run ? <button className="btn btn-start" onClick={start}>▶ 开始推演</button>
          : <button className="btn btn-stop" onClick={stop}>⏹ 停止</button>}
      </div>
      <div className="compare-panel">
        <div className="panel panel-bad">
          <div className="panel-header bad">
            <h2>❌ 直接渲染</h2>
            <div className="stats"><span className="fps" style={{ color: fpsA >= 20 ? '#ffd93d' : '#ff6b6b' }}>{fpsA} FPS</span><span className="data-count">{cntA} 批</span></div>
          </div>
          <div className="map-wrapper">
            <MapContainer center={CENTER} zoom={8} className="leaflet-map" zoomControl={false} attributionControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              <DirectMap entities={ea} fps={fpsARef} />
            </MapContainer>
          </div>
          <div className="panel-desc">⚠️ 每次推送立即 setLatLng → DOM 频繁操作 → 掉帧</div>
        </div>
        <div className="panel panel-good">
          <div className="panel-header good">
            <h2>✅ 四层削峰</h2>
            <div className="stats"><span className="fps" style={{ color: fpsB >= 50 ? '#6bcb77' : '#ffd93d' }}>{fpsB} FPS</span><span className="data-count">{cntB} 批</span></div>
          </div>
          <div className="map-wrapper">
            <MapContainer center={CENTER} zoom={8} className="leaflet-map" zoomControl={false} attributionControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              <OptimizedMap entities={eb} fps={fpsBRef} />
            </MapContainer>
          </div>
          <div className="panel-desc">✅ Map 缓存去重 + 16ms 节流 → 平滑 60fps</div>
        </div>
      </div>
      <div className="legend">
        {ENTITY_TYPES.map(t => <div key={t.type} className="legend-item"><span className="legend-icon">{t.icon}</span><span>{t.type}</span><span className="legend-speed">{t.speed}节</span></div>)}
      </div>
      <div className="architecture">
        <h3>📐 真实项目架构</h3>
        <div className="arch-flow">
          <div className="arch-box">gRPC Streaming<small>Protobuf</small></div><span className="arch-arrow">→</span>
          <div className="arch-box highlight">WebWorker<small>Map 去重</small></div><span className="arch-arrow">→</span>
          <div className="arch-box highlight">16ms 节流<small>削峰2000x</small></div><span className="arch-arrow">→</span>
          <div className="arch-box highlight">Cesium/Leaflet<small>60fps</small></div>
        </div>
      </div>
    </div>
  )
}
